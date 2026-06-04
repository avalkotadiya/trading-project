/**
 * Input sanitisation helpers.
 *
 * sanitizeText: extended to strip a broader set of HTML injection characters,
 * not just `<>`. This is defence-in-depth alongside Zod validation.
 *
 * sanitizeSymbolList: removed — it was dead code. The same deduplication
 * logic is inlined in lib/validators.ts where it is actually used.
 */

/**
 * Strips common HTML/script injection characters and normalises whitespace.
 * Not a full HTML sanitiser — use for plain-text fields only.
 */
export function sanitizeText(input: string, maxLength = 160) {
  return input
    .replace(/[<>"'`]/g, "") // Strip common XSS chars (expanded from just <>)
    .replace(/javascript:/gi, "") // Strip JS protocol injections
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalises a market symbol string. Allows letters, digits, &, ., and -.
 * Strips all other characters and uppercases the result.
 */
export function sanitizeSymbol(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9&.-]/g, "")
    .slice(0, 20);
}
