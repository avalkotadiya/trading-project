export default function Loading() {
  return (
    <div className="relative grid min-h-[60vh] place-items-center px-4">
      <div className="glass-panel w-full max-w-xl rounded-lg p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md border border-cyan-glow/25 bg-cyan-glow/10 animate-[pulseGlow_1.5s_ease-in-out_infinite]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-soft">
              Sahara
            </p>
            <h1 className="mt-1 text-xl font-semibold text-white">
              Loading trading workspace
            </h1>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-400" role="status" aria-live="polite">
          Syncing your session, market data, watchlists, and AI signal surfaces.
        </p>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-1/2 rounded-full bg-cyan-glow animate-[loadingRail_1.2s_ease-in-out_infinite]" />
        </div>
        <div className="mt-5 grid gap-3">
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Auth session</span>
              <span className="font-mono text-cyan-soft">checking</span>
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Dashboard modules</span>
              <span className="font-mono text-trade-green">warming</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
