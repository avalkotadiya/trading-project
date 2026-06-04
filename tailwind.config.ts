import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
    "./styles/**/*.css"
  ],
  theme: {
    extend: {
      colors: {
        background: "#030711",
        panel: "#07111f",
        panelLight: "#0b1728",
        borderSoft: "rgba(148, 163, 184, 0.18)",
        // The legacy `cyan` accent tokens now resolve to the sapphire-matte
        // palette so the ~95 existing `cyan-glow`/`cyan-soft` usages across
        // every page render as deep royal blue without per-page edits. Prefer
        // the `sapphire.*` names in new code.
        cyan: {
          glow: "#3b82f6",
          soft: "#7aa2ff"
        },
        // Sapphire matte accent system — deep royal blue, low-gloss. Drives the
        // "matte blue 3D luxurious" theme app-wide.
        sapphire: {
          soft: "#7aa2ff",
          glow: "#3b82f6",
          core: "#2563eb",
          deep: "#1e40af",
          night: "#162a52",
          ink: "#0a1120"
        },
        trade: {
          green: "#2bf0a0",
          red: "#ff5470",
          amber: "#f5b94d"
        }
      },
      boxShadow: {
        // Softer, matte glow (was bright cyan neon).
        glow: "0 0 30px rgba(59, 130, 246, 0.16)",
        panel: "0 18px 70px rgba(0, 0, 0, 0.35)",
        // Matte = soft, deep, low-glow elevation + crisp bevel rims.
        matte: "0 18px 48px rgba(2, 6, 18, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.05), inset 0 -1px 0 rgba(0, 0, 0, 0.45)",
        "matte-raise": "0 28px 74px rgba(2, 6, 18, 0.62), 0 0 30px rgba(37, 99, 235, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.07)",
        bevel: "inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -2px 6px rgba(0, 0, 0, 0.4)",
        "sapphire-glow": "0 0 26px rgba(37, 99, 235, 0.2)"
      },
      backgroundImage: {
        "market-grid":
          "linear-gradient(rgba(59,130,246,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px)"
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-110%)" },
          "100%": { transform: "translateY(110%)" }
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" }
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        }
      },
      animation: {
        scan: "scan 4s linear infinite",
        pulseGlow: "pulseGlow 3s ease-in-out infinite",
        ticker: "ticker 32s linear infinite"
      }
    }
  },
  plugins: []
};

export default config;
