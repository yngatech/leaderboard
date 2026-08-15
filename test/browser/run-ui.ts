import { spawn } from "node:child_process";
import { createRequire } from "node:module";

function uiPort(): number {
  const raw = process.env.T3CODE_WORKSPACE_PORT;
  if (raw === undefined) return 0;

  if (!/^\d+$/.test(raw)) {
    throw new Error(`T3CODE_WORKSPACE_PORT must be an integer, received ${JSON.stringify(raw)}`);
  }

  const base = Number(raw);
  if (!Number.isSafeInteger(base) || base < 1 || base >= 65_535) {
    throw new Error(`T3CODE_WORKSPACE_PORT is outside the valid port range: ${raw}`);
  }
  return base + 1;
}

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

let port: number;
try {
  port = uiPort();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  port = -1;
}

if (port !== -1) {
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", "--ui", `--ui-port=${port}`, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill(signal));
  }

  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
