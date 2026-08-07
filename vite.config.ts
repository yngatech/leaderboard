import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

function buildCommitSha(): string {
  const deployedSha = env.GITHUB_SHA ?? env.CF_PAGES_COMMIT_SHA;
  if (deployedSha) return deployedSha;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "main";
  }
}

export default defineConfig({
  // The Worker runs inside the dev server in workerd, so `/api` and the
  // markdown views are handled for real rather than proxied.
  plugins: [solid(), tailwindcss(), cloudflare()],
  define: {
    __BUILD_COMMIT_SHA__: JSON.stringify(buildCommitSha()),
  },
  build: {
    emptyOutDir: true,
    target: "es2022",
  },
});
