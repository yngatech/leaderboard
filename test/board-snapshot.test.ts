import assert from "node:assert/strict";
import test from "node:test";
import {
  SNAPSHOT_MAX_AGE_MS,
  usableSnapshot,
  type BoardSnapshot,
} from "../worker/board-snapshot.ts";

function snapshot(year: number, generatedAt: string): BoardSnapshot {
  return { year, board: [], generatedAt };
}

const NOW = Date.parse("2026-10-19T13:00:00Z");

test("a recent snapshot for the year in progress stands for the live board", () => {
  const recent = snapshot(2026, "2026-10-19T12:50:00Z");
  assert.equal(usableSnapshot(recent, 2026, NOW), recent);
});

test("expired or missing snapshots cannot stand for the live board", () => {
  const edge = snapshot(2026, new Date(NOW - SNAPSHOT_MAX_AGE_MS).toISOString());
  const stale = snapshot(2026, new Date(NOW - SNAPSHOT_MAX_AGE_MS - 1).toISOString());

  assert.equal(usableSnapshot(edge, 2026, NOW), edge);
  assert.equal(usableSnapshot(stale, 2026, NOW), null);
  assert.equal(usableSnapshot(undefined, 2026, NOW), null);
  assert.equal(usableSnapshot(snapshot(2026, "not a date"), 2026, NOW), null);
});

test("last year's snapshot never stands in for the new year", () => {
  const newYear = Date.parse("2027-01-01T00:05:00Z");
  assert.equal(usableSnapshot(snapshot(2026, "2026-12-31T23:59:00Z"), 2027, newYear), null);
});
