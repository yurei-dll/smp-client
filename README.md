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
replacements, and disabling of unrecognized JARs by appending `.disabled`; every proposed action
is unchecked by default. Checked actions can be opened in an OS-specific manual
guide or exported as a generated Bash or PowerShell script. The website itself
does not write to the directory.

Serve the repository over localhost and open the printed URL:

```bash
python3 -m http.server 4173 --directory src
```

## Linux launcher auto-update

`smp-cli` can update a Prism instance immediately before launch. Prism may run
this from the instance root, its `minecraft` directory, or the `mods` directory:

```bash
wget -qO- https://raw.githubusercontent.com/yurei-dll/smp-client/main/smp-cli \
  | bash -s -- --auto-update --allow-jar-deletion
```

The CLI installs the latest published `client` pack by default. It verifies the
release manifest, `.mrpack` SHA-256, and every JAR's SHA-512 before modifying the
instance. Without `--allow-jar-deletion`, unexpected JARs are renamed to
`.jar.disabled`; with the flag they are permanently deleted. Use
`--profile core` for the Barebones pack or `--mods-dir PATH` when automatic
directory detection is not appropriate.
