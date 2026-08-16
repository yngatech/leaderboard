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

function isWorkersPreviewBuild(): boolean {
  if (env.WORKERS_CI !== "1") return false;

  // A connected Workers Builds project pins uploads to its own Worker. Prefer
  // that identity when present so the production and preview Git connections
  // each generate configuration for the Worker they are allowed to update.
  if (env.WRANGLER_CI_OVERRIDE_NAME !== undefined) {
    return env.WRANGLER_CI_OVERRIDE_NAME === "leaderboard-preview";
  }

  return env.WORKERS_CI_BRANCH !== undefined && env.WORKERS_CI_BRANCH !== "main";
}

export default defineConfig(({ command }) => ({
  // The Worker runs inside the dev server in workerd, so every route — the
  // rendered pages included — is handled for real rather than proxied.
  plugins: [
    tailwindcss(),
    cloudflare({
      config: (workerConfig) => {
        if (!isWorkersPreviewBuild()) return;

        // Cloudflare cannot create preview URLs for versions with Durable
        // Object bindings. Notification state is only used by the scheduled
        // handler, so PR previews can safely leave both out.
        const previewConfig: Partial<typeof workerConfig> = workerConfig;
        previewConfig.name = "leaderboard-preview";
        previewConfig.workers_dev = false;
        delete previewConfig.durable_objects;
        delete previewConfig.migrations;
        delete previewConfig.triggers;
        delete previewConfig.routes;
      },
    }),
  ],
  define: {
    __BUILD_COMMIT_SHA__: JSON.stringify(buildCommitSha()),
    __DEV__: JSON.stringify(command === "serve"),
    __IS_PREVIEW_BUILD__: JSON.stringify(isWorkersPreviewBuild()),
  },
  build: {
    emptyOutDir: true,
    target: "es2022",
  },
}));
