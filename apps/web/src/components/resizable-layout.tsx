"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "forge-panel-sizes";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 500;
const PANEL_MIN = 100;
const HANDLE_SIZE = 4;
const SIDEBAR_COLLAPSE_THRESHOLD = 120; // px — below this, auto-collapse
const EVENTS_COLLAPSE_THRESHOLD = 60;   // px — below this, auto-collapse

interface PanelSizes {
  sidebarWidth: number;
  topRightRatio: number; // 0-1, fraction of right area used by top panel
}

interface CollapsedState {
  sidebar: boolean;
  bottom: boolean;
}

function loadSizes(): PanelSizes {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        sidebarWidth: Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed.sidebarWidth ?? 300)),
        topRightRatio: Math.max(0.1, Math.min(0.9, parsed.topRightRatio ?? 0.7)),
      };
    }
  } catch {
    // ignore
  }
  return { sidebarWidth: 300, topRightRatio: 0.7 };
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
  topRight,
  bottomRight,
}: {
  sidebar: ReactNode;
  topRight: ReactNode;
  bottomRight: ReactNode;
}) {
  const [sizes, setSizes] = useState<PanelSizes>({ sidebarWidth: 300, topRightRatio: 0.7 });
  const [collapsed, setCollapsed] = useState<CollapsedState>({ sidebar: false, bottom: false });
  const [hydrated, setHydrated] = useState(false);

  const [dragging, setDragging] = useState<"vertical" | "horizontal" | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"vertical" | "horizontal" | null>(null);
  const sizesBeforeCollapseRef = useRef<PanelSizes>(sizes);

  // Load sizes from localStorage after mount
  useEffect(() => {
    const loaded = loadSizes();
    setSizes(loaded);
    sizesBeforeCollapseRef.current = loaded;
    setHydrated(true);
  }, []);

  // Persist sizes on change
  useEffect(() => {
    if (hydrated && !collapsed.sidebar && !collapsed.bottom) {
      saveSizes(sizes);
      sizesBeforeCollapseRef.current = sizes;
    }
  }, [sizes, hydrated, collapsed]);

  const handlePointerDown = useCallback(
    (axis: "vertical" | "horizontal") => (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = axis;
      setDragging(axis);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();

      if (draggingRef.current === "vertical") {
        const rawWidth = e.clientX - rect.left;
        if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
          setCollapsed((prev) => ({ ...prev, sidebar: true }));
        } else {
          const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, rawWidth));
          setSizes((prev) => ({ ...prev, sidebarWidth: newWidth }));
          setCollapsed((prev) => (prev.sidebar ? { ...prev, sidebar: false } : prev));
        }
      } else if (draggingRef.current === "horizontal") {
        const rightHeight = rect.height;
        const relativeY = e.clientY - rect.top;
        const bottomPx = rightHeight - relativeY - HANDLE_SIZE;
        if (bottomPx < EVENTS_COLLAPSE_THRESHOLD) {
          setCollapsed((prev) => ({ ...prev, bottom: true }));
        } else {
          const ratio = Math.max(0.1, Math.min(0.9, relativeY / rightHeight));
          const topPx = ratio * rightHeight;
          const clampedBottomPx = rightHeight - topPx - HANDLE_SIZE;
          if (topPx >= PANEL_MIN && clampedBottomPx >= PANEL_MIN) {
            setSizes((prev) => ({ ...prev, topRightRatio: ratio }));
          }
          setCollapsed((prev) => (prev.bottom ? { ...prev, bottom: false } : prev));
        }
      }
    },
    [collapsed.sidebar, sizes.sidebarWidth]
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
  }, []);

  const handleDoubleClickVertical = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev.sidebar) {
        return { ...prev, sidebar: true };
      }
      return { ...prev, sidebar: false };
    });
  }, []);

  const handleDoubleClickHorizontal = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev.bottom) {
        return { ...prev, bottom: true };
      }
      return { ...prev, bottom: false };
    });
  }, []);

  const sidebarWidth = collapsed.sidebar ? 0 : sizes.sidebarWidth;

  return (
    <div
      ref={containerRef}
      className={`h-screen w-screen overflow-hidden flex bg-border${dragging ? " select-none" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: dragging === "vertical" ? "col-resize" : dragging === "horizontal" ? "row-resize" : undefined }}
    >
      {/* Sidebar */}
      {collapsed.sidebar ? (
        <div
          className="bg-surface flex items-center justify-center shrink-0 cursor-pointer hover:bg-surface-hover transition-colors gap-1"
          style={{ width: 36 }}
          onClick={() => setCollapsed((prev) => ({ ...prev, sidebar: false }))}
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
              onClick={() => setCollapsed((prev) => ({ ...prev, sidebar: true }))}
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
        onPointerDown={handlePointerDown("vertical")}
        onDoubleClick={handleDoubleClickVertical}
      />

      {/* Right area: top + handle + bottom */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top right (Logs) */}
        {collapsed.bottom ? (
          <div className="flex-1 overflow-hidden bg-background">
            {topRight}
          </div>
        ) : (
          <div
            className="overflow-hidden bg-background"
            style={{ flex: `0 0 calc(${sizes.topRightRatio * 100}% - ${HANDLE_SIZE / 2}px)` }}
          >
            {topRight}
          </div>
        )}

        {/* Horizontal resize handle */}
        {collapsed.bottom ? (
          <div
            className="shrink-0 bg-surface flex items-center justify-center cursor-pointer hover:bg-surface-hover transition-colors"
            style={{ height: 24 }}
            onClick={() => setCollapsed((prev) => ({ ...prev, bottom: false }))}
          >
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              ▲ Events
            </span>
          </div>
        ) : (
          <div
            className="shrink-0 bg-border hover:bg-accent-blue transition-colors"
            style={{ height: HANDLE_SIZE, cursor: "row-resize" }}
            onPointerDown={handlePointerDown("horizontal")}
            onDoubleClick={handleDoubleClickHorizontal}
          />
        )}

        {/* Bottom right (Events) */}
        {!collapsed.bottom && (
          <div
            className="overflow-hidden flex flex-col min-h-0"
            style={{ flex: `0 0 calc(${(1 - sizes.topRightRatio) * 100}% - ${HANDLE_SIZE / 2}px)` }}
          >
            <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0 bg-surface">
              <h2 className="text-text-bright font-semibold text-sm uppercase tracking-wide">Events</h2>
              <button
                className="text-muted-foreground hover:text-text-bright text-sm px-1"
                onClick={() => setCollapsed((prev) => ({ ...prev, bottom: true }))}
                title="Collapse events"
              >
                ▼
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">{bottomRight}</div>
          </div>
        )}
      </div>
    </div>
  );
}
