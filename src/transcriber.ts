import fs from 'fs/promises';

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
}
