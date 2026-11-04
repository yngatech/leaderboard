import assert from "node:assert/strict";
import test from "node:test";
import type { BoardHistory } from "../../worker/board-history.ts";
import { PEOPLE } from "../../worker/github.ts";
import { setup } from "./fixture.ts";

const leader = PEOPLE[0].accounts[0];
const today = new Date().toISOString().slice(0, 10);
const year = new Date().getUTCFullYear();
const newYearsDay = today === `${year}-01-01`;

async function history(app: Awaited<ReturnType<typeof setup>>, path = "/api/history"): Promise<BoardHistory> {
  const response = await app.mf.dispatchFetch(`https://board.test${path}`);
  assert.equal(response.status, 200);
  return await response.json() as BoardHistory;
}

test("alarm checks record totals and classify changed days as same-day or backfilled", { skip: newYearsDay }, async (t) => {
  const app = await setup(t, { webhook: false });
  await app.refreshed();
  app.setCount(30);
  app.setTodayCount(5);
  await app.refreshed();
  await app.refreshed();

  const board = await history(app);
  assert.equal(board.login, null);
  assert.equal(board.checks.length, 3);
  const [baseline, changed, quiet] = board.checks;
  assert.equal(baseline.baseline, true);
  assert.deepEqual(baseline.changes, []);
  assert.equal(Object.keys(baseline.totals).length, PEOPLE.length);
  assert.equal(changed.previousCheckedAt, baseline.checkedAt);
  assert.equal(changed.totals[leader], 35);
  assert.deepEqual(changed.changes, [
    { login: leader, date: `${year}-01-01`, previous: 10, count: 30, delta: 20, kind: "backfill", daysBack: changed.changes[0].daysBack },
    { login: leader, date: today, previous: 0, count: 5, delta: 5, kind: "same-day", daysBack: 0 },
  ]);
  assert.ok(changed.changes[0].daysBack > 0);
  assert.deepEqual(quiet.changes, []);
  assert.deepEqual(board.summary.find((entry) => entry.login === leader),
    { login: leader, total: 35, sameDay: 5, backfill: 20, ahead: 0 });

  // Incomplete boards are skipped, as they are for the snapshot.
  app.setMode("partial");
  await app.refreshed();
  assert.equal((await history(app)).checks.length, 3);
  app.setMode("ok");

  // One person, through the canonical spelling, with the query kept.
  const query = `?from=${today}&to=${today}`;
  const redirect = await app.mf.dispatchFetch(`https://board.test/api/users/${leader.toUpperCase()}/history${query}`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("Location"), `https://board.test/api/users/${leader}/history${query}`);
  const user = await history(app, `/api/users/${leader}/history${query}`);
  assert.equal(user.login, leader);
  assert.deepEqual(user.checks.map((check) => Object.keys(check.totals)), [[leader], [leader], [leader]]);

  assert.equal((await app.mf.dispatchFetch("https://board.test/api/users/not-on-the-roster/history")).status, 404);
  const invalid = await app.mf.dispatchFetch("https://board.test/api/history?from=yesterday");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("Cache-Control"), "no-store");
});

test("a failed history write still saves the board, posts to Discord and schedules the next check", async (t) => {
  const app = await setup(t);
  await app.refreshed();
  await app.breakHistory();
  app.setCount(5000);
  const failed = await app.refreshed();
  assert.equal(failed.values["board-snapshot"]?.board[0].totalContributions, 5000);
  assert.ok(app.posts.length > 0);
  assert.ok(failed.alarm !== null && failed.alarm > Date.now());
  assert.equal((await history(app)).checks.length, 1);

  await app.fixHistory();
  await app.refreshed();
  const [, recovered] = (await history(app)).checks;
  // The baseline was not advanced by the failed write, so nothing is lost.
  assert.deepEqual(recovered.changes.map((change) => [change.login, change.previous, change.count]), [[leader, 10, 5000]]);
});

test("preview builds record history without notifying, and disabled builds serve an empty one", async (t) => {
  const preview = await setup(t, { workerPreview: true });
  await preview.refreshed();
  const response = await preview.mf.dispatchFetch("https://board.test/api/history");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(((await response.json()) as BoardHistory).checks.length, 1);
  assert.equal(preview.attempts(), 0);

  const local = await setup(t, { localPreview: true });
  await local.refreshed();
  assert.deepEqual((await history(local)).checks, []);
  assert.equal(local.queries(), 0);
});
