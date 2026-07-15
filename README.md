# smp-client

A browser-based updater for Minecraft instances built from the pack manifests
published by the sibling [`smp`](https://github.com/yurei-dll/smp) repository.

The application is still in its design phase. See
[docs/DESIGN.md](docs/DESIGN.md) for the agreed architecture, release contract,
browser support model, and update safety requirements.

## Current prototype

The current dependency-free prototype reads a user-selected directory and
compares mod JARs with the current `core` and `client-optional` catalogs from
`smp`. Selecting `mods`, `.minecraft`, or a parent Prism instance produces the
same focused `mods` view. After comparison it proposes missing installs, hash
replacements, and optional archival of unrecognized JARs; every proposed action
is unchecked by default. Checked actions can be opened in an OS-specific manual
guide or exported as a generated Bash or PowerShell script. The website itself
does not write to the directory.

Serve the repository over localhost and open the printed URL:

```bash
python3 -m http.server 4173 --directory src
```
