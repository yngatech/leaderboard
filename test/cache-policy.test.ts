import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveCachePrefix,
  browserCacheControl,
  buildCacheKey,
  buildCachePrefix,
  isStaleCopy,
  lastGoodCopy,
  staleCopy,
} from "../worker/cache-policy.ts";

test("production cache identities and browser policy remain unchanged", () => {
  assert.equal(buildCachePrefix("https://cache.test/data/v1/", false, "abc123"), "https://cache.test/data/v1/");
  assert.equal(buildCacheKey("https://cache.test/all/v1", false, "abc123"), "https://cache.test/all/v1");
  assert.equal(
    archiveCachePrefix("https://cache.test/archive/v1/", false, [{ accounts: ["octocat"] }]),
    "https://cache.test/archive/v1/",
  );
  assert.equal(
    browserCacheControl(false, 300, 1_800),
    "public, max-age=300, stale-while-revalidate=1800",
  );
});

test("preview data caches are isolated by build", () => {
  const prefix = "https://cache.test/data/v1/";
  const key = "https://cache.test/all/v1";

  assert.equal(buildCachePrefix(prefix, true, "abc/123"), `${prefix}abc%2F123/`);
  assert.equal(buildCacheKey(key, true, "abc/123"), `${key}/abc%2F123`);
  assert.notEqual(buildCacheKey(key, true, "abc123"), buildCacheKey(key, true, "def456"));
  assert.equal(browserCacheControl(true, 300, 1_800), "no-store");
});

test("preview archive cache is shared until account grouping changes", () => {
  const base = "https://cache.test/archive/v1/";
  const roster = [{ accounts: ["primary", "secondary"] }, { accounts: ["another"] }];

  assert.equal(archiveCachePrefix(base, true, roster), `${base}primary+secondary,another/`);
  assert.notEqual(
    archiveCachePrefix(base, true, roster),
    archiveCachePrefix(base, true, [{ accounts: ["primary"] }, { accounts: ["secondary", "another"] }]),
  );
});

test("a last good copy keeps the answer and its own life", async () => {
  const fresh = Response.json({ total: 3 }, {
    headers: { "Cache-Control": "public, max-age=1800", "X-Board-Generated": "2026-08-20T18:00:00Z" },
  });

  const kept = lastGoodCopy(fresh, 88_200);

  assert.equal(kept.headers.get("Cache-Control"), "public, max-age=88200");
  assert.equal(kept.headers.get("X-Board-Generated"), "2026-08-20T18:00:00Z");
  assert.equal(isStaleCopy(kept), false);
  assert.deepEqual(await kept.json(), { total: 3 });
});

test("a stale copy is marked and short-lived, and keeps when it was generated", async () => {
  const kept = lastGoodCopy(
    Response.json({ total: 3 }, { headers: { "X-Board-Generated": "2026-08-20T18:00:00Z" } }),
    88_200,
  );

  const stale = staleCopy(kept, 300);

  assert.equal(stale.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(stale.headers.get("X-Board-Generated"), "2026-08-20T18:00:00Z");
  assert.equal(isStaleCopy(stale), true);
  assert.equal(isStaleCopy(Response.json({})), false);
  assert.deepEqual(await stale.json(), { total: 3 });
});
