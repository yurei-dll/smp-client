# SMP client design

## Purpose

`smp-client` will be a static website hosted as part of the project owner's
personal website. It helps a player inspect a local Prism Launcher Minecraft
instance, compare it with a published SMP pack, and bring it up to date.

The website is the client-facing half of a two-repository system:

```text
smp catalog commit
        |
        v
GitHub Actions pack build
        |
        v
immutable GitHub Release
        |
        v
smp-client scan, plan, apply, and verify
```

The sibling `smp` repository remains the authority for mod classification and
pack composition. Its catalog currently identifies exact Modrinth projects and
versions, records SHA-512 hashes, and defines the `client-minimal`,
`client-full`, and `server` profiles. `smp-client` must consume published build
artifacts; it must not independently decide which mod version belongs in a
pack.

## Product boundaries

The initial version will:

- let the user select a Prism instance directory;
- validate the instance structure;
- select a published client profile;
- scan and hash locally installed managed files;
- report current, missing, outdated, obsolete, and unknown files;
- preview every corrective action before it is applied;
- directly apply updates where the browser provides writable directory
  handles;
- generate a personalized corrective package and guide where it does not; and
- rescan the instance to verify the result.

The initial version will not discover installations without user interaction,
install or launch Prism, install a Minecraft loader, launch Minecraft, or
synchronize worlds and arbitrary user configuration. Those features may be
considered after file reconciliation is proven reliable.

## Hosting and browser capabilities

The application is a pure website rather than a native, Electron, or Tauri
application. It must be served over HTTPS because direct filesystem access is
restricted to secure contexts.

Support is capability-based rather than inferred from a browser's user-agent
string.

### Direct update mode

Browsers that expose `window.showDirectoryPicker` and grant a directory handle
in `readwrite` mode can perform the complete workflow. This is expected on
desktop Chromium-derived browsers such as Chrome, Edge, and Opera.

The directory picker must be opened from an explicit user gesture. A retained
handle may be stored in IndexedDB for convenience, but the application must
expect permissions to be requested again. Before presenting an enabled
**Apply update** action, the application must confirm that write permission is
currently granted.

### Guided update mode

Firefox and other browsers may support directory selection through
`<input type="file" webkitdirectory>` or drag and drop. The resulting File and
Directory Entries API data is sufficient to enumerate, read, and hash the
user-provided files, but it does not grant write access to the selected native
directory.

Upload-style directory selection may eagerly enumerate every descendant file.
To avoid reading large worlds, screenshots, logs, and backups unnecessarily,
guided mode should normally ask the user to select the instance's
`minecraft/mods` directory rather than the complete instance root. The UI must
make this difference explicit. The generated corrective script can then ask
for the instance root when it is run and validate the relationship between
that root and the scanned mods directory.

These browsers remain supported for:

- a complete local audit;
- an exact, personalized list of additions, replacements, and removals;
- generation of a corrective ZIP containing only the required payload;
- Unix and Windows corrective scripts;
- a human-readable manual guide; and
- a verification scan after the user applies the corrections.

This mode must not be described as direct installation. The browser also does
not expose the selected directory's absolute operating-system path, so the
generated scripts must accept or interactively request the instance path.

### Unsupported or declined access

Pack downloads and general release information should remain available when a
browser lacks directory-reading support or the user declines access. The UI
must explain which capability is missing and must not imply that the website
can inspect files it has not been granted.

## Pack publishing

GitHub Actions in `smp` will build immutable, versioned pack artifacts from a
specific catalog commit. A release is expected to contain:

```text
smp-client-minimal.zip
smp-client-full.zip
smp-server.zip
release-manifest.json
SHA256SUMS
```

Release builds should be triggered by an explicit pack tag or manual release
workflow, not by every change to the moving `main` branch. A tag such as
`pack-v2026.07.14.1` identifies one immutable release.

Before publishing, the workflow must:

1. run the `smp` test suite;
2. require the classification review list to be empty;
3. validate that every profile includes only known catalog groups;
4. resolve each exact platform version;
5. download each required artifact;
6. verify each artifact against the catalog's SHA-512;
7. assemble each profile and its embedded inventory;
8. calculate hashes for the finished assets; and
9. publish all assets together as one GitHub Release.

The updater should consume release assets or other immutable URLs. It should
not silently follow raw files from the moving `main` branch.

### Redistribution policy

Publishing a catalog entry is not necessarily permission to redistribute its
JAR. The pack build must account for each mod's license and distribution
conditions. Files that may be redistributed can be included in the ZIP. Files
that may not be redistributed must instead be represented by an authorized
download URL and integrity hash, as in a Modrinth pack.

The release format should therefore permit both bundled and externally fetched
files without changing the reconciliation model.

## Release manifest contract

`release-manifest.json` is the stable boundary between the publishing workflow
and the website. An illustrative top-level document is:

```json
{
  "schema_version": 1,
  "release": "2026.07.14.1",
  "source_commit": "5bb64431b302bc6ae223a178b278b8625070cf1b",
  "minecraft_version": "1.21.1",
  "loader": {
    "type": "neoforge",
    "version": "..."
  },
  "packs": {
    "client-minimal": {
      "asset": "smp-client-minimal.zip",
      "sha256": "...",
      "size": 123456789
    },
    "client-full": {
      "asset": "smp-client-full.zip",
      "sha256": "...",
      "size": 234567890
    }
  }
}
```

Every pack archive must also contain a machine-readable inventory. Each managed
file needs, at minimum:

- a normalized path relative to the selected instance root;
- a cryptographic content hash;
- its owning profile or catalog groups;
- whether it is bundled or externally downloaded; and
- the payload path or authorized download URL needed to obtain it.

Schema versions must be rejected when unsupported. The source commit must be
shown to users and recorded locally so an installed state can be traced back to
the exact catalog input that produced it.

## Instance selection and validation

In direct update mode, the preferred selected directory is a Prism instance
root. A normal instance has `instance.cfg` and stores game files beneath
`minecraft/`, including `minecraft/mods/`. In guided mode, the preferred scan
target is `minecraft/mods/` so the upload-style picker does not enumerate large
unrelated instance data.

Before planning or applying changes, the application must:

- reject paths that escape the selected root after normalization;
- confirm the markers available for the selected mode, with full instance
  validation deferred to the corrective script when guided mode scans only
  `minecraft/mods/`;
- verify that the release's Minecraft and loader requirements match the
  instance where those values can be determined;
- distinguish the instance root from a directly selected `minecraft/` folder;
  and
- clearly identify which directory will be modified.

The browser cannot reliably determine whether Minecraft is running on every
platform. The user must be told to close Minecraft and Prism before applying an
update. Direct mode may add conservative file-lock checks, but their absence is
not proof that the game is closed.

## Reconciliation model

An archive is a set of managed files, not permission to replace the entire
Minecraft directory. The desired inventory is compared with both the local
managed-state record and actual file hashes.

```text
desired path absent locally                 -> install
desired path has expected desired hash      -> current
managed path has a different known hash     -> replace
previously managed path no longer desired   -> disable (`.disabled`)
unrecognized local path                     -> preserve
```

Unknown files are user-owned by default. In particular, the client must not
remove an unknown mod merely because it is absent from the selected profile.
Unknown files should be displayed separately so the user can recognize local
customizations or possible incompatibilities.

The client owns only paths explicitly recorded by a previously applied pack or
an action the user explicitly approves. It must never treat `saves/`,
`screenshots/`, `resourcepacks/`, `options.txt`, or arbitrary configuration as
disposable. Any future managed configuration must be enumerated explicitly and
must define preservation and merge behavior.

## Safe application requirements

Both direct mode and generated corrective scripts must follow the same safety
rules:

1. show the complete plan and obtain confirmation;
2. download or stage new files outside their final paths;
3. verify every staged file's cryptographic hash;
4. recheck the expected hash of any local file to be replaced or disabled;
5. abort that action if the file changed since the scan;
6. create a dated backup within a dedicated backup area;
7. rename disabled JARs by appending `.disabled`, and move replaced managed
   files into the backup instead of deleting them;
8. move verified staged files into place;
9. verify the resulting managed inventory;
10. write the managed-state record only after success; and
11. write a useful operation log.

An interrupted update must not leave a partially downloaded JAR at its final
path. Operations should be rerunnable, and recovery instructions must identify
the backup used by the failed operation.

An illustrative local state record is:

```json
{
  "schema_version": 1,
  "profile": "client-full",
  "release": "2026.07.14.1",
  "source_commit": "5bb64431b302bc6ae223a178b278b8625070cf1b",
  "managed_files": {
    "minecraft/mods/example.jar": "sha512:..."
  }
}
```

The intended location is `.smp-client/state.json` relative to the selected
instance root. Backups and logs should also live under `.smp-client/` unless
implementation constraints require a documented alternative.

## Personalized corrective package

Guided update mode creates a ZIP tailored to the user's scan rather than
requiring them to download and reinstall the full pack. Its proposed layout is:

```text
smp-update/
  README.html
  actions.json
  payload/
    minecraft/
      mods/
        new-mod.jar
        replacement-mod.jar
  apply-update.sh
  apply-update.ps1
  verify-update.sh
  verify-update.ps1
```

The HTML guide must name every affected path and explain how to apply the same
changes manually. It should explicitly list preserved unknown mods and end with
instructions to rescan the instance on the website.

### Declarative actions

Personalization belongs in `actions.json`, not in newly generated executable
source. The shell and PowerShell implementations should be stable, reviewed
programs that interpret the same versioned action schema.

An illustrative action document is:

```json
{
  "schema_version": 1,
  "profile": "client-full",
  "from_release": "2026.07.14.1",
  "to_release": "2026.07.18.1",
  "install": [
    {
      "path": "minecraft/mods/new-mod.jar",
      "payload": "payload/minecraft/mods/new-mod.jar",
      "sha512": "..."
    }
  ],
  "replace": [
    {
      "path": "minecraft/mods/example-1.2.jar",
      "expected_sha512": "...",
      "payload": "payload/minecraft/mods/example-1.3.jar",
      "new_path": "minecraft/mods/example-1.3.jar",
      "new_sha512": "..."
    }
  ],
  "disable": [
    {
      "path": "minecraft/mods/retired-mod.jar",
      "disabled_path": "minecraft/mods/retired-mod.jar.disabled",
      "expected_sha512": "..."
    }
  ]
}
```

Action paths must be normalized and relative. Interpreters must reject absolute
paths, parent traversal, duplicate destinations, schema versions they do not
support, and instructions targeting protected or undeclared locations.

### Unix and Windows scripts

The Unix script should run under a documented shell available on the supported
Linux and macOS targets. The Windows script should target a documented
PowerShell version. Both must:

- accept an instance path as an argument or prompt for one;
- support a dry-run mode (`--dry-run` on Unix and `-WhatIf` on PowerShell);
- print the proposed actions before requesting confirmation;
- avoid wildcard removal and unsafe evaluation of action data;
- use exact, quoted paths;
- implement the shared backup and hash-checking behavior; and
- return a nonzero status with a clear error when any precondition fails.

Example invocations are:

```bash
chmod +x apply-update.sh
./apply-update.sh "/path/to/PrismLauncher/instances/Create Mega Pack"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\apply-update.ps1 `
  -InstancePath "C:\Users\Alice\AppData\Roaming\PrismLauncher\instances\Create Mega Pack"
```

The guide may explain a process-scoped PowerShell invocation when necessary,
but it must never instruct users to permanently weaken their execution policy.
Users who do not want to execute a downloaded script must be able to complete
the exact same operation using the manual guide.

## User-facing update report

Before any direct or guided update, the website should present a report similar
to:

```text
Instance: Create Mega Pack
Profile: SMP Client Full
Installed release: 2026.07.14.1
Available release: 2026.07.18.1

Add:       1 file
Replace:   1 file
Disable:   1 file
Current: 109 files
Preserve:  4 unknown local mods
```

Every summary count must expand to exact paths and expected actions. **Disable**
means renaming the exact JAR by appending `.disabled`; it must never be presented
as deletion.

## Security and trust

This application converts remotely published instructions into local file
changes, so both sides of the contract must be treated as security-sensitive.

- Only trusted release origins may supply manifests and payloads.
- Release and per-file hashes must be verified before installation.
- Manifest paths must never be used without normalization and containment
  checks.
- The UI must not hide removals, replacements, or externally downloaded files.
- Corrective scripts must interpret data without `eval`, dynamic shell source,
  or PowerShell expression execution.
- Content Security Policy and dependency pinning should be established before
  deployment on the personal website.
- If release signing is added, signature verification should cover the manifest
  that binds release metadata, paths, and content hashes together.

## Initial delivery sequence

1. Finalize and test the release and per-pack inventory schemas.
2. Add the tag-driven pack builder and GitHub Release workflow to `smp`.
3. Implement instance selection, validation, scanning, and hashing in the
   website.
4. Implement comparison and the expandable update report.
5. Implement Chromium direct updates with backup and verification. (Prototype complete.)
6. Implement corrective ZIP generation and stable Unix/PowerShell interpreters.
7. Test both workflows against disposable Prism instances on Linux and Windows.
8. Add production hosting controls and publish the website.
