"use client";

import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "react";
import { LogBlock, LogParserState, parseLogBlocks } from "@/lib/log-parser";
import { getAgentColor } from "@/lib/colors";

const MAX_BLOCKS = 200;
const POLL_INTERVAL = 5000; // Fallback polling interval (only used when SSE drops)
const STORAGE_KEY = "forge-log-agent-filter";
const COLLAPSED_HEIGHT = 144;

interface AgentOffset {
  [agentId: string]: number;
}

type AgentParserState = Record<string, LogParserState>;
type AgentFilterState = Record<string, boolean>;

function loadFilterState(): AgentFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveFilterState(state: AgentFilterState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function getRole(agentId: string): string | null {
  const match = agentId.match(/^(worker|planner|super)/);
  return match ? match[1] : null;
}

const ROLES = ["worker", "planner", "super"] as const;
const ROLE_COLORS: Record<string, string> = {
  worker: "var(--accent-green)",
  planner: "var(--accent-magenta)",
  super: "var(--accent-yellow)",
};

export function LogsPanel({ refreshKey }: { refreshKey?: number }) {
  const [blocks, setBlocks] = useState<LogBlock[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [agentFilter, setAgentFilter] = useState<AgentFilterState>(loadFilterState);
  const [filterOpen, setFilterOpen] = useState(false);

  const offsetsRef = useRef<AgentOffset>({});
  const parserStatesRef = useRef<AgentParserState>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const prevScrollTop = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveFilterState(agentFilter);
  }, [agentFilter]);

  useEffect(() => {
    setAgentFilter((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of agents) {
        if (!(id in next)) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [agents]);

  useEffect(() => {
    if (!filterOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterOpen]);

  const isAgentVisible = useCallback(
    (agentId: string) => agentFilter[agentId] !== false,
    [agentFilter]
  );

  const toggleAgent = useCallback((agentId: string) => {
    setAgentFilter((prev) => {
      const next = { ...prev };
      next[agentId] = prev[agentId] === false ? true : false;
      return next;
    });
  }, []);

  const toggleRole = useCallback(
    (role: string) => {
      const roleAgents = agents.filter((a) => getRole(a) === role);
      if (roleAgents.length === 0) return;
      const allVisible = roleAgents.every((a) => agentFilter[a] !== false);
      setAgentFilter((prev) => {
        const next = { ...prev };
        for (const a of roleAgents) {
          next[a] = !allVisible;
        }
        return next;
      });
    },
    [agents, agentFilter]
  );

  const hiddenCount = agents.filter((a) => agentFilter[a] === false).length;

  // Merge new blocks into state
  const mergeBlocks = useCallback(
    (newBlocks: LogBlock[]) => {
      if (newBlocks.length === 0) return;
      setBlocks((prev) => {
        const blockMap = new Map<string, LogBlock>();
        for (const b of prev) {
          blockMap.set(b.key, b);
        }
        let changed = false;
        for (const b of newBlocks) {
          const existing = blockMap.get(b.key);
          if (
            !existing ||
            existing.type !== b.type ||
            existing.content !== b.content ||
            existing.skipReason !== b.skipReason ||
            existing.duration !== b.duration ||
            existing.exitCode !== b.exitCode
          ) {
            blockMap.set(b.key, b);
            changed = true;
          }
        }
        if (!changed) return prev;
        const merged = Array.from(blockMap.values());
        merged.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() -
            new Date(b.timestamp).getTime()
        );
        return merged.slice(-MAX_BLOCKS);
      });
    },
    []
  );

  // Initial load via existing GET endpoint
  const fetchInitialLogs = useCallback(async () => {
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
        const parsed = parseLogBlocks(result.agentId, result.data, {
          finalize: true,
        });
        newBlocks.push(...parsed.blocks);
        parserStatesRef.current[result.agentId] = parsed.state;
      }
      offsetsRef.current[result.agentId] = result.offset;
    }
    mergeBlocks(newBlocks);
  }, [agents, mergeBlocks]);

  // Fallback polling fetch (incremental)
  const fetchLogsPoll = useCallback(async () => {
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
        const parsed = parseLogBlocks(result.agentId, result.data, {
          state: parserStatesRef.current[result.agentId],
        });
        newBlocks.push(...parsed.blocks);
        parserStatesRef.current[result.agentId] = parsed.state;
      }
      offsetsRef.current[result.agentId] = result.offset;
    }
    mergeBlocks(newBlocks);
  }, [agents, mergeBlocks]);

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
    setBlocks([]);
    offsetsRef.current = {};
    parserStatesRef.current = {};

    fetchInitialLogs();

    const es = new EventSource("/api/logs/stream");
    eventSourceRef.current = es;

    es.addEventListener("log", (event) => {
      const { agentId, data, offset } = JSON.parse(event.data);
      if (data) {
        const parsed = parseLogBlocks(agentId, data, {
          state: parserStatesRef.current[agentId],
        });
        mergeBlocks(parsed.blocks);
        parserStatesRef.current[agentId] = parsed.state;
      }
      offsetsRef.current[agentId] = offset;

      setAgents((prev) => {
        if (prev.includes(agentId)) return prev;
        const next = [...prev, agentId];
        next.sort();
        return next;
      });
    });

    es.onerror = () => {
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
  }, [mergeBlocks, startFallbackPolling, stopFallbackPolling]);

  // Manual refresh via refreshKey
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      fetchInitialLogs();
    }
  }, [refreshKey, fetchInitialLogs]);

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

  const displayBlocks = blocks.filter((b) => {
    if (!isAgentVisible(b.agentId)) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        b.content.toLowerCase().includes(q) ||
        (b.skipReason && b.skipReason.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className="text-muted-foreground hover:text-text-bright text-sm px-2 py-1 rounded border border-border flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2h14l-5.5 6.5V14l-3-2V8.5L1 2z" />
            </svg>
            Agents
            {hiddenCount > 0 && (
              <span className="text-xs bg-accent-blue/20 text-accent-blue px-1.5 rounded-full">
                {agents.length - hiddenCount}/{agents.length}
              </span>
            )}
          </button>
          {filterOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md shadow-lg min-w-[200px]">
              {ROLES.some((r) => agents.some((a) => getRole(a) === r)) && (
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
                  {ROLES.map((role) => {
                    const roleAgents = agents.filter((a) => getRole(a) === role);
                    if (roleAgents.length === 0) return null;
                    const allVisible = roleAgents.every((a) => agentFilter[a] !== false);
                    return (
                      <button
                        key={role}
                        onClick={() => toggleRole(role)}
                        className="text-xs px-2 py-0.5 rounded-full border transition-colors"
                        style={{
                          borderColor: ROLE_COLORS[role],
                          backgroundColor: allVisible ? ROLE_COLORS[role] + "30" : "transparent",
                          color: ROLE_COLORS[role],
                          opacity: allVisible ? 1 : 0.5,
                        }}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="py-1 max-h-[240px] overflow-y-auto">
                {agents.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No agents</div>
                ) : (
                  agents.map((agentId) => {
                    const color = getAgentColor(agentId);
                    const visible = agentFilter[agentId] !== false;
                    return (
                      <button
                        key={agentId}
                        onClick={() => toggleAgent(agentId)}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-surface-hover transition-colors"
                      >
                        <span
                          className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                          style={{
                            borderColor: visible ? "var(--accent-blue)" : "var(--color-border)",
                            backgroundColor: visible ? "var(--accent-blue)" : "transparent",
                          }}
                        >
                          {visible && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5">
                              <path d="M2 5l2 2 4-4" />
                            </svg>
                          )}
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-text truncate">{agentId}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-surface-hover text-text text-sm px-2 py-1 rounded border border-border outline-none focus:border-accent-blue w-40 shrink-0"
        />
      </div>

      {/* Log cards */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="dashboard-scrollbar [--dashboard-scrollbar-surface:var(--background)] flex-1 overflow-y-auto p-4 space-y-2"
      >
        {displayBlocks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">No logs yet</p>
          </div>
        ) : (
          displayBlocks.map((block) =>
            block.type === "skip" ? (
              <SkipCard key={block.key} block={block} />
            ) : (
              <LogCard key={block.key} block={block} />
            )
          )
        )}
      </div>
    </div>
  );
}

function LogCard({ block }: { block: LogBlock }) {
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
    <div
      className="bg-surface border border-border rounded-md p-3 border-l-2"
      style={{ borderLeftColor: agentColor }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center text-sm font-semibold px-2 py-0.5 rounded"
          style={{
            backgroundColor: agentColor + "26",
            color: agentColor,
            border: `1px solid ${agentColor}4D`,
          }}
        >
          {block.agentId}
        </span>
        <span className="text-sm text-muted-foreground">{block.displayTime}</span>
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

function SkipCard({ block }: { block: LogBlock }) {
  const agentColor = getAgentColor(block.agentId);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-surface/50 border border-border/50 rounded">
      <span
        className="font-semibold px-1.5 py-0.5 rounded text-xs"
        style={{
          backgroundColor: agentColor + "20",
          color: agentColor,
        }}
      >
        {block.agentId}
      </span>
      <span>{block.displayTime}</span>
      <span className="text-muted-foreground/60">skipped</span>
      {block.skipReason && (
        <span className="text-muted-foreground/80">{block.skipReason}</span>
      )}
    </div>
  );
}
