"use client";

import { useState, useTransition } from "react";
import { Bell, Loader2, Mail, Moon, Save, UserRound } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { UserSettingsProfile } from "@/types/platform";

type SettingsPanelProps = {
  profile: UserSettingsProfile;
};

export function SettingsPanel({ profile }: SettingsPanelProps) {
  const [name, setName] = useState(profile.name);
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber ?? "");
  const [telegramChatId, setTelegramChatId] = useState(profile.telegramChatId ?? "");
  const [whatsappOptIn, setWhatsappOptIn] = useState(profile.whatsappOptIn ?? false);
  const [emailAlerts, setEmailAlerts] = useState(profile.emailAlerts);
  const [pushAlerts, setPushAlerts] = useState(profile.pushAlerts);
  const [weeklyDigest, setWeeklyDigest] = useState(profile.weeklyDigest);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function saveSettings() {
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            phoneNumber,
            telegramChatId,
            whatsappOptIn,
            emailAlerts,
            pushAlerts,
            weeklyDigest
          })
        });
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Unable to update settings.");
        }

        setMessage("Settings saved.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to update settings.");
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-cyan-soft" />
            Profile settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
          <Input value={profile.email} aria-label="Email" readOnly />
          <Input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} aria-label="Phone number" placeholder="+91..." />
          <Input
            value={telegramChatId}
            onChange={(event) => setTelegramChatId(event.target.value)}
            aria-label="Telegram chat ID"
            placeholder="Telegram chat ID"
          />
          <div className="rounded-md border border-white/10 bg-white/[0.05] p-4">
            <p className="text-sm font-medium text-white">Authentication</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Role: {profile.role ?? "TRADER"}. These settings control your in-app profile and notifications.
            </p>
          </div>
          <Button className="w-full" onClick={saveSettings} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save profile
          </Button>
          {message ? <p className="rounded-md border border-white/10 bg-white/[0.05] p-3 text-sm text-slate-300">{message}</p> : null}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-cyan-soft" />
              Notification preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Switch
              checked={emailAlerts}
              onCheckedChange={setEmailAlerts}
              label="Email alerts"
              description="Price and momentum alerts"
            />
            <Switch
              checked={pushAlerts}
              onCheckedChange={setPushAlerts}
              label="Push alerts"
              description="Browser notifications"
            />
            <Switch
              checked={weeklyDigest}
              onCheckedChange={setWeeklyDigest}
              label="Weekly digest"
              description="Portfolio and scanner recap"
            />
            <Switch
              checked={whatsappOptIn}
              onCheckedChange={setWhatsappOptIn}
              label="WhatsApp alerts"
              description="Requires WhatsApp provider credentials"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Moon className="h-5 w-5 text-cyan-soft" />
              Theme
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.05] p-4">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-sm font-medium text-white">Interface mode</p>
                  <p className="mt-1 text-xs text-slate-400">Switch between dark and light theme.</p>
                </div>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
