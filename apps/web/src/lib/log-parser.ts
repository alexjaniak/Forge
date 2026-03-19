export interface LogBlock {
  agentId: string;
  timestamp: string;
  displayTime: string;
  duration?: number;
  exitCode?: number;
  content: string;
  key: string;
  type: "run" | "skip";
  skipReason?: string;
}

export interface LogParserState {
  currentTimestamp: string | null;
  currentDuration?: number;
  currentExitCode?: number;
  currentLines: string[];
  pendingLine: string;
}

const RUN_MARKER = /^=== RUN (\S+) duration=(\d+)s exit=(\d+) ===$/;
const SKIP_MARKER = /^=== SKIP (\S+) reason=(.+) ===$/;

function createEmptyState(): LogParserState {
  return {
    currentTimestamp: null,
    currentDuration: undefined,
    currentExitCode: undefined,
    currentLines: [],
    pendingLine: "",
  };
}

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
  raw: string,
  options?: {
    state?: LogParserState;
    finalize?: boolean;
  }
): { blocks: LogBlock[]; state: LogParserState } {
  const state = options?.state
    ? {
        currentTimestamp: options.state.currentTimestamp,
        currentDuration: options.state.currentDuration,
        currentExitCode: options.state.currentExitCode,
        currentLines: [...options.state.currentLines],
        pendingLine: options.state.pendingLine,
      }
    : createEmptyState();
  const blocks: LogBlock[] = [];

  const pushRunBlock = () => {
    if (!state.currentTimestamp || state.currentLines.length === 0) {
      return;
    }

    const content = state.currentLines.join("\n").trim();
    if (!content) {
      return;
    }

    blocks.push({
      agentId,
      timestamp: state.currentTimestamp,
      displayTime: formatTime(state.currentTimestamp),
      duration: state.currentDuration,
      exitCode: state.currentExitCode,
      content,
      key: `${agentId}-${state.currentTimestamp}`,
      type: "run",
    });
  };

  const clearRunState = () => {
    state.currentTimestamp = null;
    state.currentDuration = undefined;
    state.currentExitCode = undefined;
    state.currentLines = [];
  };

  const processLine = (line: string) => {
    const skipMatch = line.match(SKIP_MARKER);
    if (skipMatch) {
      pushRunBlock();
      clearRunState();
      const timestamp = skipMatch[1];
      blocks.push({
        agentId,
        timestamp,
        displayTime: formatTime(timestamp),
        content: "",
        key: `${agentId}-skip-${timestamp}`,
        type: "skip",
        skipReason: skipMatch[2],
      });
      return;
    }

    const runMatch = line.match(RUN_MARKER);
    if (runMatch) {
      pushRunBlock();
      state.currentTimestamp = runMatch[1];
      state.currentDuration = parseInt(runMatch[2], 10);
      state.currentExitCode = parseInt(runMatch[3], 10);
      state.currentLines = [];
      return;
    }

    if (state.currentTimestamp) {
      state.currentLines.push(line);
    }
  };

  const text = state.pendingLine + raw;
  const lines = text.split("\n");
  state.pendingLine = text.endsWith("\n") ? "" : (lines.pop() ?? "");
  if (text.endsWith("\n")) {
    lines.pop();
  }

  for (const line of lines) {
    processLine(line);
  }

  if (options?.finalize && state.pendingLine) {
    processLine(state.pendingLine);
    state.pendingLine = "";
  }

  if (state.currentTimestamp) {
    pushRunBlock();
  }

  return { blocks, state };
}
