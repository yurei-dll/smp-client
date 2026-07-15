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

test("smp-cli explains the tagged-release prerequisite", async () => {
  const source = await readFile(cli, "utf8");
  assert.match(source, /no published pack release was found/);
  assert.match(source, /pack-v<version>/);
});

test("smp-cli URL-encodes mrpack download paths for curl", async () => {
  const source = await readFile(cli, "utf8");
  assert.match(source, /urllib\.parse\.quote\(parts\.path/);
  assert.match(source, /safe_url = urllib\.parse\.urlunsplit/);
});

test("README contains a paste-ready piped auto-update command", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(
    readme,
    /\/bin\/bash -c wget\$\{IFS\}-qO-\$\{IFS\}https:\/\/raw\.githubusercontent\.com\/yurei-dll\/smp-client\/main\/smp-cli\|\/bin\/bash\$\{IFS\}-s\$\{IFS\}--\$\{IFS\}--auto-update\$\{IFS\}--allow-jar-deletion/,
  );
});

test("the whitespace-free Prism command survives direct argv splitting", () => {
  const command =
    "printf${IFS}exit\\\\x20\\\\x30|/bin/bash${IFS}-s${IFS}--${IFS}--auto-update${IFS}--allow-jar-deletion";
  const result = spawnSync("/bin/bash", ["-c", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
