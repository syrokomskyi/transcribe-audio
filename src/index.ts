import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { RegexSplitSentencesService } from "./services/split-sentences";
import { CloudflareTranscribeService } from "./services/transcribe";

dotenv.config();

const INPUT_DIR = path.resolve("input");
const OUTPUT_DIR = path.resolve("output");

async function main() {
  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error(
      "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env file",
    );
    process.exit(1);
  }

  const transcriber = new CloudflareTranscribeService(accountId, apiToken);
  const splitter = new RegexSplitSentencesService();

  try {
    const dirents = await fs.readdir(INPUT_DIR, {
      recursive: true,
      withFileTypes: true,
    });
    const audioFiles = dirents.filter(
      (dirent) =>
        dirent.isFile() &&
        (dirent.name.endsWith(".mp3") ||
          dirent.name.endsWith(".mp4") ||
          dirent.name.endsWith(".wav")),
    );

    if (audioFiles.length === 0) {
      console.log("No audio files found in input directory.");
      return;
    }

    console.log(`Found ${audioFiles.length} files to transcribe.`);

    for (const dirent of audioFiles) {
      const fullInputPath = path.join(dirent.parentPath, dirent.name);
      const relativePath = path.relative(INPUT_DIR, fullInputPath);
      const outputFilename = `${path.parse(relativePath).name}.txt`;
      const outputRelativePath = path.join(
        path.dirname(relativePath),
        outputFilename,
      );
      const outputPath = path.join(OUTPUT_DIR, outputRelativePath);

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      let text: string;

      try {
        await fs.access(outputPath);
        console.log(
          `Output file exists for ${relativePath}, processing existing text: ${outputRelativePath}`,
        );
        text = await fs.readFile(outputPath, "utf-8");
      } catch {
        // File does not exist, transcribe
        console.log(`Transcribing ${relativePath}...`);
        text = await transcriber.transcribe(fullInputPath);
      }

      // Always split into sentences
      const splitText = splitter.split(text);
      await fs.writeFile(outputPath, splitText);
      console.log(`Saved processed text to ${outputRelativePath}`);
    }
  } catch (error) {
    console.error("Error processing files:", error);
  }
}

main();
