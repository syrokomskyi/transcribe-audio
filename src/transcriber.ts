import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB safety limit

export interface TranscribeService {
    transcribe(filePath: string): Promise<string>;
}

export class CloudflareTranscribeService implements TranscribeService {
    private accountId: string;
    private apiToken: string;

    constructor(accountId: string, apiToken: string) {
        this.accountId = accountId;
        this.apiToken = apiToken;
    }

    async transcribe(filePath: string): Promise<string> {
        const stats = await fs.stat(filePath);

        if (stats.size <= MAX_FILE_SIZE) {
            return this.transcribeFile(filePath);
        }

        console.log(`File size ${stats.size} exceeds limit. Splitting into chunks...`);
        return this.transcribeLargeFile(filePath);
    }

    private async transcribeFile(filePath: string): Promise<string> {
        const audioData = await fs.readFile(filePath);

        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/openai/whisper`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/octet-stream',
                },
                body: audioData,
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloudflare API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        return result.result.text;
    }

    private async transcribeLargeFile(filePath: string): Promise<string> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-'));
        console.log(`Created temp directory: ${tempDir}`);
        const chunkPattern = path.join(tempDir, 'chunk_%03d.mp3');

        try {
            // Split file into 2-minute chunks (approx 1MB for mp3 at 64kbps)
            // -f segment: split into segments
            // -segment_time 120: 120 seconds (2 minutes)
            // -c:a libmp3lame: convert to mp3
            // -b:a 64k: 64kbps bitrate (lower quality but ensures small file size)
            const ffmpegCmd = `ffmpeg -i "${filePath}" -f segment -segment_time 120 -c:a libmp3lame -b:a 64k "${chunkPattern}"`;
            console.log(`Running ffmpeg command...`);
            const { stdout, stderr } = await execAsync(ffmpegCmd);
            if (stderr) {
                console.log(`FFmpeg output: ${stderr.substring(0, 500)}`);
            }

            const files = await fs.readdir(tempDir);
            const chunks = files.filter(f => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();

            console.log(`Split into ${chunks.length} chunks.`);

            let fullText = '';
            for (const chunk of chunks) {
                const chunkPath = path.join(tempDir, chunk);
                console.log(`Transcribing chunk ${chunk}...`);
                const text = await this.transcribeFile(chunkPath);
                fullText += text + '\n';
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
