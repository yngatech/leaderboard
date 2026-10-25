import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE } from "../../worker/github.ts";
import viteConfig from "../../vite.config.ts";
import { setup } from "./fixture.ts";

test("personal-token access is enabled for local dev and preview but disabled for production", async () => {
  for (const command of ["serve", "build"] as const) {
    const local = await viteConfig({ command, mode: "local-preview" });
    assert.equal(local.define?.__LOCAL_DEVELOPMENT__, "true");
  }
  const dev = await viteConfig({ command: "serve", mode: "development" });
  assert.equal(dev.define?.__LOCAL_DEVELOPMENT__, "true");
  const production = await viteConfig({ command: "build", mode: "production" });
  assert.equal(production.define?.__LOCAL_DEVELOPMENT__, "false");
});

test("a local preview serves the board with a personal token and no background posts", async (t) => {
  const app = await setup(t, { localPreview: true, credentials: "personal" });
  const response = await app.mf.dispatchFetch("https://board.test/api/board");
  assert.equal(response.status, 200);
  assert.equal((await response.json() as unknown[]).length, PEOPLE.length);
  assert.equal((await app.state("snapshot")).alarm, null);
  assert.equal(app.queries(), 1);
  assert.equal(app.attempts(), 0);
  assert.equal(app.exchanges(), 0);
});

test("deployed builds reject a personal token when App secrets are missing or incomplete", async (t) => {
  for (const credentials of ["personal", "partial-app"] as const) {
    const app = await setup(t, { credentials });
    for (const path of ["/api/board", `/api/users/${PEOPLE[0].accounts[0]}/breakdown`]) {
      const response = await app.mf.dispatchFetch(`https://board.test${path}`);
      assert.equal(response.status, 500);
      assert.match((await response.json() as { error: string }).error, /missing its GitHub App credentials/);
    }
    assert.equal((await app.state("snapshot")).alarm, null);
    assert.equal(app.queries(), 0);
    assert.equal(app.exchanges(), 0);
  }
});
