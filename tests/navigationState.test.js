import test from "node:test";
import assert from "node:assert/strict";
import { readTiquetTab, readTiquetJobId, tiquetNavigationPath } from "../src/navigationState.js";

test("Tiquet keeps a selected ticket on refresh", () => {
  const path = tiquetNavigationPath("https://tiquet.v79sl.com/?utm_source=hub#workspace", "jobs", "ticket-123");
  assert.equal(path, "/?utm_source=hub&tab=jobs&job=ticket-123#workspace");
  assert.equal(readTiquetTab(path.split("?")[1]), "jobs");
  assert.equal(readTiquetJobId(path.split("?")[1]), "ticket-123");
});
test("Tiquet removes ticket selection after leaving jobs", () => {
  const path = tiquetNavigationPath("https://tiquet.v79sl.com/?tab=jobs&job=ticket-123&utm_campaign=test", "clients");
  assert.equal(readTiquetTab(path.split("?")[1]), "clients");
  assert.equal(readTiquetJobId(path.split("?")[1]), null);
  assert.ok(path.includes("utm_campaign=test"));
});
test("unknown tabs and invalid ticket IDs fail closed", () => {
  assert.equal(readTiquetTab("?tab=__bad__"), "dashboard");
  assert.equal(readTiquetJobId("?job=../../sensitive"), null);
  assert.equal(readTiquetJobId("?job=a%0Ab"), null);
  assert.equal(tiquetNavigationPath("https://tiquet.v79sl.com/?tab=jobs&job=xyz", "dashboard"), "/");
});
