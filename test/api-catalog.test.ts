import assert from "node:assert/strict";
import test from "node:test";
import { apiCatalog } from "../worker/api-catalog.ts";

test("publishes a self-contained API catalog with concrete user endpoints", () => {
  const catalog = apiCatalog("https://leaderboard.example/", ["alice", "bob"]);
  const [links] = catalog.linkset;

  assert.equal(links.anchor, "https://leaderboard.example/.well-known/api-catalog");
  assert.deepEqual(
    links.item.map(({ href, type }) => ({ href, type })),
    [
      { href: "https://leaderboard.example/api/board", type: "application/json" },
      { href: "https://leaderboard.example/api/all", type: "application/json" },
      { href: "https://leaderboard.example/api/users/alice", type: "application/json" },
      { href: "https://leaderboard.example/api/users/bob", type: "application/json" },
    ],
  );
});
