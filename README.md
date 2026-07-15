# smp-client

A browser-based updater for Minecraft instances built from the pack manifests
published by the sibling [`smp`](https://github.com/yurei-dll/smp) repository.

The application is still in its design phase. See
[docs/DESIGN.md](docs/DESIGN.md) for the agreed architecture, release contract,
browser support model, and update safety requirements.

## Current prototype

The current dependency-free prototype only reads a user-selected directory and
lists its files. It does not compare manifests or write to the directory.

Serve the repository over localhost and open the printed URL:

```bash
python3 -m http.server 4173 --directory src
```
