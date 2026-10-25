import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { appJwt, githubToken, hasGitHubCredentials, resetGitHubTokenCache } from "../worker/github-app.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const app = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_INSTALLATION_ID: "678",
  GITHUB_APP_PRIVATE_KEY: pkcs8,
};

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

test("the app JWT is RS256-signed by the app key and expires inside ten minutes", async () => {
  const now = Date.parse("2026-10-25T01:00:00Z");
  const jwt = await appJwt("12345", pkcs8, now);
  const [header, payload, signature] = jwt.split(".");

  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(payload), { iat: now / 1000 - 60, exp: now / 1000 + 540, iss: "12345" });

  const key = await crypto.subtle.importKey(
    "spki",
    publicKey.export({ type: "spki", format: "der" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  assert.equal(valid, true);
});

test("a PKCS#1 key is refused with the command that converts it", async () => {
  await assert.rejects(appJwt("12345", pkcs1, Date.now()), /openssl pkcs8 -topk8 -nocrypt/);
});

test("an installation token is reused until five minutes before it expires", async () => {
  resetGitHubTokenCache();
  let clock = Date.parse("2026-10-25T01:00:00Z");
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json({
      token: `token-${calls.length}`,
      expires_at: new Date(clock + 60 * 60 * 1000).toISOString(),
    });
  }) as typeof fetch;

  assert.equal(await githubToken(app, () => clock, request), "token-1");
  clock += 54 * 60 * 1000;
  assert.equal(await githubToken(app, () => clock, request), "token-1");
  clock += 2 * 60 * 1000;
  assert.equal(await githubToken(app, () => clock, request), "token-2");
  assert.deepEqual(calls, [
    "https://api.github.com/app/installations/678/access_tokens",
    "https://api.github.com/app/installations/678/access_tokens",
  ]);
});

test("concurrent requests share one token exchange", async () => {
  resetGitHubTokenCache();
  let calls = 0;
  const request = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ token: "shared", expires_at: new Date(Date.now() + 3600e3).toISOString() });
  }) as typeof fetch;

  const tokens = await Promise.all([1, 2, 3].map(() => githubToken(app, Date.now, request)));
  assert.deepEqual(tokens, ["shared", "shared", "shared"]);
  assert.equal(calls, 1);
});

test("a rejected exchange surfaces as a GitHub error and is retried next time", async () => {
  resetGitHubTokenCache();
  let fail = true;
  const request = (async () =>
    fail
      ? new Response("Bad credentials", { status: 401 })
      : Response.json({ token: "recovered", expires_at: new Date(Date.now() + 3600e3).toISOString() })) as typeof fetch;

  const error = console.error;
  console.error = () => {};
  try {
    await assert.rejects(githubToken(app, Date.now, request), /app credentials \(401\)/);
  } finally {
    console.error = error;
  }
  fail = false;
  assert.equal(await githubToken(app, Date.now, request), "recovered");
});

test("without every app secret the personal token is used", async () => {
  resetGitHubTokenCache();
  const request = (async () => assert.fail("no exchange expected")) as typeof fetch;
  const partial = { GITHUB_TOKEN: "personal", GITHUB_APP_ID: "12345" };

  assert.equal(await githubToken(partial, Date.now, request), "personal");
  assert.equal(hasGitHubCredentials(partial), true);
  assert.equal(hasGitHubCredentials({ GITHUB_APP_ID: "12345" }), false);
  assert.equal(hasGitHubCredentials(app), true);
});
