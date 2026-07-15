import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../smp-cli", import.meta.url));

test("smp-cli has valid Bash syntax and documents launcher flags", () => {
  const syntax = spawnSync("bash", ["-n", cli], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const help = spawnSync("bash", [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--auto-update/);
  assert.match(help.stdout, /--allow-jar-deletion/);
  assert.match(help.stdout, /client \(default\) or core/);
});

test("README contains a paste-ready piped auto-update command", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(
    readme,
    /wget -qO- https:\/\/raw\.githubusercontent\.com\/yurei-dll\/smp-client\/main\/smp-cli \\\n  \| bash -s -- --auto-update --allow-jar-deletion/,
  );
});
