import React from "react";
import { cn } from "./cn";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabStripProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  /** "segmented": a row of bordered, full-height buttons with the selected one
   *  filled, for a strip that must read as tappable on a phone (the item
   *  screen's Defects · Info · Limits · Notes). It also carries the tablist
   *  roles; the default underline strip keeps its plain-button markup so its
   *  other callers and their tests see no change. */
  variant?: "underline" | "segmented";
}

export function TabStrip({ tabs, activeId, onChange, orientation = "horizontal", variant = "underline" }: TabStripProps) {
  if (variant === "segmented") return <SegmentedTabs tabs={tabs} activeId={activeId} onChange={onChange} />;
  const vertical = orientation === "vertical";
  return (
    <div
      className={cn(
        vertical
          ? "flex flex-col items-stretch border-l border-ih-border"
          : "flex flex-wrap items-center border-b border-ih-border",
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={
            vertical
              ? `inline-flex items-center gap-1.5 px-3.5 py-2 pointer-coarse:min-h-11 border-l-2 -ml-px text-[13px] font-bold transition-all text-left ${
                  activeId === tab.id
                    ? "border-ih-primary text-ih-primary-text"
                    : "border-transparent text-ih-fg-3 hover:text-ih-fg-1"
                }`
              : `inline-flex items-center gap-1.5 px-3.5 py-2.5 pointer-coarse:min-h-11 border-b-2 text-[13px] font-bold transition-all ${
                  activeId === tab.id
                    ? "border-ih-primary text-ih-primary-text"
                    : "border-transparent text-ih-fg-3 hover:text-ih-fg-1"
                }`
          }
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${
              activeId === tab.id
                ? "bg-ih-primary-tint text-ih-primary-text"
                : "bg-ih-bg-muted text-ih-fg-2"
            }`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function SegmentedTabs({ tabs, activeId, onChange }: Pick<TabStripProps, "tabs" | "activeId" | "onChange">) {
  return (
    <div role="tablist" className="flex items-stretch gap-1.5">
      {tabs.map((tab) => {
        const on = activeId === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`flex-auto min-w-0 min-h-11 px-2 inline-flex items-center justify-center gap-1.5 rounded-md border text-[14px] font-bold transition-colors ${
              on
                ? "bg-ih-primary border-ih-primary text-ih-primary-fg"
                : "bg-ih-bg-card border-ih-border-strong text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary-text"
            }`}
          >
            <span className="truncate">{tab.label}</span>
            {tab.count !== undefined && (
              <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[12px] font-bold tabular-nums ${
                on ? "bg-ih-bg-card text-ih-primary-text" : "bg-ih-bg-muted text-ih-fg-2"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
