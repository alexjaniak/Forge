import test from "node:test";
import assert from "node:assert/strict";

import {
  collectTemplateTypes,
  resolveTemplatePath,
} from "./template-resolution.ts";

test("collectTemplateTypes collapses local/example pairs into logical types", () => {
  assert.deepEqual(
    collectTemplateTypes([
      "worker.example.json",
      "worker.json",
      "planner.example.json",
      "README.md",
      "super.json",
    ]),
    ["planner", "super", "worker"]
  );
});

test("resolveTemplatePath prefers local templates before example fallbacks", () => {
  const existingPaths = new Set(["/repo/templates/worker.json"]);

  assert.equal(
    resolveTemplatePath("/repo", "worker", (candidate) => existingPaths.has(candidate)),
    "/repo/templates/worker.json"
  );
  assert.equal(
    resolveTemplatePath("/repo", "planner", (candidate) => existingPaths.has(candidate)),
    "/repo/templates/planner.example.json"
  );
});
