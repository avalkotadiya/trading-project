import { OptionsWorkspace } from "@/components/options/options-workspace";
import { getOptionsAnalytics } from "@/services/market-service";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";

export default async function OptionsPage() {
  const data = await getOptionsAnalytics();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value || "";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Options analytics</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">NIFTY option chain intelligence</h1>
      </div>
      <OptionsWorkspace pcr={data.pcr} chain={data.optionChain} overview={data.overview} token={token} />
    </div>
  );
}
