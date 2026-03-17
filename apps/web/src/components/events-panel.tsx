"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface NormalizedEvent {
  timestamp: string;
  event_type: string;
  repo: string;
  number: number;
  actor: string;
  summary: string;
  raw_action: string;
  labels: string[];
}

const MAX_DISPLAY = 50;

function actionColor(action: string): string {
  switch (action) {
    case "opened":
    case "created":
      return "bg-accent-green text-background";
    case "closed":
    case "deleted":
      return "bg-accent-red text-background";
    case "merged":
      return "bg-accent-magenta text-background";
    case "labeled":
    case "unlabeled":
      return "bg-accent-yellow text-background";
    case "commented":
    case "submitted":
      return "bg-accent-blue text-background";
    default:
      return "bg-muted-foreground text-background";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function EventCard({ event }: { event: NormalizedEvent }) {
  return (
    <div className="rounded-md bg-surface p-2 border border-border">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {formatTime(event.timestamp)}
        </span>
        <span
          className={`text-sm font-medium px-1.5 py-0.5 rounded ${actionColor(event.raw_action)}`}
        >
          {event.raw_action}
        </span>
        {event.number > 0 && (
          <span className="text-sm text-accent-blue">
            #{event.number}
          </span>
        )}
        <span className="text-sm text-muted-foreground">{event.actor}</span>
      </div>
      <p className="text-base text-text ml-0.5 mb-1">
        {truncate(event.summary, 100)}
      </p>
      {event.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 ml-0.5">
          {event.labels.map((label) => (
            <span
              key={label}
              className="text-sm px-1.5 py-0.5 rounded bg-surface-hover text-text"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventsPanel({ refreshKey }: { refreshKey?: number }) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const totalRef = useRef(0);
  const mountedRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevScrollTop = useRef(0);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/events?offset=0`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mountedRef.current) {
        const fetched: NormalizedEvent[] = data.events ?? [];
        setEvents(fetched.slice(-MAX_DISPLAY));
        totalRef.current = data.total ?? 0;
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch events");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchEvents();
    const id = setInterval(fetchEvents, 3000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchEvents]);

  // Manual refresh via refreshKey
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      fetchEvents();
    }
  }, [refreshKey, fetchEvents]);

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

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  return (
    <div className="bg-surface px-3 pb-3 flex flex-col h-full min-h-0">
      {error && <p className="text-accent-red text-xs mb-2 shrink-0">{error}</p>}

      {events.length === 0 && !error ? (
        <p className="text-muted-foreground text-sm">No events yet.</p>
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="dashboard-scrollbar flex flex-col gap-2 flex-1 overflow-y-auto min-h-0"
        >
          {events.map((event, i) => (
            <EventCard key={`${event.timestamp}-${i}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
