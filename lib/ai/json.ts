/**
 * Tolerant JSON extraction.
 *
 * LLMs frequently wrap JSON in markdown fences or add a sentence of prose
 * around it. This pulls the first valid JSON value out of such responses so
 * the gateway can hand callers clean, typed data.
 */

export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();

  // Strip a ```json ... ``` (or plain ``` ... ```) fence if present.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();

  // Fast path: the whole string is already valid JSON.
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through to slicing */
  }

  // Slice from the first opening bracket to the last matching closing bracket.
  const start = s.search(/[{[]/);
  if (start === -1) return null;

  const closeChar = s[start] === "{" ? "}" : "]";
  const end = s.lastIndexOf(closeChar);
  if (end <= start) return null;

  try {
    return JSON.parse(s.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
