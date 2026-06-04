import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { DhanDashboardCard } from "@/components/dashboard/dhan-dashboard-card";
import { getUserSettingsProfile } from "@/lib/platform-data";

export default async function SettingsPage() {
  const profile = await getUserSettingsProfile();

  return (
    <div className="space-y-8 pb-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Configuration</p>
        <h1 className="mt-2 text-3xl font-semibold text-white tracking-tight">Settings &amp; Workspace</h1>
        <p className="mt-2 text-slate-400 max-w-2xl">
          Manage your profile, notification preferences, and interface theme.
        </p>
      </div>

      <SettingsPanel profile={profile} />

      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Broker Connection</p>
        <DhanDashboardCard />
      </div>
    </div>
  );
}
