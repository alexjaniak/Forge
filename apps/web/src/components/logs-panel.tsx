"use client";

import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "react";
import { LogBlock, parseLogBlocks } from "@/lib/log-parser";
import { getAgentColor } from "@/lib/colors";

const MAX_BLOCKS = 200;
const POLL_INTERVAL = 5000; // Fallback polling interval (only used when SSE drops)

interface AgentOffset {
  [agentId: string]: number;
}

export function LogsPanel() {
  const [blocks, setBlocks] = useState<LogBlock[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const offsetsRef = useRef<AgentOffset>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const prevScrollTop = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Merge new blocks into state
  const mergeBlocks = useCallback(
    (newBlocks: LogBlock[], mode: "all" | "single") => {
      if (newBlocks.length === 0) return;
      setBlocks((prev) => {
        // Build a map preferring blocks with more content
        const blockMap = new Map<string, LogBlock>();
        for (const b of prev) {
          blockMap.set(b.key, b);
        }
        let changed = false;
        for (const b of newBlocks) {
          const existing = blockMap.get(b.key);
          if (!existing) {
            blockMap.set(b.key, b);
            changed = true;
          } else if (existing.type !== "skip" && b.content.length > existing.content.length) {
            blockMap.set(b.key, b);
            changed = true;
          }
        }
        if (!changed) return prev;
        const merged = Array.from(blockMap.values());
        if (mode === "all") {
          merged.sort(
            (a, b) =>
              new Date(a.timestamp).getTime() -
              new Date(b.timestamp).getTime()
          );
          return merged.slice(-MAX_BLOCKS);
        } else {
          merged.sort(
            (a, b) =>
              new Date(a.timestamp).getTime() -
              new Date(b.timestamp).getTime()
          );
          return merged.slice(-MAX_BLOCKS);
        }
      });
    },
    []
  );

  // Initial load via existing GET endpoint
  const fetchInitialLogs = useCallback(async () => {
    if (activeTab === "all") {
      let agentIds = agents;
      if (agentIds.length === 0) {
        const agentsRes = await fetch("/api/agents");
        if (!agentsRes.ok) return;
        const agentsData = await agentsRes.json();
        agentIds = (agentsData.agents as { id: string }[]).map((a) => a.id);
        agentIds.sort();
        setAgents(agentIds);
      }

      const results = await Promise.all(
        agentIds.map(async (agentId) => {
          const res = await fetch(
            `/api/logs/${encodeURIComponent(agentId)}?offset=0`
          );
          if (!res.ok) return { agentId, data: "", offset: 0 };
          const data = await res.json();
          return { agentId, ...data };
        })
      );

      const newBlocks: LogBlock[] = [];
      for (const result of results) {
        if (result.data) {
          newBlocks.push(...parseLogBlocks(result.agentId, result.data));
        }
        offsetsRef.current[result.agentId] = result.offset;
      }
      mergeBlocks(newBlocks, "all");
    } else {
      const res = await fetch(
        `/api/logs/${encodeURIComponent(activeTab)}?offset=0`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.data) {
        const parsed = parseLogBlocks(activeTab, data.data);
        mergeBlocks(parsed, "single");
      }
      offsetsRef.current[activeTab] = data.offset;
    }
  }, [activeTab, agents, mergeBlocks]);

  // Fallback polling fetch (incremental)
  const fetchLogsPoll = useCallback(async () => {
    if (activeTab === "all") {
      const agentIds = agents;
      if (agentIds.length === 0) return;

      const results = await Promise.all(
        agentIds.map(async (agentId) => {
          const offset = offsetsRef.current[agentId] ?? 0;
          const res = await fetch(
            `/api/logs/${encodeURIComponent(agentId)}?offset=${offset}`
          );
          if (!res.ok) return { agentId, data: "", offset: 0 };
          const data = await res.json();
          return { agentId, ...data };
        })
      );

      const newBlocks: LogBlock[] = [];
      for (const result of results) {
        if (result.data) {
          newBlocks.push(...parseLogBlocks(result.agentId, result.data));
        }
        offsetsRef.current[result.agentId] = result.offset;
      }
      mergeBlocks(newBlocks, "all");
    } else {
      const offset = offsetsRef.current[activeTab] ?? 0;
      const res = await fetch(
        `/api/logs/${encodeURIComponent(activeTab)}?offset=${offset}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.data) {
        mergeBlocks(parseLogBlocks(activeTab, data.data), "single");
      }
      offsetsRef.current[activeTab] = data.offset;
    }
  }, [activeTab, agents, mergeBlocks]);

  // Start fallback polling
  const startFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current) return;
    fallbackTimerRef.current = setInterval(fetchLogsPoll, POLL_INTERVAL);
  }, [fetchLogsPoll]);

  // Stop fallback polling
  const stopFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  // Set up SSE connection
  useEffect(() => {
    // Reset state on tab switch
    setBlocks([]);
    offsetsRef.current = {};

    // Load initial history — called once per tab switch, not on every agent change.
    fetchInitialLogs();

    // Open SSE connection
    const sseUrl =
      activeTab === "all"
        ? "/api/logs/stream"
        : `/api/logs/stream?agentId=${encodeURIComponent(activeTab)}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.addEventListener("log", (event) => {
      const { agentId, data, offset } = JSON.parse(event.data);
      if (data) {
        const parsed = parseLogBlocks(agentId, data);
        mergeBlocks(parsed, activeTab === "all" ? "all" : "single");
      }
      offsetsRef.current[agentId] = offset;

      // If we're getting SSE events, discover new agents for tabs
      if (activeTab === "all") {
        setAgents((prev) => {
          if (prev.includes(agentId)) return prev;
          const next = [...prev, agentId];
          next.sort();
          return next;
        });
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; start fallback polling in the meantime
      startFallbackPolling();
    };

    es.onopen = () => {
      stopFallbackPolling();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      stopFallbackPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mergeBlocks, startFallbackPolling, stopFallbackPolling]);

  // Auto-scroll detection
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (!atBottom && el.scrollTop < prevScrollTop.current) {
      setAutoScroll(false);
    }
    if (atBottom) {
      setAutoScroll(true);
    }
    prevScrollTop.current = el.scrollTop;
  }, []);

  // Scroll to bottom when new blocks arrive and autoScroll is on
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [blocks, autoScroll]);

  const filteredBlocks =
    activeTab === "all"
      ? blocks
      : blocks.filter((b) => b.agentId === activeTab);

  const displayBlocks = filter
    ? filteredBlocks.filter((b) => {
        const q = filter.toLowerCase();
        return (
          b.content.toLowerCase().includes(q) ||
          (b.skipReason && b.skipReason.toLowerCase().includes(q))
        );
      })
    : filteredBlocks;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with tabs */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          <TabButton
            label="All"
            active={activeTab === "all"}
            onClick={() => setActiveTab("all")}
          />
          {agents.map((id) => (
            <TabButton
              key={id}
              label={id}
              active={activeTab === id}
              onClick={() => setActiveTab(id)}
              color={getAgentColor(id)}
            />
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-surface-hover text-text text-sm px-2 py-1 rounded border border-border outline-none focus:border-accent-blue w-40 shrink-0 ml-2"
        />
      </div>

      {/* Log cards */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {displayBlocks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">No logs yet</p>
          </div>
        ) : (
          displayBlocks.map((block) =>
            block.type === "skip" ? (
              <SkipCard key={block.key} block={block} showAgent={activeTab === "all"} />
            ) : (
              <LogCard key={block.key} block={block} showAgent={activeTab === "all"} />
            )
          )
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
        active
          ? "text-text-bright border-accent-blue"
          : "text-muted-foreground border-transparent hover:text-text"
      }`}
      style={active && color ? { borderColor: color } : undefined}
    >
      {color && (
        <span
          className="inline-block w-2 h-2 rounded-full mr-1.5"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </button>
  );
}

const COLLAPSED_HEIGHT = 144;

function LogCard({
  block,
  showAgent,
}: {
  block: LogBlock;
  showAgent: boolean;
}) {
  const agentColor = getAgentColor(block.agentId);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (el) {
      setOverflows(el.scrollHeight > COLLAPSED_HEIGHT);
    }
  }, [block.content]);

  return (
    <div className="bg-surface border border-border rounded-md p-3">
      <div className="flex items-center gap-2 mb-2">
        {showAgent && (
          <span
            className="text-sm font-semibold px-2 py-0.5 rounded"
            style={{
              backgroundColor: agentColor + "20",
              color: agentColor,
            }}
          >
            {block.agentId}
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          {block.displayTime}
        </span>
        {block.duration != null && (
          <span className="text-xs text-muted-foreground bg-surface-hover px-1.5 py-0.5 rounded">
            {block.duration}s
          </span>
        )}
        {block.exitCode != null && (
          <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              block.exitCode === 0
                ? "bg-green-500/15 text-green-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            exit {block.exitCode}
          </span>
        )}
      </div>
      <div className="relative">
        <pre
          ref={contentRef}
          className="text-text text-base whitespace-pre-wrap break-words leading-relaxed overflow-hidden transition-[max-height] duration-300 ease-in-out"
          style={{ maxHeight: expanded ? 2000 : COLLAPSED_HEIGHT }}
        >
          {block.content}
        </pre>
        {overflows && !expanded && (
          <div
            className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
            style={{
              background: "linear-gradient(to bottom, transparent, var(--surface))",
            }}
          />
        )}
      </div>
      {overflows && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="text-sm text-muted-foreground hover:text-text mt-1 cursor-pointer"
        >
          {expanded ? "▲ Show less" : "▼ Show more"}
        </button>
      )}
    </div>
  );
}

function SkipCard({
  block,
  showAgent,
}: {
  block: LogBlock;
  showAgent: boolean;
}) {
  const agentColor = getAgentColor(block.agentId);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-surface/50 border border-border/50 rounded">
      {showAgent && (
        <span
          className="font-semibold px-1.5 py-0.5 rounded text-xs"
          style={{
            backgroundColor: agentColor + "20",
            color: agentColor,
          }}
        >
          {block.agentId}
        </span>
      )}
      <span>{block.displayTime}</span>
      <span className="text-muted-foreground/60">skipped</span>
      {block.skipReason && (
        <span className="text-muted-foreground/80">{block.skipReason}</span>
      )}
    </div>
  );
}
