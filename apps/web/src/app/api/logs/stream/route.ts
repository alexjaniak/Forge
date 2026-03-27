import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { agentLogPath, logsDir } from "@/lib/paths";

const SAFE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_CHUNK = 64 * 1024;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");

  if (agentId && !SAFE_ID_RE.test(agentId)) {
    return new Response("Invalid agent ID", { status: 400 });
  }

  const encoder = new TextEncoder();
  const watchers: fs.FSWatcher[] = [];
  const offsets = new Map<string, number>();
  let dirWatcher: fs.FSWatcher | null = null;
  let closed = false;

  function sendEvent(
    controller: ReadableStreamDefaultController,
    agent: string,
    data: string,
    offset: number
  ) {
    if (closed) return;
    const payload = JSON.stringify({ agentId: agent, data, offset });
    controller.enqueue(encoder.encode(`event: log\ndata: ${payload}\n\n`));
  }

  function readNewData(
    controller: ReadableStreamDefaultController,
    agent: string,
    logPath: string
  ) {
    let fileSize: number;
    try {
      fileSize = fs.statSync(logPath).size;
    } catch {
      return;
    }

    const currentOffset = offsets.get(agent) ?? fileSize;

    // Handle truncation
    if (currentOffset > fileSize) {
      offsets.set(agent, 0);
      readNewData(controller, agent, logPath);
      return;
    }

    const bytesToRead = Math.min(fileSize - currentOffset, MAX_CHUNK);
    if (bytesToRead <= 0) {
      offsets.set(agent, fileSize);
      return;
    }

    const fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, currentOffset);
    fs.closeSync(fd);

    const newOffset = currentOffset + bytesToRead;
    offsets.set(agent, newOffset);
    sendEvent(controller, agent, buffer.toString("utf-8"), newOffset);
  }

  function watchAgent(
    controller: ReadableStreamDefaultController,
    agent: string
  ) {
    const logPath = agentLogPath(agent);

    // Validate path traversal
    const resolvedLogsDir = path.resolve(logsDir());
    const resolvedLogPath = path.resolve(logPath);
    if (!resolvedLogPath.startsWith(resolvedLogsDir + path.sep)) return;

    // Initialize offset to current file size (don't send existing data)
    try {
      offsets.set(agent, fs.statSync(logPath).size);
    } catch {
      offsets.set(agent, 0);
    }

    try {
      const watcher = fs.watch(logPath, () => {
        readNewData(controller, agent, logPath);
      });
      watchers.push(watcher);
    } catch {
      // File doesn't exist yet — directory watcher will pick it up
    }
  }

  function cleanup() {
    closed = true;
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    watchers.length = 0;
    if (dirWatcher) {
      try {
        dirWatcher.close();
      } catch {
        // ignore
      }
      dirWatcher = null;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const dir = logsDir();

      // Ensure logs directory exists
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore
      }

      if (agentId) {
        // Single agent mode
        watchAgent(controller, agentId);
      } else {
        // All agents mode — watch existing log files
        try {
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".log"));
          for (const file of files) {
            const agent = path.basename(file, ".log");
            if (!SAFE_ID_RE.test(agent)) continue;
            watchAgent(controller, agent);
          }
        } catch {
          // directory might not exist yet
        }
      }

      // Watch directory for new log files
      try {
        dirWatcher = fs.watch(dir, (eventType, filename) => {
          if (
            !filename ||
            !filename.endsWith(".log") ||
            eventType !== "rename"
          )
            return;
          const agent = path.basename(filename, ".log");
          if (!SAFE_ID_RE.test(agent)) return;
          if (agentId && agent !== agentId) return;
          if (offsets.has(agent)) return; // already watching

          watchAgent(controller, agent);
        });
      } catch {
        // ignore
      }

      // Send initial keepalive
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      cleanup();
    },
  });

  // Clean up on client disconnect
  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
