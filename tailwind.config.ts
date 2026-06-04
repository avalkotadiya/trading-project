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
        cyan: {
          glow: "#38e8ff",
          soft: "#67e8f9"
        },
        trade: {
          green: "#2bf0a0",
          red: "#ff5470",
          amber: "#f5b94d"
        }
      },
      boxShadow: {
        glow: "0 0 34px rgba(56, 232, 255, 0.2)",
        panel: "0 18px 70px rgba(0, 0, 0, 0.35)"
      },
      backgroundImage: {
        "market-grid":
          "linear-gradient(rgba(56,232,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(56,232,255,0.07) 1px, transparent 1px)"
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
