import * as React from "react";
import { cn } from "@/utils/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-white/10 bg-white/[0.07] px-3 text-sm text-white outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition placeholder:text-slate-500 hover:border-white/20 focus:border-cyan-glow/60 focus:bg-white/[0.09] focus:ring-2 focus:ring-cyan-glow/20",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
