"use client";

import { cn } from "@/utils/cn";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void | Promise<void>;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function Switch({ checked, onCheckedChange, label, description, disabled, className }: SwitchProps) {
  const toggle = (
    <span
      className={cn(
        "relative h-6 w-11 rounded-full transition shrink-0",
        checked ? "bg-cyan-glow" : "bg-slate-700",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-4 w-4 rounded-full bg-white transition",
          checked ? "left-6" : "left-1"
        )}
      />
    </span>
  );

  if (!label) {
    return checked ? (
      <button
        type="button"
        role="switch"
        aria-checked="true"
        aria-label="Toggle"
        data-state="checked"
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(false)}
        className={cn("focus:outline-none transition-opacity", disabled && "opacity-50 cursor-not-allowed", className)}
      >
        {toggle}
      </button>
    ) : (
      <button
        type="button"
        role="switch"
        aria-checked="false"
        aria-label="Toggle"
        data-state="unchecked"
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(true)}
        className={cn("focus:outline-none transition-opacity", disabled && "opacity-50 cursor-not-allowed", className)}
      >
        {toggle}
      </button>
    );
  }

  return checked ? (
    <button
      type="button"
      role="switch"
      aria-checked="true"
      data-state="checked"
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(false)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/[0.08]",
        disabled && "opacity-60 cursor-not-allowed",
        className
      )}
    >
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {description ? <span className="mt-1 block text-xs text-slate-400">{description}</span> : null}
      </span>
      {toggle}
    </button>
  ) : (
    <button
      type="button"
      role="switch"
      aria-checked="false"
      data-state="unchecked"
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(true)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/[0.08]",
        disabled && "opacity-60 cursor-not-allowed",
        className
      )}
    >
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {description ? <span className="mt-1 block text-xs text-slate-400">{description}</span> : null}
      </span>
      {toggle}
    </button>
  );
}
