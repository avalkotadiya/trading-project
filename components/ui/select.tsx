import * as React from "react";
import { cn } from "@/utils/cn";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-white/20 focus:border-cyan-glow/60 focus:ring-2 focus:ring-cyan-glow/20",
      className
    )}
    {...props}
  >
    {children}
  </select>
));

Select.displayName = "Select";
