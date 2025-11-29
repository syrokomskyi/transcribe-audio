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
    const files = await fs.readdir(INPUT_DIR);
    const audioFiles = files.filter(
      (file) =>
        file.endsWith(".mp3") || file.endsWith(".mp4") || file.endsWith(".wav"),
    );

    if (audioFiles.length === 0) {
      console.log("No audio files found in input directory.");
      return;
    }

    console.log(`Found ${audioFiles.length} files to transcribe.`);

    for (const file of audioFiles) {
      const inputPath = path.join(INPUT_DIR, file);
      const outputFilename = `${path.parse(file).name}.txt`;
      const outputPath = path.join(OUTPUT_DIR, outputFilename);

      let text: string;

      try {
        await fs.access(outputPath);
        console.log(
          `Output file exists for ${file}, processing existing text: ${outputFilename}`,
        );
        text = await fs.readFile(outputPath, "utf-8");
      } catch {
        // File does not exist, transcribe
        console.log(`Transcribing ${file}...`);
        text = await transcriber.transcribe(inputPath);
      }

      // Always split into sentences
      const splitText = splitter.split(text);
      await fs.writeFile(outputPath, splitText);
      console.log(`Saved processed text to ${outputFilename}`);
    }
  } catch (error) {
    console.error("Error processing files:", error);
  }
}

main();
