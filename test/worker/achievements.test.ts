import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE } from "../../worker/github.ts";
import { setup } from "./fixture.ts";

const year = new Date().getUTCFullYear();
const login = PEOPLE[0].accounts[0];

test("the real worker reconstructs lifetime crossings, filters accounts, and keeps preview reads quiet", async (t) => {
  const app = await setup(t, { localPreview: true, credentials: "personal", history: 19_400 });
  app.setCount(600);
  const response = await app.mf.dispatchFetch(`https://board.test/achievements?year=${year}&person=${login}&nojs=1`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, new RegExp(`data-achievement="lifetime-milestone/${login}/20000"`));
  assert.match(body, new RegExp(`data-achievement="yearly-milestone/${year}/${login}/500"`));
  assert(!body.includes(`data-achievement="anniversary/${PEOPLE[1].accounts[0]}/`));
  assert(!body.includes('<script type="module"'));
  assert.equal(app.queries(), 1);
  assert.equal(app.attempts(), 0);
  assert.equal((await app.state()).alarm, null);
  const board = await app.mf.dispatchFetch("https://board.test/");
  assert.equal(board.status, 200);
  assert.match(await board.text(), /href="\/achievements\?year=/);
  assert.equal(app.queries(), 1, "page and feed reuse the cached calendar");
});

for (const mode of ["archive-error", "archive-partial"] as const) {
  test(`${mode} leaves yearly achievements usable and is retried after recovery`, async (t) => {
    const app = await setup(t, { localPreview: true, credentials: "personal", history: 19_400 });
    app.setCount(600);
    app.setMode(mode);
    const failed = await app.mf.dispatchFetch(`https://board.test/achievements?person=${login}`);
    assert.equal(failed.status, 200);
    const body = await failed.text();
    assert.match(body, /Lifetime achievements are unavailable/);
    assert.match(body, new RegExp(`data-achievement="yearly-milestone/${year}/${login}/500"`));
    assert(!body.includes('data-achievement="lifetime-milestone/'));
    assert.equal(failed.headers.get("X-Board-Stale"), "1");
    app.setMode("ok");
    const recovered = await app.mf.dispatchFetch(`https://board.test/achievements?person=${login}`);
    assert.equal(recovered.status, 200);
    assert.match(await recovered.text(), new RegExp(`data-achievement="lifetime-milestone/${login}/20000"`));
  });
}

test("invalid filters are rejected before accessing contribution sources", async (t) => {
  const app = await setup(t, { localPreview: true, credentials: "personal" });
  for (const query of ["year=3000", "year=2026junk", "person=unknown", "year=2007"]) {
    const response = await app.mf.dispatchFetch(`https://board.test/achievements?${query}`);
    assert.equal(response.status, 404);
  }
  assert.equal(app.queries(), 0);
  assert.equal(app.attempts(), 0);
});

test("a missing linked account suppresses its person's partial achievements and all board claims", async (t) => {
  const app = await setup(t, { localPreview: true, credentials: "personal" });
  app.setMode("partial-secondary");
  app.setCount(600);
  const merged = PEOPLE.find((person) => person.accounts.length > 1)!.accounts[0];
  const response = await app.mf.dispatchFetch("https://board.test/achievements");
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, new RegExp(`data-achievement="yearly-milestone/${year}/${login}/500"`));
  assert(!body.includes(`data-achievement="anniversary/${merged}/`));
  assert(!body.includes('data-achievement="board-record/'));
  assert(!body.includes('data-achievement="board-milestone/'));
  assert.match(body, /Achievements for incomplete accounts/);
});
