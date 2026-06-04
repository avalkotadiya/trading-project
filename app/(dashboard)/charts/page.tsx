import { ChartsWorkspace } from "@/components/charts/charts-workspace";
import { DASHBOARD_SYMBOLS } from "@/lib/constants";

export default function ChartsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Technical analysis</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Charts</h1>
      </div>

      <ChartsWorkspace symbols={DASHBOARD_SYMBOLS} />
    </div>
  );
}
