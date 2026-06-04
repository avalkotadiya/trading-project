/**
 * IP address anonymisation utility.
 *
 * Raw IPs stored in audit logs may constitute PII under GDPR and India's DPDP Act.
 * This module hashes them with a server-side salt so they are still useful for
 * abuse detection but cannot be reverse-engineered to a real address.
 *
 * Set IP_HASH_SALT in your environment to a random 32-character string.
 * Rotating the salt effectively "forgets" all prior IP associations.
 */

import { createHash } from "node:crypto";

const FALLBACK_SALT = "sahara-ip-default-salt";

/**
 * Returns a deterministic, non-reversible 32-char hex fingerprint for the IP,
 * or null if no IP is provided.
 */
export function hashIpAddress(ip: string | null | undefined): string | null {
  if (!ip) return null;

  const salt = process.env.IP_HASH_SALT ?? FALLBACK_SALT;
  return createHash("sha256")
    .update(salt + ":" + ip)
    .digest("hex")
    .slice(0, 32);
}
