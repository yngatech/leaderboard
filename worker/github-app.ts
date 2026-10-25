import { GitHubError } from "./github.ts";

/**
 * Either a GitHub App installation, whose tokens have their own rate limit, or
 * a personal token, which shares its owner's limit with everything else they
 * run. The App wins when both are configured.
 */
export interface GitHubCredentials {
  GITHUB_TOKEN?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  /** PKCS#8 PEM (`BEGIN PRIVATE KEY`), as WebCrypto cannot import PKCS#1. */
  GITHUB_APP_PRIVATE_KEY?: string;
}

interface InstallationToken {
  token: string;
  expiresAt: number;
}

/** Tokens last an hour; refresh with room to spare for a slow board fetch. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Shared across requests in one isolate, so a busy page mints once an hour. */
let cached: InstallationToken | null = null;
let minting: Promise<InstallationToken> | null = null;

export function hasGitHubCredentials(env: GitHubCredentials): boolean {
  return Boolean(appConfigured(env) || env.GITHUB_TOKEN);
}

function appConfigured(env: GitHubCredentials): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** The token to send GitHub. Callers check `hasGitHubCredentials` first. */
export async function githubToken(
  env: GitHubCredentials,
  now: () => number = Date.now,
  request: typeof fetch = fetch,
): Promise<string> {
  if (!appConfigured(env)) return env.GITHUB_TOKEN ?? "";
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.token;
  // Concurrent requests share one exchange rather than each minting a token.
  minting ??= mintInstallationToken(env, now(), request).finally(() => {
    minting = null;
  });
  cached = await minting;
  return cached.token;
}

/** Test hook: forget the cached token. */
export function resetGitHubTokenCache(): void {
  cached = null;
  minting = null;
}

async function mintInstallationToken(
  env: GitHubCredentials,
  now: number,
  request: typeof fetch,
): Promise<InstallationToken> {
  const jwt = await appJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!, now);
  const res = await request(
    `https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID!)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ynga-git-board",
      },
    },
  );
  if (!res.ok) {
    console.error("github app token error", { status: res.status, body: (await res.text()).slice(0, 300) });
    throw new GitHubError(`GitHub rejected the board's app credentials (${res.status}).`, 502);
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: Date.parse(body.expires_at) };
}

/**
 * The short-lived JWT that proves the request comes from the App. `iat` is
 * backdated a minute for clock drift; GitHub caps `exp` at ten minutes.
 */
export async function appJwt(appId: string, pem: string, now: number): Promise<string> {
  const seconds = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBody(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signed));
  return `${signed}.${base64Url(new Uint8Array(signature))}`;
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    throw new GitHubError(
      "The GitHub App key is PKCS#1. Convert it with `openssl pkcs8 -topk8 -nocrypt`.",
      500,
    );
  }
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
