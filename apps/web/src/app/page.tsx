"use client";

import { useState, useCallback } from "react";
import { AgentPanel } from "@/components/agent-panel";
import { LogsPanel } from "@/components/logs-panel";
import { EventsPanel } from "@/components/events-panel";
import { IssuesPanel } from "@/components/issues-panel";
import { ResizableLayout } from "@/components/resizable-layout";

type Tab = "logs" | "events" | "issues";

const VALID_TABS: Tab[] = ["logs", "events", "issues"];

function getInitialTab(): Tab {
  if (typeof window === "undefined") return "logs";
  const hash = window.location.hash.replace("#", "");
  return VALID_TABS.includes(hash as Tab) ? (hash as Tab) : "logs";
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
        active
          ? "text-text-bright border-accent-blue"
          : "text-muted-foreground border-transparent hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  const [spinning, setSpinning] = useState(false);

  const handleClick = () => {
    setSpinning(true);
    onClick();
    setTimeout(() => setSpinning(false), 500);
  };

  return (
    <button
      onClick={handleClick}
      className="text-muted-foreground hover:text-text-bright transition-colors p-1"
      title="Refresh all panels"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spinning ? "animate-spin-once" : ""}
      >
        <path d="M14 2v4h-4" />
        <path d="M2 14v-4h4" />
        <path d="M13.5 6A6 6 0 0 0 3.8 3.8L2 6" />
        <path d="M2.5 10a6 6 0 0 0 9.7 2.2L14 10" />
      </svg>
    </button>
  );
}

function RightPanel({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-1 bg-surface border-b border-border shrink-0">
        <TabButton
          label="Logs"
          active={activeTab === "logs"}
          onClick={() => switchTab("logs")}
        />
        <TabButton
          label="Events"
          active={activeTab === "events"}
          onClick={() => switchTab("events")}
        />
        <TabButton
          label="Issues"
          active={activeTab === "issues"}
          onClick={() => switchTab("issues")}
        />
        <div className="ml-auto">
          <RefreshButton onClick={onRefresh} />
        </div>
      </div>

      {/* Active panel */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === "logs" ? (
          <LogsPanel refreshKey={refreshKey} />
        ) : activeTab === "events" ? (
          <EventsPanel refreshKey={refreshKey} />
        ) : (
          <IssuesPanel refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);
  const handleRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <ResizableLayout
      sidebar={<AgentPanel refreshKey={refreshKey} />}
      rightPanel={<RightPanel refreshKey={refreshKey} onRefresh={handleRefresh} />}
    />
  );
}
