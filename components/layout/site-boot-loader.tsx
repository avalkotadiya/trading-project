"use client";

import { motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";

const bootSteps = ["Calibrating feed", "Loading signal fabric", "Warming risk engine"];

export function SiteBootLoader() {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const seen = window.sessionStorage.getItem("sahara-boot-seen");
    if (seen) return;

    setVisible(true);
    window.sessionStorage.setItem("sahara-boot-seen", "1");

    const timeout = window.setTimeout(() => setVisible(false), reduceMotion ? 500 : 1850);
    return () => window.clearTimeout(timeout);
  }, [reduceMotion]);

  if (!visible) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#030711]"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="boot-grid" />
      <div className="boot-scan" />
      <motion.div
        className="relative w-[min(92vw,32rem)] rounded-lg border border-cyan-glow/25 bg-[#07111f]/80 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        initial={reduceMotion ? false : { y: 18, scale: 0.96, opacity: 0 }}
        animate={reduceMotion ? undefined : { y: 0, scale: 1, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-4">
          <div className="relative grid h-14 w-14 place-items-center rounded-lg border border-cyan-glow/25 bg-cyan-glow/10">
            <span className="absolute inset-0 rounded-lg border border-cyan-glow/30 animate-[bootRing_1.4s_ease-in-out_infinite]" />
            <Image src="/sahara-mark.svg" alt="" width={34} height={34} className="relative rounded-md" priority />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-soft">Sahara</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Trade Intelligence</h2>
          </div>
        </div>

        <div className="mt-7 h-2 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-cyan-glow via-trade-green to-trade-amber"
            initial={{ x: "-100%" }}
            animate={{ x: "0%" }}
            transition={{ duration: reduceMotion ? 0.2 : 1.45, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        <div className="mt-5 grid gap-2">
          {bootSteps.map((step, index) => (
            <motion.div
              key={step}
              className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.045] px-3 py-2 text-xs"
              initial={reduceMotion ? false : { opacity: 0, x: -8 }}
              animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
              transition={{ delay: 0.22 + index * 0.18, duration: 0.35 }}
            >
              <span className="text-slate-300">{step}</span>
              <span className="font-mono text-cyan-soft">OK</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
