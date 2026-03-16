export interface LogBlock {
  agentId: string;
  timestamp: string;
  displayTime: string;
  endTimestamp?: string;
  displayEndTime?: string;
  duration?: number;
  exitCode?: number;
  content: string;
  key: string;
  type: "run" | "skip";
  skipReason?: string;
}

const RUN_MARKER = /^=== RUN (\S+) \| duration=(\d+)s \| exit=(\d+) ===$/;
const END_MARKER = /^=== END RUN(?:\s+(\S+))? ===$/;
const SKIP_MARKER = /^=== SKIP (\S+) \| reason=(.+) ===$/;

function formatTime(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoTimestamp;
  }
}

export function parseLogBlocks(
  agentId: string,
  raw: string
): LogBlock[] {
  const lines = raw.split("\n");
  const blocks: LogBlock[] = [];
  let currentTimestamp: string | null = null;
  let currentDuration: number | undefined = undefined;
  let currentExitCode: number | undefined = undefined;
  let currentLines: string[] = [];

  for (const line of lines) {
    // Check for skip entries first
    const skipMatch = line.match(SKIP_MARKER);
    if (skipMatch) {
      // Flush any in-progress block
      if (currentTimestamp && currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content) {
          blocks.push({
            agentId,
            timestamp: currentTimestamp,
            displayTime: formatTime(currentTimestamp),
            duration: currentDuration,
            exitCode: currentExitCode,
            content,
            key: `${agentId}-${currentTimestamp}`,
            type: "run",
          });
        }
        currentTimestamp = null;
        currentLines = [];
        currentDuration = undefined;
        currentExitCode = undefined;
      }

      const ts = skipMatch[1];
      blocks.push({
        agentId,
        timestamp: ts,
        displayTime: formatTime(ts),
        content: "",
        key: `${agentId}-skip-${ts}`,
        type: "skip",
        skipReason: skipMatch[2],
      });
      continue;
    }

    const match = line.match(RUN_MARKER);
    if (match) {
      if (currentTimestamp && currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content) {
          blocks.push({
            agentId,
            timestamp: currentTimestamp,
            displayTime: formatTime(currentTimestamp),
            duration: currentDuration,
            exitCode: currentExitCode,
            content,
            key: `${agentId}-${currentTimestamp}`,
            type: "run",
          });
        }
      }
      currentTimestamp = match[1];
      currentDuration = parseInt(match[2], 10);
      currentExitCode = parseInt(match[3], 10);
      currentLines = [];
    } else {
      const endMatch = line.match(END_MARKER);
      if (endMatch) {
        if (currentTimestamp && currentLines.length > 0) {
          const content = currentLines.join("\n").trim();
          if (content) {
            const endTs = endMatch[1] || undefined;
            blocks.push({
              agentId,
              timestamp: currentTimestamp,
              displayTime: formatTime(currentTimestamp),
              endTimestamp: endTs,
              displayEndTime: endTs ? formatTime(endTs) : undefined,
              duration: currentDuration,
              exitCode: currentExitCode,
              content,
              key: `${agentId}-${currentTimestamp}`,
              type: "run",
            });
          }
        }
        currentTimestamp = null;
        currentLines = [];
        currentDuration = undefined;
        currentExitCode = undefined;
      } else if (currentTimestamp) {
        currentLines.push(line);
      }
    }
  }

  if (currentTimestamp && currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) {
      blocks.push({
        agentId,
        timestamp: currentTimestamp,
        displayTime: formatTime(currentTimestamp),
        duration: currentDuration,
        exitCode: currentExitCode,
        content,
        key: `${agentId}-${currentTimestamp}`,
        type: "run",
      });
    }
  }

  return blocks;
}
