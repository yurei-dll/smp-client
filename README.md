# smp-client

[![Build modpacks](https://github.com/yurei-dll/smp/actions/workflows/build-modpacks.yml/badge.svg)](https://github.com/yurei-dll/smp/actions/workflows/build-modpacks.yml)

A browser-based updater for Minecraft instances built from the pack manifests
published by the sibling [`smp`](https://github.com/yurei-dll/smp) repository.

The application is still in its design phase. See
[docs/DESIGN.md](docs/DESIGN.md) for the agreed architecture, release contract,
browser support model, and update safety requirements.

## Current prototype

The current dependency-free prototype reads a user-selected directory and
compares mod JARs with the current `core` and `client` catalogs from `smp` by
default. A header selector can instead target the core-only **Barebones pack**.
Selecting `mods`, `.minecraft`, or a parent Prism instance produces the
same focused `mods` view. After comparison it proposes missing installs, hash
replacements, re-enabling catalog-matched `.jar.disabled` files, and disabling
unrecognized JARs by appending `.disabled`; every proposed action
is unchecked by default. Checked actions can be opened in an OS-specific manual
guide or exported as a generated Bash or PowerShell script. On desktop
Chromium-based browsers, folders selected through the browser picker can also
be updated directly after a plan review, final confirmation, and explicit
read/write permission grant. Direct updates stage and SHA-512 verify downloads,
recheck scanned files before mutation, and back up replaced JARs under
`mods/.smp-client/backup/`. Other browsers retain the read-only guide and script
workflow. Chrome Safe Browsing or an organization-managed DLP policy may block
File System Access writes after permission is granted; when that happens, the
client preserves the selection and offers the generated local apply script.
After all corrective actions are complete, Chromium users may permanently
delete root-level `.jar.disabled` files through a separate confirmation that is
intended only after the updated pack has launched successfully.

The hosted prototype is available at
[yurei-dll.github.io/smp-client](https://yurei-dll.github.io/smp-client/).
Pushes to `main` run the test suite and deploy `src/` to GitHub Pages.

Serve the repository over localhost and open the printed URL:

```bash
python3 -m http.server 4173 --directory src
```

## Linux launcher auto-update

`smp-cli` can update a Prism instance immediately before launch. Paste this
exact command into Prism's **Pre-launch command** field. It is intentionally a
single whitespace-free Bash program because Prism does not preserve ordinary
shell quoting when it splits custom-command arguments:

```bash
/bin/bash -c wget${IFS}-qO-${IFS}https://raw.githubusercontent.com/yurei-dll/smp-client/main/smp-cli|/bin/bash${IFS}-s${IFS}--${IFS}--auto-update${IFS}--allow-jar-deletion
```

Prism may run it from the instance root, its `minecraft` directory, or the
`mods` directory. This whitespace-free form is specifically for Prism's custom
command field.

The CLI installs the latest published `client` pack by default. It verifies the
release manifest, `.mrpack` SHA-256, and every JAR's SHA-512 before modifying the
instance. Without `--allow-jar-deletion`, unexpected JARs are renamed to
`.jar.disabled`; with the flag they are permanently deleted. Use
`--profile core` for the Barebones pack or `--mods-dir PATH` when automatic
directory detection is not appropriate. The sister `smp` repository must have
at least one published `pack-v<version>` GitHub Release; workflow artifacts from
untagged builds are not stable updater inputs.

## Licensing

The application code is available under the [MIT License](LICENSE). The Mine
Blocks dirt texture used by the website is a separately licensed third-party
asset and is not covered by the MIT License. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for its source, attribution,
and noncommercial-use restriction.
