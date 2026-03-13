"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "dacl-panel-sizes";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 500;
const HANDLE_SIZE = 4;
const SIDEBAR_COLLAPSE_THRESHOLD = 120; // px — below this, auto-collapse

interface PanelSizes {
  sidebarWidth: number;
}

function loadSizes(): PanelSizes {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        sidebarWidth: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed.sidebarWidth ?? 300)),
      };
    }
  } catch {
    // ignore
  }
  return { sidebarWidth: 300 };
}

function saveSizes(sizes: PanelSizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // ignore
  }
}

export function ResizableLayout({
  sidebar,
  rightPanel,
}: {
  sidebar: ReactNode;
  rightPanel: ReactNode;
}) {
  const [sizes, setSizes] = useState<PanelSizes>({ sidebarWidth: 300 });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Load sizes from localStorage after mount
  useEffect(() => {
    const loaded = loadSizes();
    setSizes(loaded);
    setHydrated(true);
  }, []);

  // Persist sizes on change
  useEffect(() => {
    if (hydrated && !sidebarCollapsed) {
      saveSizes(sizes);
    }
  }, [sizes, hydrated, sidebarCollapsed]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const rawWidth = e.clientX - rect.left;
      if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
      } else {
        const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, rawWidth));
        setSizes((prev) => ({ ...prev, sidebarWidth: newWidth }));
        setSidebarCollapsed(false);
      }
    },
    []
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const sidebarWidth = sidebarCollapsed ? 0 : sizes.sidebarWidth;

  return (
    <div
      ref={containerRef}
      className={`h-screen w-screen overflow-hidden flex bg-border${dragging ? " select-none" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: dragging ? "col-resize" : undefined }}
    >
      {/* Sidebar */}
      {sidebarCollapsed ? (
        <div
          className="bg-surface flex items-center justify-center shrink-0 cursor-pointer hover:bg-surface-hover transition-colors gap-1"
          style={{ width: 36 }}
          onClick={() => setSidebarCollapsed(false)}
        >
          <span className="text-muted-foreground text-xs uppercase tracking-widest [writing-mode:vertical-lr]">
            ▶ Agents
          </span>
        </div>
      ) : (
        <div
          className="overflow-hidden shrink-0 flex flex-col"
          style={{ width: sidebarWidth }}
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-1 shrink-0">
            <h2 className="text-text-bright font-semibold text-sm uppercase tracking-wide">Agents</h2>
            <button
              className="text-muted-foreground hover:text-text-bright text-sm px-1"
              onClick={() => setSidebarCollapsed(true)}
              title="Collapse sidebar"
            >
              ◀
            </button>
          </div>
          <div className="flex-1 overflow-hidden">{sidebar}</div>
        </div>
      )}

      {/* Vertical resize handle */}
      <div
        className="shrink-0 bg-border hover:bg-accent-blue transition-colors"
        style={{ width: HANDLE_SIZE, cursor: "col-resize" }}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />

      {/* Right panel */}
      <div className="flex-1 min-w-0 overflow-hidden bg-background">
        {rightPanel}
      </div>
    </div>
  );
}
