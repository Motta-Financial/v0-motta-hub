/**
 * Reduce a caller-supplied `?next=` to a same-origin path.
 *
 * The auth routes redirect to `next` after verifying a session, and
 * `new URL(next, origin)` happily resolves an absolute or protocol-relative
 * value to ANOTHER host: `?next=https://evil.example` or `?next=//evil.example`
 * would land a freshly signed-in user on an attacker's page, with our domain
 * in the link they clicked. Anything that isn't a plain local path falls back.
 *
 * Rejected:
 *  · absolute URLs (`https://…`, `javascript:…`) — don't start with `/`;
 *  · protocol-relative `//host` and `/\host` (browsers treat `\` as `/`);
 *  · control characters, which some parsers strip to produce `//`.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback
  if (!raw.startsWith("/")) return fallback
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback
  if (/[\u0000-\u001F\u007F]/.test(raw)) return fallback
  return raw
}
