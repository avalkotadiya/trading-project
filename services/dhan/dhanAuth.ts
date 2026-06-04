import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DhanClient, DhanError } from "@/services/dhan/dhanClient";

const tokenStorePath = path.join(process.cwd(), "data", "runtime", "dhan-token.json");

const consumeConsentSchema = z.object({
  accessToken: z.string().min(20),
  expiryTime: z.string().optional(),
  dhanClientId: z.string().optional(),
  dhanClientName: z.string().optional()
});

type StoredToken = {
  accessToken: string;
  updatedAt: string;
  expiryTime?: string;
};

let inMemoryToken = process.env.DHAN_ACCESS_TOKEN?.trim() || "";

async function readStoredToken(): Promise<StoredToken | null> {
  try {
    const raw = await readFile(tokenStorePath, "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

async function persistToken(payload: StoredToken) {
  await mkdir(path.dirname(tokenStorePath), { recursive: true });
  await writeFile(tokenStorePath, JSON.stringify(payload, null, 2), "utf8");
}

function readJwtExpiry(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { exp?: unknown };
    if (typeof parsed.exp !== "number") return null;
    const expiresAt = new Date(parsed.exp * 1000);
    return {
      expiresAt: expiresAt.toISOString(),
      expired: expiresAt.getTime() <= Date.now()
    };
  } catch {
    return null;
  }
}

export async function resolveDhanAccessToken() {
  if (inMemoryToken) {
    return inMemoryToken;
  }

  const stored = await readStoredToken();
  if (stored?.accessToken) {
    inMemoryToken = stored.accessToken;
    return inMemoryToken;
  }

  throw new DhanError(
    "Dhan access token is missing. Set DHAN_ACCESS_TOKEN or complete consent callback flow.",
    401,
    "DHAN_TOKEN_MISSING"
  );
}

export class DhanAuthService {
  private readonly client = new DhanClient(resolveDhanAccessToken);

  private get clientId() {
    return process.env.DHAN_CLIENT_ID?.trim() ?? "";
  }

  private get apiKey() {
    if (process.env.NODE_ENV === "production") {
      return process.env.DHAN_API_KEY_PROD?.trim() || process.env.DHAN_API_KEY?.trim() || "";
    }
    return process.env.DHAN_API_KEY_DEV?.trim() || process.env.DHAN_API_KEY?.trim() || "";
  }

  private get apiSecret() {
    if (process.env.NODE_ENV === "production") {
      return process.env.DHAN_API_SECRET_PROD?.trim() || process.env.DHAN_API_SECRET?.trim() || "";
    }
    return process.env.DHAN_API_SECRET_DEV?.trim() || process.env.DHAN_API_SECRET?.trim() || "";
  }

  async generateConsent() {
    if (!this.clientId || !this.apiKey || !this.apiSecret) {
      throw new DhanError("Dhan credentials are not configured.", 500, "DHAN_CONFIG_MISSING");
    }

    const path = `/app/generate-consent?client_id=${encodeURIComponent(this.clientId)}`;
    const response = await this.client.postAuth<{ consentAppId?: string; status?: string; consentAppStatus?: string }>(
      path,
      undefined,
      {
        app_id: this.apiKey,
        app_secret: this.apiSecret
      }
    );

    if (!response.consentAppId) {
      throw new DhanError("Unable to generate Dhan consent session.", 502, "DHAN_CONSENT_FAILED", response);
    }

    return {
      ...response,
      loginUrl: `https://auth.dhan.co/login/consentApp-login?consentAppId=${response.consentAppId}`
    };
  }

  async consumeConsentToken(tokenId: string) {
    if (!tokenId) {
      throw new DhanError("tokenId is required in callback query params.", 422, "DHAN_TOKEN_ID_MISSING");
    }

    if (!this.apiKey || !this.apiSecret) {
      throw new DhanError("Dhan API credentials are not configured.", 500, "DHAN_CONFIG_MISSING");
    }

    const payload = await this.client.postAuth(`/app/consumeApp-consent?tokenId=${encodeURIComponent(tokenId)}`, undefined, {
      app_id: this.apiKey,
      app_secret: this.apiSecret
    });

    const parsed = consumeConsentSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DhanError("Invalid token response from Dhan.", 502, "DHAN_CONSUME_FAILED", parsed.error.flatten());
    }

    inMemoryToken = parsed.data.accessToken;
    await persistToken({
      accessToken: parsed.data.accessToken,
      expiryTime: parsed.data.expiryTime,
      updatedAt: new Date().toISOString()
    });

    return {
      dhanClientId: parsed.data.dhanClientId ?? this.clientId,
      dhanClientName: parsed.data.dhanClientName ?? "Dhan User",
      expiryTime: parsed.data.expiryTime
    };
  }

  async getTokenHealth() {
    try {
      const token = await resolveDhanAccessToken();
      const expiry = readJwtExpiry(token);
      return {
        configured: true,
        tokenPresent: Boolean(token),
        source: process.env.DHAN_ACCESS_TOKEN ? "env" : "runtime-file",
        expiresAt: expiry?.expiresAt ?? null,
        expired: expiry?.expired ?? null
      };
    } catch {
      return { configured: false, tokenPresent: false, source: "none" as const };
    }
  }
}

export const dhanAuthService = new DhanAuthService();
