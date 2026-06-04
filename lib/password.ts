import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash.
 *
 * Bug fix: the previous `storedHash.split(":")` would silently truncate the
 * key portion if a colon appeared within the hex string (edge case but
 * possible depending on encoding path). We now use a max-split of 3 segments
 * and join any excess back to reconstruct a complete key string.
 */
export async function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split(":");

  // Format is scrypt:<16-byte hex salt>:<64-byte hex key>
  // Join segments beyond index 2 to handle any unexpected colons.
  if (parts.length < 3) return false;

  const [algorithm, salt, ...keyParts] = parts;
  const key = keyParts.join(":");

  if (algorithm !== "scrypt" || !salt || !key) {
    return false;
  }

  const storedKey = Buffer.from(key, "hex");

  // Guard against empty or malformed key buffers
  if (storedKey.length === 0) return false;

  const derivedKey = (await scryptAsync(password, salt, storedKey.length)) as Buffer;

  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}
