import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { defineConfig } from "vite";

function buildCommitSha(): string {
  const deployedSha = env.GITHUB_SHA ?? env.WORKERS_CI_COMMIT_SHA ?? env.CF_PAGES_COMMIT_SHA;
  if (deployedSha) return deployedSha;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "main";
  }
}

function isWorkersPreviewBuild(mode: string): boolean {
  if (mode === "worker-preview") return true;
  if (env.WORKERS_CI !== "1") return false;

  return env.WORKERS_CI_BRANCH !== undefined && env.WORKERS_CI_BRANCH !== "main";
}

export default defineConfig(({ command, mode }) => ({
  // The Worker runs inside the dev server in workerd, so every route — the
  // rendered pages included — is handled for real rather than proxied.
  plugins: [
    tailwindcss(),
    cloudflare(),
  ],
  define: {
    __BUILD_COMMIT_SHA__: JSON.stringify(buildCommitSha()),
    __DEV__: JSON.stringify(command === "serve"),
    __IS_PREVIEW_BUILD__: JSON.stringify(isWorkersPreviewBuild(mode)),
    __LOCAL_DEVELOPMENT__: JSON.stringify(
      (command === "serve" || mode === "local-preview") && env.WORKERS_CI !== "1",
    ),
    __BOARD_ALARMS_ENABLED__: JSON.stringify(
      command === "build" && mode !== "local-preview",
    ),
  },
  build: {
    emptyOutDir: true,
    target: "es2022",
  },
}));
