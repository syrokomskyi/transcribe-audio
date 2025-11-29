export interface SplitSentencesService {
  split(text: string): string;
}

export class RegexSplitSentencesService implements SplitSentencesService {
  split(text: string): string {
    // Split by sentence endings (. ! ?) followed by space or end
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 0);
    return sentences.map((s) => s.trim()).join("\n");
  }
}
