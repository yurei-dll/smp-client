import assert from "node:assert/strict";
import test from "node:test";

import { catalogUrlsFor, profileFor } from "../src/profiles.js";

test("the standard client pack layers client mods on top of core", () => {
  assert.deepEqual(profileFor("client").groups, ["core", "client"]);
  assert.deepEqual(catalogUrlsFor("client"), [
    "https://raw.githubusercontent.com/yurei-dll/smp/main/pack/catalog/core.json",
    "https://raw.githubusercontent.com/yurei-dll/smp/main/pack/catalog/client.json",
  ]);
});

test("the barebones pack uses only core", () => {
  assert.equal(profileFor("core").name, "Barebones pack");
  assert.deepEqual(profileFor("core").groups, ["core"]);
});

test("unknown profile values safely default to the standard client pack", () => {
  assert.equal(profileFor("unexpected"), profileFor("client"));
});
