"use client";

import type { Status } from "@/types";

interface TriageButtonsProps {
  status: Status;
  onKeep: () => void;
  onPurge: () => void;
}

export function TriageButtons({ status, onKeep, onPurge }: TriageButtonsProps) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onKeep}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          status === "keep"
            ? "bg-keep text-white"
            : "border border-border text-text-secondary hover:border-keep hover:text-keep"
        }`}
      >
        Keep
      </button>
      <button
        onClick={onPurge}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          status === "purge"
            ? "bg-purge text-white"
            : "border border-border text-text-secondary hover:border-purge hover:text-purge"
        }`}
      >
        Purge
      </button>
    </div>
  );
}
