# Transcribe Audio

A CLI tool to transcribe audio files using Cloudflare AI (Whisper model). Supports automatic chunking for large files with intelligent silence detection.

## Features

- **Cloudflare Whisper API** - Uses `@cf/openai/whisper` model for transcription
- **Large file support** - Automatically splits files >5MB at silence points using FFmpeg
- **Batch processing** - Processes all audio files in the input directory
- **Sentence splitting** - Outputs transcriptions with one sentence per line
- **Skip existing** - Skips transcription if output file already exists

## Prerequisites

- **Node.js** (v18+)
- **pnpm** (v10+)
- **FFmpeg** - Required for processing large audio files
- **Cloudflare account** with Workers AI access

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd transcribe-audio

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env
```

## Configuration

Edit `.env` file with your Cloudflare credentials:

```env
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
```

### Getting Cloudflare Credentials

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Account ID**: Found in the right sidebar of any zone or in the URL
3. **API Token**: Create at [API Tokens](https://dash.cloudflare.com/profile/api-tokens) with `Workers AI` read permission

## Usage

1. Place audio files (`.mp3`, `.mp4`, `.wav`) in the `input/` directory
2. Run the transcription:

```bash
pnpm start
```

3. Find transcribed text files in the `output/` directory

## Project Structure

```bash
transcribe-audio/
├── input/              # Place audio files here
├── output/             # Transcribed text files
├── src/
│   ├── index.ts        # Main entry point
│   └── services/
│       ├── transcribe.ts       # Cloudflare Whisper API integration
│       └── split-sentences.ts  # Sentence splitting utility
├── .env.example        # Environment template
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm start` | Run transcription |
| `pnpm lint` | Lint code with Biome |
| `pnpm format` | Format code with Biome |
| `pnpm upgrade-packages` | Update all dependencies |

## Technical Details

- **Max file size for direct upload**: 5MB
- **Large file handling**: Files >5MB are split at silence points (detected at -30dB, min 0.6s duration)
- **Max chunk duration**: 2 minutes
- **Audio encoding**: Chunks are re-encoded to MP3 at 64kbps

## Audio Sources

Sample audio for testing: <https://www.nachrichtenleicht.de>
