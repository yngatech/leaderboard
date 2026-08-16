import { readFile } from "node:fs/promises";
import type { BrowserContext } from "@playwright/test";
import type { SiteChrome } from "../../worker/views/layout.ts";

/**
 * Serves one rendered page and its two assets off an intercepted origin, so a
 * browser test needs no server. Anything not stubbed is aborted: a page that
 * reaches for something it was not given should fail rather than hang.
 */

export const ORIGIN = "https://board.test";

export const chrome: SiteChrome = {
  thisYear: 2026,
  stylesUrl: "/assets/styles.css",
  enhanceUrl: "/assets/enhance.js",
  buildSha: "0123456789abcdef0123456789abcdef01234567",
};

const enhanceScript = await readFile(new URL("../../worker/enhance.js", import.meta.url), "utf8");

export interface Stub {
  path: string;
  contentType: string;
  body: string;
}

export async function serveFixture(
  context: BrowserContext,
  html: string,
  stubs: Stub[] = [],
): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== ORIGIN) {
      await route.abort();
      return;
    }

    if (url.pathname === "/assets/enhance.js") {
      await route.fulfill({ contentType: "text/javascript", body: enhanceScript });
      return;
    }

    if (url.pathname === "/assets/styles.css") {
      await route.fulfill({ contentType: "text/css", body: "" });
      return;
    }

    const stub = stubs.find((candidate) => candidate.path === url.pathname);
    if (stub) {
      await route.fulfill({ contentType: stub.contentType, body: stub.body });
      return;
    }

    if (request.resourceType() === "document") {
      await route.fulfill({ contentType: "text/html", body: html });
      return;
    }

    await route.abort();
  });
}
