import * as React from "react";
import { cn } from "@/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary:
    "kinetic-sheen bg-sapphire-core text-white shadow-[0_14px_36px_rgba(37,99,235,0.32)] hover:bg-sapphire-glow focus-visible:ring-sapphire-glow",
  secondary:
    "border border-white/10 bg-white/[0.08] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-cyan-glow/30 hover:bg-white/[0.12] focus-visible:ring-cyan-glow",
  ghost: "text-slate-300 hover:bg-white/[0.08] hover:text-white focus-visible:ring-cyan-glow",
  danger: "bg-trade-red text-white shadow-[0_14px_36px_rgba(255,84,112,0.18)] hover:bg-trade-red/90 focus-visible:ring-trade-red",
  outline: "holo-edge border border-white/20 bg-transparent text-white hover:bg-white/10 focus-visible:ring-cyan-glow"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 gap-2 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-5 text-base",
  icon: "h-10 w-10 p-0"
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        "hover:-translate-y-0.5 active:translate-y-0",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);

Button.displayName = "Button";
