import type { AlertSummary } from "@/types/platform";

type NotificationResult = {
  provider: string;
  status: "sent" | "skipped" | "failed";
};

async function sendTelegram(message: string, chatId: string | null): Promise<NotificationResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || !chatId) {
    return { provider: "telegram", status: "skipped" };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
  }).catch(() => null);

  return { provider: "telegram", status: response?.ok ? "sent" : "failed" };
}

async function sendWhatsApp(message: string, recipient: string | null): Promise<NotificationResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId || !recipient) {
    return { provider: "whatsapp", status: "skipped" };
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: { body: message }
    })
  }).catch(() => null);

  return { provider: "whatsapp", status: response?.ok ? "sent" : "failed" };
}

export async function dispatchAlertNotifications(
  alert: AlertSummary,
  user: { telegramChatId?: string | null; whatsappOptIn?: boolean; phoneNumber?: string | null }
) {
  const message = `Sahara alert: ${alert.title} - ${alert.message}`;
  
  const tasks = [];
  if (user.telegramChatId) {
    tasks.push(sendTelegram(message, user.telegramChatId));
  }
  if (user.whatsappOptIn && user.phoneNumber) {
    tasks.push(sendWhatsApp(message, user.phoneNumber));
  }

  if (tasks.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(tasks);

  return results.map((result) =>
    result.status === "fulfilled" ? result.value : ({ provider: "unknown", status: "failed" } satisfies NotificationResult)
  );
}
