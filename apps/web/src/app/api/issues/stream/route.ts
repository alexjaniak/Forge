import fs from "fs";
import path from "path";
import { eventsPath } from "@/lib/paths";
import {
  getEmptyIssueSnapshot,
  getIssueSnapshot,
  invalidateIssueSnapshot,
} from "@/lib/issues";

const KEEPALIVE_MS = 15000;
const ISSUE_EVENT_PREFIX = "issue.";

export const dynamic = "force-dynamic";

function encodeSse(event: string, payload: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function isRelevantIssueEvent(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { event_type?: unknown };
    return (
      typeof parsed.event_type === "string" &&
      parsed.event_type.startsWith(ISSUE_EVENT_PREFIX)
    );
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const filePath = eventsPath();
  const dirPath = path.dirname(filePath);
  const fileName = path.basename(filePath);

  let fileWatcher: fs.FSWatcher | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  let keepalive: NodeJS.Timeout | null = null;
  let closed = false;
  let offset = 0;
  let pendingLine = "";
  let snapshotInFlight = false;
  let snapshotQueued = false;

  function cleanup() {
    if (closed) return;
    closed = true;

    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }

    if (fileWatcher) {
      try {
        fileWatcher.close();
      } catch {
        // ignore cleanup errors
      }
      fileWatcher = null;
    }

    if (dirWatcher) {
      try {
        dirWatcher.close();
      } catch {
        // ignore cleanup errors
      }
      dirWatcher = null;
    }
  }

  async function sendSnapshot(
    controller: ReadableStreamDefaultController,
    forceRefresh: boolean
  ) {
    if (closed) return;
    if (snapshotInFlight) {
      snapshotQueued = snapshotQueued || forceRefresh;
      return;
    }

    snapshotInFlight = true;
    let nextForceRefresh = forceRefresh;

    try {
      do {
        const shouldForceRefresh = nextForceRefresh || snapshotQueued;
        snapshotQueued = false;
        nextForceRefresh = false;

        try {
          const snapshot = await getIssueSnapshot({
            forceRefresh: shouldForceRefresh,
          });
          if (closed) return;
          controller.enqueue(encodeSse("snapshot", snapshot));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (closed) return;
          controller.enqueue(
            encodeSse("snapshot", {
              ...getEmptyIssueSnapshot(),
              error: message,
            })
          );
        }
      } while (snapshotQueued);
    } finally {
      snapshotInFlight = false;
    }
  }

  function watchFile(onChange: () => void) {
    if (fileWatcher) {
      try {
        fileWatcher.close();
      } catch {
        // ignore cleanup errors
      }
    }

    try {
      fileWatcher = fs.watch(filePath, () => {
        onChange();
      });
    } catch {
      fileWatcher = null;
    }
  }

  function readRelevantChanges(): boolean {
    let fileSize = 0;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch {
      offset = 0;
      pendingLine = "";
      return false;
    }

    if (offset > fileSize) {
      offset = 0;
      pendingLine = "";
    }

    if (offset === fileSize) {
      return false;
    }

    const bytesToRead = fileSize - offset;
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(bytesToRead);

    try {
      fs.readSync(fd, buffer, 0, bytesToRead, offset);
    } finally {
      fs.closeSync(fd);
    }

    offset = fileSize;
    const chunk = pendingLine + buffer.toString("utf-8");
    const lines = chunk.split("\n");
    pendingLine = lines.pop() ?? "";

    return lines.some((line) => line.trim() !== "" && isRelevantIssueEvent(line));
  }

  const stream = new ReadableStream({
    start(controller) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch {
        // ignore setup errors
      }

      try {
        offset = fs.statSync(filePath).size;
      } catch {
        offset = 0;
      }

      const handleChange = () => {
        if (!readRelevantChanges()) {
          return;
        }
        invalidateIssueSnapshot();
        void sendSnapshot(controller, true);
      };

      watchFile(handleChange);

      try {
        dirWatcher = fs.watch(dirPath, (_eventType, filename) => {
          if (filename && filename !== fileName) {
            return;
          }
          watchFile(handleChange);
          handleChange();
        });
      } catch {
        dirWatcher = null;
      }

      keepalive = setInterval(() => {
        if (closed) return;
        controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
      }, KEEPALIVE_MS);

      void sendSnapshot(controller, false);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", cleanup, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
