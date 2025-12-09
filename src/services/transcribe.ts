import { exec } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB safety limit
const MIN_CHUNK_SIZE = 1024; // 1KB minimum chunk size to avoid empty/corrupted files
const SILENCE_NOISE_LEVEL = -30; // dB threshold for silence detection
const SILENCE_MIN_DURATION = 0.6; // minimum silence duration in seconds
const MAX_CHUNK_DURATION = 120; // maximum chunk duration in seconds (2 minutes)

export interface TranscribeService {
  transcribe(filePath: string): Promise<string>;
}

export class CloudflareTranscribeService implements TranscribeService {
  private accountId: string;
  private apiToken: string;
  private language: string | undefined;

  constructor(accountId: string, apiToken: string, language?: string) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.language = language;
  }

  async transcribe(filePath: string): Promise<string> {
    const stats = await fs.stat(filePath);

    if (stats.size <= MAX_FILE_SIZE) {
      return this.transcribeFile(filePath);
    }

    console.log(
      `File size ${stats.size} exceeds limit. Splitting into chunks...`,
    );
    return this.transcribeLargeFile(filePath);
  }

  private async transcribeFile(filePath: string): Promise<string> {
    const audioData = await fs.readFile(filePath);

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/openai/whisper${this.language ? `?language=${this.language}` : ""}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: audioData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare API Error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const result = await response.json();
    return result.result.text;
  }

  private async detectSilence(filePath: string): Promise<number[]> {
    try {
      const detectCmd = `ffmpeg -i "${filePath}" -af silencedetect=noise=${SILENCE_NOISE_LEVEL}dB:d=${SILENCE_MIN_DURATION} -f null - 2>&1`;
      const { stdout, stderr } = await execAsync(detectCmd);
      const output = stdout + stderr;

      // Parse silence_end timestamps from FFmpeg output
      const silenceEndRegex = /silence_end: ([\d.]+)/g;
      const silenceEnds: number[] = [];
      // biome-ignore lint/suspicious/noImplicitAnyLet: false positive
      let match;
      // biome-ignore lint/suspicious/noAssignInExpressions: false positive
      while ((match = silenceEndRegex.exec(output)) !== null) {
        silenceEnds.push(parseFloat(match[1]));
      }

      console.log(
        `Detected ${silenceEnds.length} silence points:`,
        silenceEnds.slice(0, 10).map((t) => `${t.toFixed(2)}s`),
      );
      return silenceEnds;
    } catch (error) {
      console.warn(
        "Failed to detect silence, will use fallback splitting:",
        error,
      );
      return [];
    }
  }

  private async validateChunks(
    tempDir: string,
    chunks: string[],
  ): Promise<string[]> {
    const validChunks: string[] = [];

    for (const chunk of chunks) {
      const chunkPath = path.join(tempDir, chunk);
      try {
        const stats = await fs.stat(chunkPath);
        if (stats.size >= MIN_CHUNK_SIZE) {
          validChunks.push(chunk);
        } else {
          console.warn(
            `Skipping invalid chunk ${chunk} (size: ${stats.size} bytes, minimum: ${MIN_CHUNK_SIZE} bytes)`,
          );
          // Delete the invalid chunk
          await fs.unlink(chunkPath);
        }
      } catch (error) {
        console.warn(`Failed to validate chunk ${chunk}:`, error);
      }
    }

    return validChunks;
  }

  private async splitBySilence(
    filePath: string,
    tempDir: string,
  ): Promise<string[]> {
    const silencePoints = await this.detectSilence(filePath);

    if (silencePoints.length === 0) {
      console.log("No silence detected, using single chunk");
      // Fallback: copy entire file as single chunk
      const chunkPath = path.join(tempDir, "chunk_000.mp3");
      await fs.copyFile(filePath, chunkPath);
      return ["chunk_000.mp3"];
    }

    // Filter silence points to respect MAX_CHUNK_DURATION
    const segmentTimes: number[] = [];
    let lastSplit = 0;

    for (const silenceEnd of silencePoints) {
      if (silenceEnd - lastSplit >= MAX_CHUNK_DURATION) {
        segmentTimes.push(silenceEnd);
        lastSplit = silenceEnd;
      }
    }

    // Add remaining silence points that create reasonable chunks
    for (const silenceEnd of silencePoints) {
      if (!segmentTimes.includes(silenceEnd) && silenceEnd - lastSplit >= 30) {
        segmentTimes.push(silenceEnd);
        lastSplit = silenceEnd;
      }
    }

    if (segmentTimes.length === 0) {
      console.log("No suitable split points found, using single chunk");
      const chunkPath = path.join(tempDir, "chunk_000.mp3");
      await fs.copyFile(filePath, chunkPath);
      return ["chunk_000.mp3"];
    }

    const times = segmentTimes.join(",");
    const chunkPattern = path.join(tempDir, "chunk_%03d.mp3");

    console.log(`Splitting at ${segmentTimes.length} silence points...`);
    // Need to encode to MP3 format, can't use -c copy from MP4/AAC to MP3 container
    const segmentCmd = `ffmpeg -i "${filePath}" -f segment -segment_times "${times}" -c:a libmp3lame -b:a 64k "${chunkPattern}"`;
    await execAsync(segmentCmd);

    const files = await fs.readdir(tempDir);
    const allChunks = files
      .filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3"))
      .sort();

    // Validate chunks to remove zero-length or corrupted files
    const validChunks = await this.validateChunks(tempDir, allChunks);

    if (validChunks.length === 0) {
      console.warn(
        "All chunks were invalid after splitting. Using original file as single chunk.",
      );
      const chunkPath = path.join(tempDir, "chunk_000.mp3");
      await fs.copyFile(filePath, chunkPath);
      return ["chunk_000.mp3"];
    }

    console.log(
      `Validated ${validChunks.length} of ${allChunks.length} chunks`,
    );
    return validChunks;
  }

  private async transcribeLargeFile(filePath: string): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "transcribe-"));
    console.log(`Created temp directory: ${tempDir}`);

    try {
      // Split file by silence detection for better transcription quality
      console.log("Detecting silence points for intelligent splitting...");
      const chunks = await this.splitBySilence(filePath, tempDir);

      console.log(`Split into ${chunks.length} chunks.`);

      // Transcribe all chunks in parallel
      const transcriptionPromises = chunks.map(async (chunk, index) => {
        const chunkPath = path.join(tempDir, chunk);
        console.log(`Starting transcription for chunk ${chunk}...`);
        try {
          const text = await this.transcribeFile(chunkPath);
          return { index, chunk, text, success: true };
        } catch (error) {
          console.error(`Failed to transcribe chunk ${chunk}:`, error);
          return { index, chunk, text: `ERROR ${chunk}`, success: false };
        }
      });

      const transcriptionResults = await Promise.all(transcriptionPromises);

      // Sort results by index and log statistics
      const sortedResults = transcriptionResults.sort(
        (a, b) => a.index - b.index,
      );
      for (const result of sortedResults) {
        if (result.success) {
          const wordCount = result.text.split(/\s+/).length;
          console.log(`Chunk ${result.chunk}: ${wordCount} words`);
        } else {
          console.log(`Chunk ${result.chunk}: ERROR`);
        }
      }

      const results = transcriptionResults;
      const successfulResults = results
        .filter((result) => result.success)
        .sort((a, b) => a.index - b.index);

      let fullText = successfulResults.map((result) => result.text).join("\n");

      // Handle failed chunks
      const failedResults = results.filter((result) => !result.success);
      if (failedResults.length > 0) {
        console.error(`Some chunks failed: ${failedResults.length}`);
        fullText += `\n${failedResults.map((result) => result.text).join("\n")}`;
      }

      return fullText.trim();
    } catch (error) {
      console.error(`Error in transcribeLargeFile:`, error);
      throw error;
    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
