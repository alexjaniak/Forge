"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AgentStatus = "staged" | "active" | "modified" | "orphan";

interface Agent {
  id: string;
  role: string;
  interval: string;
  intervalSeconds: number;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
  overdue: boolean;
  prompt: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
  repo: string;
  status: AgentStatus;
  stagedInterval?: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function countdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

function StatusDot({ running, overdue }: { running: boolean; overdue: boolean }) {
  if (running) {
    return (
      <span
        className="inline-block size-2 rounded-full bg-accent-green"
        title="Running"
      />
    );
  }
  if (overdue) {
    return (
      <span
        className="inline-block size-2 rounded-full bg-accent-yellow"
        title="Overdue"
      />
    );
  }
  return (
    <span
      className="inline-block size-2 rounded-full bg-muted-foreground"
      title="Idle"
    />
  );
}

function RoleBadge({ role }: { role: string }) {
  const color =
    role === "planner"
      ? "text-accent-magenta"
      : role === "worker"
        ? "text-accent-blue"
        : "text-accent-cyan";
  return (
    <span
      className={`${color} text-sm font-medium uppercase tracking-wide`}
    >
      {role}
    </span>
  );
}

const statusBadgeConfig: Record<AgentStatus, { label: string; bg: string }> = {
  staged: { label: "STAGED", bg: "bg-accent-yellow" },
  active: { label: "ACTIVE", bg: "bg-accent-green" },
  modified: { label: "MODIFIED", bg: "bg-accent-yellow" },
  orphan: { label: "ORPHAN", bg: "bg-accent-red" },
};

function StatusBadge({ status, agent }: { status: AgentStatus; agent: Agent }) {
  const config = statusBadgeConfig[status];
  const tooltip =
    status === "modified" && agent.stagedInterval
      ? `interval: ${agent.interval} → ${agent.stagedInterval}`
      : undefined;

  return (
    <span
      className={`${config.bg} text-background text-xs rounded px-1.5 py-0.5 font-medium uppercase tracking-wide`}
      title={tooltip}
    >
      {config.label}
    </span>
  );
}

function AgentCard({
  agent,
  onForceRun,
  onDelete,
}: {
  agent: Agent;
  onForceRun: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tick, setTick] = useState(0);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live countdown ticker — updates every second
  useEffect(() => {
    if (!agent.nextRun) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [agent.nextRun]);

  // Suppress unused var lint — tick drives re-render for countdown
  void tick;

  // Clean up confirm timeout on unmount
  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  const handleForceRun = () => {
    onForceRun(agent.id);
    setFeedback("Started");
    setTimeout(() => setFeedback(null), 2000);
  };

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      confirmTimeoutRef.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    onDelete(agent.id);
    setConfirming(false);
  };

  const isStarted = feedback === "Started";
  const isStaged = agent.status === "staged";

  return (
    <div className="rounded-md bg-surface p-2 border border-border hover:bg-surface-hover transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <StatusDot running={agent.running} overdue={agent.overdue} />
        <span className="text-base text-text-bright truncate flex-1 min-w-0">
          {agent.id}
        </span>
        <RoleBadge role={agent.role} />
        <StatusBadge status={agent.status} agent={agent} />
        <button
          className={`flex-shrink-0 size-5 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            confirming
              ? "bg-accent-red text-background"
              : "bg-surface-hover text-muted-foreground hover:bg-accent-red hover:text-background"
          }`}
          onClick={handleDelete}
          title={confirming ? "Click again to confirm delete" : "Delete agent"}
        >
          {confirming ? "?" : "\u2212"}
        </button>
      </div>

      <div className="flex items-center gap-3 text-sm text-text ml-4 mb-2">
        <span title="Interval">{agent.interval}</span>
        {agent.status === "modified" && agent.stagedInterval && (
          <span className="text-accent-yellow" title="Pending interval change">
            → {agent.stagedInterval}
          </span>
        )}
        {agent.lastRun && (
          <span title={`Last run: ${agent.lastRun}`}>
            {relativeTime(agent.lastRun)}
          </span>
        )}
        {agent.nextRun && (
          <span className="text-accent-cyan" title={`Next run: ${agent.nextRun}`}>
            {countdown(agent.nextRun)}
          </span>
        )}
      </div>

      <div className="flex justify-end mr-1">
        <button
          className={`text-xs rounded px-2 py-0.5 border transition-colors ${
            isStaged
              ? "text-muted-foreground bg-surface border-border cursor-not-allowed opacity-50"
              : isStarted
                ? "text-accent-green bg-accent-green/10 border-accent-green/20"
                : "text-accent-green bg-surface-hover hover:bg-accent-green/20 border-border"
          }`}
          onClick={isStaged ? undefined : handleForceRun}
          disabled={isStaged}
          title={isStaged ? "Apply config first to run this agent" : undefined}
        >
          {feedback ?? "\u25B6 Run"}
        </button>
      </div>
    </div>
  );
}

const statusOrder: Record<AgentStatus, number> = {
  active: 0,
  modified: 1,
  staged: 2,
  orphan: 3,
};

function sortAgentsByStatus(agents: Agent[]): Agent[] {
  return [...agents].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status]
  );
}

interface Template {
  type: string;
  interval: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
}

function AddAgentModal({
  onClose,
  onAdded,
  agents,
}: {
  onClose: () => void;
  onAdded: () => void;
  agents: Agent[];
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [customId, setCustomId] = useState("");
  const [interval, setInterval] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => {
        const tpls: Template[] = (data.templates ?? []).sort(
          (a: Template, b: Template) => a.type.localeCompare(b.type)
        );
        setTemplates(tpls);
        if (tpls.length > 0) {
          const worker = tpls.find((t) => t.type === "worker");
          const initial = worker ?? tpls[0];
          setSelected(initial);
          setInterval(initial.interval);
        }
      })
      .catch(() => setError("Failed to load templates"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const selectTemplate = (tpl: Template) => {
    setSelected(tpl);
    setInterval(tpl.interval);
    setCustomId("");
    setError(null);
  };

  const autoId = selected
    ? (() => {
        const prefix = selected.type;
        const existing = agents
          .filter((a) => a.role === prefix)
          .map((a) => {
            const match = a.id.match(new RegExp(`^${prefix}-(\\d+)$`));
            return match ? parseInt(match[1], 10) : 0;
          });
        const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
        return `${prefix}-${String(next).padStart(2, "0")}`;
      })()
    : "";

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = { type: selected.type };
      if (customId.trim()) body.id = customId.trim();
      if (interval.trim()) body.interval = interval.trim();
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onAdded();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
      }
    } catch {
      setError("Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface border border-border rounded-lg p-4 w-96 max-w-[90vw] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-text-bright text-base font-medium">Add Agent</h2>
          <button
            className="text-muted-foreground hover:text-text-bright transition-colors text-lg leading-none px-1"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {loading && (
          <p className="text-muted-foreground text-sm">Loading templates…</p>
        )}

        {!loading && templates.length === 0 && (
          <p className="text-muted-foreground text-sm">No templates found</p>
        )}

        {!loading && templates.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              {templates.map((tpl) => (
                <button
                  key={tpl.type}
                  className={`flex-1 min-w-[80px] rounded-md border p-2 text-left transition-colors ${
                    selected?.type === tpl.type
                      ? "border-accent-cyan bg-accent-cyan/10"
                      : "border-border bg-background hover:bg-surface-hover"
                  }`}
                  onClick={() => selectTemplate(tpl)}
                >
                  <div className="text-text-bright text-sm font-medium capitalize">
                    {tpl.type}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {tpl.interval}
                  </div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-muted-foreground text-xs block mb-1">
                    Auto ID
                  </label>
                  <div className="bg-background border border-border rounded px-2 py-1 text-sm text-muted-foreground">
                    {autoId}
                  </div>
                </div>

                <div>
                  <label className="text-muted-foreground text-xs block mb-1">
                    Custom ID (optional)
                  </label>
                  <input
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-text focus:border-accent-cyan outline-none transition-colors"
                    placeholder={autoId}
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-muted-foreground text-xs block mb-1">
                    Interval
                  </label>
                  <input
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-text focus:border-accent-cyan outline-none transition-colors"
                    placeholder={selected.interval}
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                  />
                </div>

                {selected.contexts.length > 0 && (
                  <div>
                    <label className="text-muted-foreground text-xs block mb-1">
                      Context files
                    </label>
                    <div className="bg-background border border-border rounded px-2 py-1 text-xs text-muted-foreground max-h-20 overflow-y-auto">
                      {selected.contexts.map((ctx, i) => (
                        <div key={i} className="truncate">{ctx}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="text-accent-red text-xs mt-2">{error}</p>
            )}

            <div className="flex justify-end mt-3">
              <button
                className="text-xs rounded px-3 py-1 border border-accent-green text-accent-green hover:bg-accent-green/20 transition-colors disabled:opacity-50"
                onClick={handleSubmit}
                disabled={submitting || !selected}
              >
                {submitting ? "Adding…" : "Add Agent"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function AgentPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [clearConfirming, setClearConfirming] = useState(false);
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mountedRef.current) {
        setAgents(data.agents ?? []);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch agents");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAgents();
    const id = setInterval(fetchAgents, 5000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
    };
  }, [fetchAgents]);

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3000);
  };

  const handleForceRun = async (agentId: string) => {
    try {
      await fetch(`/api/agents/${agentId}/force-run`, { method: "POST" });
    } catch {
      // best-effort
    }
  };

  const handleDelete = async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
      }
    } catch {
      // best-effort
    }
  };

  const handleApply = async () => {
    try {
      const res = await fetch("/api/agents/apply", { method: "POST" });
      const data = await res.json();
      showFeedback(data.ok ? "Applied" : `Error: ${data.error || data.stderr}`);
      fetchAgents();
    } catch {
      showFeedback("Apply failed");
    }
  };

  const handleClear = async () => {
    if (!clearConfirming) {
      setClearConfirming(true);
      clearTimeoutRef.current = setTimeout(() => setClearConfirming(false), 3000);
      return;
    }
    if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
    setClearConfirming(false);
    try {
      const res = await fetch("/api/agents/clear", { method: "POST" });
      const data = await res.json();
      showFeedback(data.ok ? `Cleared ${data.removed} agent(s)` : "Clear failed");
      fetchAgents();
    } catch {
      showFeedback("Clear failed");
    }
  };

  const stagedCount = agents.filter(
    (a) => a.status === "staged" || a.status === "modified"
  ).length;
  const orphanCount = agents.filter((a) => a.status === "orphan").length;
  const hasPendingChanges = stagedCount > 0 || orphanCount > 0;
  const hasStagedAgents = agents.filter((a) => a.status !== "orphan").length > 0;

  return (
    <div className="h-full bg-surface px-3 pb-3 overflow-y-auto flex flex-col">
      <div className="flex items-center gap-2 py-2">
        <button
          className="text-xs rounded px-2 py-1 border border-border text-text hover:bg-surface-hover transition-colors"
          onClick={() => setShowModal(true)}
        >
          + Add
        </button>
        <button
          className={`text-xs rounded px-2 py-1 border transition-colors ${
            hasPendingChanges
              ? "border-accent-green text-accent-green hover:bg-accent-green/20"
              : "border-border text-muted-foreground cursor-not-allowed opacity-50"
          }`}
          onClick={hasPendingChanges ? handleApply : undefined}
          disabled={!hasPendingChanges}
          title={hasPendingChanges ? "Apply staged config" : "No pending changes"}
        >
          Apply
        </button>
        <button
          className={`text-xs rounded px-2 py-1 border transition-colors ${
            !hasStagedAgents
              ? "border-border text-muted-foreground cursor-not-allowed opacity-50"
              : clearConfirming
                ? "border-accent-red bg-accent-red text-background"
                : "border-accent-red text-accent-red hover:bg-accent-red/20"
          }`}
          onClick={hasStagedAgents ? handleClear : undefined}
          disabled={!hasStagedAgents}
          title={
            !hasStagedAgents
              ? "No staged agents"
              : clearConfirming
                ? "Click again to confirm"
                : "Clear all staged config"
          }
        >
          {clearConfirming ? "Confirm?" : "Clear"}
        </button>
        {actionFeedback && (
          <span className="text-xs text-accent-cyan ml-auto">{actionFeedback}</span>
        )}
      </div>

      {showModal && (
        <AddAgentModal
          onClose={() => setShowModal(false)}
          onAdded={fetchAgents}
          agents={agents}
        />
      )}

      {error && (
        <p className="text-accent-red text-sm mb-2">{error}</p>
      )}

      {agents.length === 0 && !error ? (
        <p className="text-muted-foreground text-sm">No agents configured</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sortAgentsByStatus(agents).map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onForceRun={handleForceRun}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
