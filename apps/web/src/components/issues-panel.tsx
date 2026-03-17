"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Issue {
  number: number;
  title: string;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  "status:ready-for-work": "bg-accent-green/20 text-accent-green",
  "status:in-progress": "bg-accent-blue/20 text-accent-blue",
  "status:needs-review": "bg-accent-magenta/20 text-accent-magenta",
  "status:blocked": "bg-accent-red/20 text-accent-red",
  "status:done": "bg-accent-green/20 text-accent-green",
  "status:planning": "bg-accent-yellow/20 text-accent-yellow",
  "status:ready-for-planning": "bg-accent-yellow/20 text-accent-yellow",
};

const ROLE_COLORS: Record<string, string> = {
  "role:worker": "bg-accent-green/20 text-accent-green",
  "role:planner": "bg-accent-magenta/20 text-accent-magenta",
  "role:super": "bg-accent-yellow/20 text-accent-yellow",
  "role:admin": "bg-accent-orange/20 text-accent-orange",
};

const TYPE_COLORS: Record<string, string> = {
  "type:epic": "bg-accent-cyan/20 text-accent-cyan",
  "type:task": "bg-surface-hover text-text",
  "type:fix": "bg-accent-red/20 text-accent-red",
};

function labelColor(name: string): string {
  return (
    STATUS_COLORS[name] ??
    ROLE_COLORS[name] ??
    TYPE_COLORS[name] ??
    "bg-surface-hover text-text"
  );
}

function playAdminAlert() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, ctx.currentTime);

    // First tone
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    // Second tone (slightly higher)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
    // Fade out
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available — silently ignore
  }
}

function BellIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5A3.5 3.5 0 0 0 4.5 5v2.5c0 .9-.3 1.7-.8 2.4L3 10.8V12h3.5a1.5 1.5 0 0 0 3 0H13v-1.2l-.7-.9c-.5-.7-.8-1.5-.8-2.4V5A3.5 3.5 0 0 0 8 1.5z" />
        <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5A3.5 3.5 0 0 0 4.5 5v2.5c0 .9-.3 1.7-.8 2.4L3 10.8V12h3.5a1.5 1.5 0 0 0 3 0H13v-1.2l-.7-.9c-.5-.7-.8-1.5-.8-2.4V5A3.5 3.5 0 0 0 8 1.5z" />
    </svg>
  );
}

function IssueCard({ issue, repo }: { issue: Issue; repo: string }) {
  const href = repo
    ? `https://github.com/${repo}/issues/${issue.number}`
    : undefined;
  const Wrapper = href ? "a" : "div";

  return (
    <Wrapper
      {...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : {})}
      className="rounded-md bg-surface p-2 border border-border hover:bg-surface-hover transition-colors cursor-pointer block"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-accent-blue font-medium">
          #{issue.number}
        </span>
        <span className="text-base text-text truncate">{issue.title}</span>
      </div>
      <div className="flex flex-wrap gap-1 mt-1 items-center">
        {issue.labels.map((l) => (
          <span
            key={l.name}
            className={`text-xs px-1.5 py-0.5 rounded ${labelColor(l.name)}`}
          >
            {l.name}
          </span>
        ))}
        {issue.assignees.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            @{issue.assignees[0].login}
          </span>
        )}
      </div>
    </Wrapper>
  );
}

export function IssuesPanel() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [repo, setRepo] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("forge-admin-alert-muted") === "true"; } catch { return false; }
  });
  const prevIssuesRef = useRef<Issue[]>([]);
  const initialLoadRef = useRef(true);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const fetchIssues = useCallback(async () => {
    try {
      const res = await fetch("/api/issues");
      const data = await res.json();
      if (data.error) setError(data.error);
      else setError("");
      const newIssues: Issue[] = data.issues ?? [];
      setIssues(newIssues);
      if (data.repo) setRepo(data.repo);

      // Skip alert on initial load
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        prevIssuesRef.current = newIssues;
        return;
      }

      // Detect newly-added role:admin labels
      if (!mutedRef.current) {
        const prevAdminIds = new Set(
          prevIssuesRef.current
            .filter((i) => i.labels.some((l) => l.name === "role:admin"))
            .map((i) => i.number)
        );
        const newAdminIssues = newIssues.filter(
          (i) =>
            i.labels.some((l) => l.name === "role:admin") &&
            !prevAdminIds.has(i.number)
        );
        if (newAdminIssues.length > 0) {
          playAdminAlert();
        }
      }
      prevIssuesRef.current = newIssues;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    }
  }, []);

  useEffect(() => {
    fetchIssues();
    const id = setInterval(fetchIssues, 5000);
    return () => clearInterval(id);
  }, [fetchIssues]);

  useEffect(() => {
    try { localStorage.setItem("forge-admin-alert-muted", String(muted)); } catch {}
  }, [muted]);

  // Collect unique status and role labels present in data
  const statusLabels = [
    ...new Set(
      issues.flatMap((i) =>
        i.labels.filter((l) => l.name.startsWith("status:")).map((l) => l.name)
      )
    ),
  ].sort();
  const roleLabels = [
    ...new Set(
      issues.flatMap((i) =>
        i.labels.filter((l) => l.name.startsWith("role:")).map((l) => l.name)
      )
    ),
  ].sort();

  const toggleFilter = (
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string
  ) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const filtered = issues.filter((issue) => {
    if (statusFilter.size > 0) {
      const has = issue.labels.some(
        (l) => l.name.startsWith("status:") && statusFilter.has(l.name)
      );
      if (!has) return false;
    }
    if (roleFilter.size > 0) {
      const has = issue.labels.some(
        (l) => l.name.startsWith("role:") && roleFilter.has(l.name)
      );
      if (!has) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0 flex-wrap">
        <button
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Unmute admin alerts" : "Mute admin alerts"}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            muted
              ? "text-accent-red"
              : "text-muted-foreground hover:text-text-bright"
          }`}
        >
          <BellIcon muted={muted} />
        </button>
        {statusLabels.map((s) => (
          <button
            key={s}
            onClick={() => toggleFilter(statusFilter, setStatusFilter, s)}
            className={`text-xs px-2 py-0.5 rounded-full cursor-pointer ${
              statusFilter.has(s)
                ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/50"
                : "text-muted-foreground border border-border"
            }`}
          >
            {s}
          </button>
        ))}
        {roleLabels.map((r) => (
          <button
            key={r}
            onClick={() => toggleFilter(roleFilter, setRoleFilter, r)}
            className={`text-xs px-2 py-0.5 rounded-full cursor-pointer ${
              roleFilter.has(r)
                ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/50"
                : "text-muted-foreground border border-border"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="text-accent-red text-xs px-3 py-1 shrink-0">
          {error}
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {filtered.length === 0 && !error ? (
          <p className="text-muted-foreground text-sm pt-3">No issues found.</p>
        ) : (
          <div className="space-y-2 pt-2">
            {filtered.map((issue) => (
              <IssueCard key={issue.number} issue={issue} repo={repo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
