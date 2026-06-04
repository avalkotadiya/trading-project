"use client";

import { useState } from "react";
import { MessageCircle, X, Phone, Mail, HelpCircle } from "lucide-react";
import { cn } from "@/utils/cn";

export function FloatingHelpButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-20 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-300 md:bottom-8",
          isOpen 
            ? "bg-slate-800 text-white rotate-90" 
            : "bg-cyan-glow text-white hover:scale-110 shadow-[0_0_20px_rgba(59,130,246,0.4)]"
        )}
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed bottom-36 right-6 z-40 w-72 rounded-2xl border border-white/10 bg-[#0b1729] shadow-2xl animate-in zoom-in-95 duration-200 md:bottom-24">
          <div className="p-4 border-b border-white/5">
            <h3 className="font-bold text-white flex items-center gap-2">
              How can we help? <span className="animate-bounce">👋</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">Get instant help with Market Pulse or support.</p>
          </div>
          
          <div className="p-2 space-y-1">
            <button className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition hover:bg-white/5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-glow/10 text-cyan-soft">
                <HelpCircle className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Market Pulse Guide</div>
                <div className="text-[10px] text-slate-500">Learn how to read signals</div>
              </div>
            </button>

            <button className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition hover:bg-white/5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
                <Phone className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Call Support</div>
                <div className="text-[10px] text-slate-500">Available 9:00 - 18:00</div>
              </div>
            </button>

            <button className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition hover:bg-white/5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Email Us</div>
                <div className="text-[10px] text-slate-500">Response within 2 hours</div>
              </div>
            </button>
          </div>

          <div className="p-3 bg-white/5 rounded-b-2xl">
            <p className="text-[9px] text-slate-500 text-center uppercase tracking-widest font-bold">
              Sahara Trade Intelligence • v1.2.0
            </p>
          </div>
        </div>
      )}
    </>
  );
}
