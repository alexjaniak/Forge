import fs from "fs";
import path from "path";
import { eventsPath, getForgeRoot } from "@/lib/paths";
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
  const eventsFilePath = eventsPath();
  const eventsDirPath = path.dirname(eventsFilePath);
  const eventsFileName = path.basename(eventsFilePath);
  const locksDirPath = path.join(getForgeRoot(), "locks/issues");

  let eventsFileWatcher: fs.FSWatcher | null = null;
  let eventsDirWatcher: fs.FSWatcher | null = null;
  let locksDirWatcher: fs.FSWatcher | null = null;
  const lockInfoDirWatchers = new Map<string, fs.FSWatcher>();
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

    if (eventsFileWatcher) {
      try {
        eventsFileWatcher.close();
      } catch {
        // ignore cleanup errors
      }
      eventsFileWatcher = null;
    }

    if (eventsDirWatcher) {
      try {
        eventsDirWatcher.close();
      } catch {
        // ignore cleanup errors
      }
      eventsDirWatcher = null;
    }

    if (locksDirWatcher) {
      try {
        locksDirWatcher.close();
      } catch {
        // ignore cleanup errors
      }
      locksDirWatcher = null;
    }

    for (const watcher of lockInfoDirWatchers.values()) {
      try {
        watcher.close();
      } catch {
        // ignore cleanup errors
      }
    }
    lockInfoDirWatchers.clear();
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

  function watchEventsFile(onChange: () => void) {
    if (eventsFileWatcher) {
      try {
        eventsFileWatcher.close();
      } catch {
        // ignore cleanup errors
      }
    }

    try {
      eventsFileWatcher = fs.watch(eventsFilePath, () => {
        onChange();
      });
    } catch {
      eventsFileWatcher = null;
    }
  }

  function readRelevantChanges(): boolean {
    let fileSize = 0;
    try {
      fileSize = fs.statSync(eventsFilePath).size;
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
    const fd = fs.openSync(eventsFilePath, "r");
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

  function refreshLockInfoDirWatchers(onChange: () => void) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(locksDirPath, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const nextWatchPaths = new Set(
      entries
        .filter((entry) => entry.isDirectory() && /^\d+\.lock$/.test(entry.name))
        .map((entry) => path.join(locksDirPath, entry.name))
    );

    for (const [watchPath, watcher] of lockInfoDirWatchers) {
      if (nextWatchPaths.has(watchPath)) {
        continue;
      }
      try {
        watcher.close();
      } catch {
        // ignore cleanup errors
      }
      lockInfoDirWatchers.delete(watchPath);
    }

    for (const watchPath of nextWatchPaths) {
      if (lockInfoDirWatchers.has(watchPath)) {
        continue;
      }
      try {
        const watcher = fs.watch(watchPath, (_eventType, filename) => {
          if (filename && filename !== "info.json") {
            return;
          }
          onChange();
        });
        lockInfoDirWatchers.set(watchPath, watcher);
      } catch {
        // ignore watch setup errors
      }
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      try {
        fs.mkdirSync(eventsDirPath, { recursive: true });
        fs.mkdirSync(locksDirPath, { recursive: true });
      } catch {
        // ignore setup errors
      }

      try {
        offset = fs.statSync(eventsFilePath).size;
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

      const handleLockChange = () => {
        refreshLockInfoDirWatchers(handleLockChange);
        invalidateIssueSnapshot();
        void sendSnapshot(controller, true);
      };

      watchEventsFile(handleChange);
      refreshLockInfoDirWatchers(handleLockChange);

      try {
        eventsDirWatcher = fs.watch(eventsDirPath, (_eventType, filename) => {
          if (filename && filename !== eventsFileName) {
            return;
          }
          watchEventsFile(handleChange);
          handleChange();
        });
      } catch {
        eventsDirWatcher = null;
      }

      try {
        locksDirWatcher = fs.watch(locksDirPath, () => {
          handleLockChange();
        });
      } catch {
        locksDirWatcher = null;
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
