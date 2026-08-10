/**
 * Minimal HTML escaping for the string-template views. Every interpolation of
 * text that originates outside this repo — GitHub display names above all —
 * must pass through here. Logins are `[A-Za-z0-9-]` but get escaped anyway;
 * the discipline is cheaper than the audit.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escapes a value for a double-quoted attribute position. */
export function attr(value: string | number): string {
  return escapeHtml(String(value));
}

/**
 * JSON destined for an inline `<script type="application/json">` block. The
 * only sequence that can break out of that element is `</script>`, and `<`
 * never needs to appear unescaped inside JSON.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
