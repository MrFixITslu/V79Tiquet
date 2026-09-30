import test from "node:test";
import assert from "node:assert/strict";
import { tiquetAccessForHubRole } from "./hubTeamAccess.js";

test("Hub owner maps to Tiquet Admin", () => {
  assert.deepEqual(tiquetAccessForHubRole("owner"), { localRole: "Admin", permissions: null });
});

test("Hub team roles map to least-privilege Tiquet Member permissions", () => {
  assert.deepEqual(tiquetAccessForHubRole("manager"), {
    localRole: "Member",
    permissions: ["dashboard", "jobs", "clients", "invoices", "files", "new-request"],
  });
  assert.deepEqual(tiquetAccessForHubRole("staff"), {
    localRole: "Member",
    permissions: ["dashboard", "jobs", "clients", "files", "new-request"],
  });
  assert.deepEqual(tiquetAccessForHubRole("viewer"), {
    localRole: "Member",
    permissions: ["dashboard"],
  });
  assert.throws(() => tiquetAccessForHubRole("admin"), /Unsupported Hub role/);
});
