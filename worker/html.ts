import { html as honoHtml, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export type Html = HtmlEscapedString;
type HtmlValue = string | number | boolean | null | undefined | readonly HtmlValue[];

/**
 * Synchronous Hono templates for the server-rendered views. None of our
 * interpolations are promises, so narrowing Hono's async-capable return type
 * here keeps the rest of the renderer synchronous and composable.
 */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): Html {
  const rendered = honoHtml(strings, ...values);
  if (rendered instanceof Promise) {
    throw new TypeError("View templates must not interpolate promises");
  }
  return rendered;
}

/**
 * JSON destined for an inline `<script type="application/json">` block. The
 * only sequence that can break out of that element is `</script>`, and `<`
 * never needs to appear unescaped inside JSON.
 */
export function jsonForScript(value: unknown): Html {
  return raw(JSON.stringify(value).replaceAll("<", "\\u003c"));
}
