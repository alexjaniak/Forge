"use client";

import { useState } from "react";
import { AgentPanel } from "@/components/agent-panel";
import { LogsPanel } from "@/components/logs-panel";
import { EventsPanel } from "@/components/events-panel";
import { ResizableLayout } from "@/components/resizable-layout";

type Tab = "logs" | "events";

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

function RightPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("logs");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-0 bg-surface border-b border-border shrink-0">
        <TabButton
          label="Logs"
          active={activeTab === "logs"}
          onClick={() => setActiveTab("logs")}
        />
        <TabButton
          label="Events"
          active={activeTab === "events"}
          onClick={() => setActiveTab("events")}
        />
      </div>

      {/* Active panel */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === "logs" ? <LogsPanel /> : <EventsPanel />}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <ResizableLayout
      sidebar={<AgentPanel />}
      rightPanel={<RightPanel />}
    />
  );
}
