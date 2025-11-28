import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { CloudflareTranscribeService } from './transcriber';

dotenv.config();

const INPUT_DIR = path.resolve('input');
const OUTPUT_DIR = path.resolve('output');

async function main() {
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
        console.error('Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env file');
        process.exit(1);
    }

    const transcriber = new CloudflareTranscribeService(accountId, apiToken);

    try {
        const files = await fs.readdir(INPUT_DIR);
        const audioFiles =
            files.filter(file => file.endsWith('.mp3') || file.endsWith('.mp4') || file.endsWith('.wav'));

        if (audioFiles.length === 0) {
            console.log('No audio files found in input directory.');
            return;
        }

        console.log(`Found ${audioFiles.length} files to transcribe.`);

        for (const file of audioFiles) {
            const inputPath = path.join(INPUT_DIR, file);
            console.log(`Transcribing ${file}...`);

            try {
                const text = await transcriber.transcribe(inputPath);

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const outputFilename = `${path.parse(file).name}-${timestamp}.txt`;
                const outputPath = path.join(OUTPUT_DIR, outputFilename);

                await fs.writeFile(outputPath, text);
                console.log(`Saved transcription to ${outputFilename}`);
            } catch (error) {
                console.error(`Failed to transcribe ${file}:`, error);
            }
        }
    } catch (error) {
        console.error('Error processing files:', error);
    }
}

main();
