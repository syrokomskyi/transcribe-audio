export interface PostProcessService {
  process(text: string): string;
}

export class RepetitionPostProcessService implements PostProcessService {
  process(text: string): string {
    const lines = text.split("\n");
    if (lines.length === 0) return "";

    const processedLines: string[] = [];
    let currentRun: string[] = [];

    for (const line of lines) {
      if (currentRun.length === 0) {
        currentRun.push(line);
        continue;
      }

      if (line === currentRun[0]) {
        currentRun.push(line);
      } else {
        // Flush current run
        this.flushRun(currentRun, processedLines);
        currentRun = [line];
      }
    }

    // Flush last run
    if (currentRun.length > 0) {
      this.flushRun(currentRun, processedLines);
    }

    return processedLines.join("\n");
  }

  private flushRun(run: string[], output: string[]) {
    if (run.length === 0) return;

    if (run.length > 4) {
      output.push(run[0]);
      output.push("...");
    } else {
      output.push(...run);
    }
  }
}
