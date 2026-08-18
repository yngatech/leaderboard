import assert from "node:assert/strict";
import test from "node:test";
import { cakeDayYears, joinDay, yearsOnGitHub } from "../shared/cakeday.ts";

const CREATED = "2016-03-12T09:33:21Z";

test("age counts whole years and turns over on the anniversary", () => {
  assert.equal(yearsOnGitHub(CREATED, "2026-03-11"), 9);
  assert.equal(yearsOnGitHub(CREATED, "2026-03-12"), 10);
  assert.equal(yearsOnGitHub(CREATED, "2026-12-31"), 10);
  assert.equal(yearsOnGitHub(CREATED, "2027-01-01"), 10);
});

test("an account is nought years old on the day it is created", () => {
  assert.equal(yearsOnGitHub(CREATED, "2016-03-12"), 0);
});

test("a 29 February account ages on 1 March in a common year", () => {
  const leapling = "2016-02-29T12:00:00Z";
  assert.equal(yearsOnGitHub(leapling, "2025-02-28"), 8);
  assert.equal(yearsOnGitHub(leapling, "2025-03-01"), 9);
});

test("a missing or unparseable creation date never throws", () => {
  assert.equal(yearsOnGitHub(undefined, "2026-03-12"), 0);
  assert.equal(yearsOnGitHub("not a date", "2026-03-12"), 0);
});

test("the join day is the UTC calendar day of the timestamp", () => {
  assert.equal(joinDay(CREATED), "2016-03-12");
});

test("a cake day is the anniversary and nothing else", () => {
  assert.equal(cakeDayYears(CREATED, "2026-03-12"), 10);
  assert.equal(cakeDayYears(CREATED, "2026-03-11"), null);
  assert.equal(cakeDayYears(CREATED, "2026-03-13"), null);
  assert.equal(cakeDayYears(CREATED, "2026-12-03"), null);
});

test("a 29 February account celebrates on 1 March in a common year", () => {
  const leapling = "2016-02-29T12:00:00Z";
  assert.equal(cakeDayYears(leapling, "2024-02-29"), 8);
  assert.equal(cakeDayYears(leapling, "2025-02-28"), null);
  assert.equal(cakeDayYears(leapling, "2025-03-01"), 9);
});

test("a cake day is never guessed from a missing creation date", () => {
  assert.equal(cakeDayYears(undefined, "2026-03-12"), null);
  assert.equal(cakeDayYears("not a date", "2026-03-12"), null);
});
