# dsh-m — Plugin Marketplace for DeepSeek Harness

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.1--rc.2%20verified-2563eb)](#faq)

English · [中文](./README.md)

Your personal plugin marketplace for DeepSeek Harness (DSH): **browse, install, uninstall, upgrade** — all local. Ships as a DSH web plugin: the "Plugin Marketplace" sidebar entry opens a three-view panel, backed by seven `dshm_*` agent tools and the `dshm` CLI.

## Quick start

```sh
npm install -g dsh-m          # or: dsh plugin --profile web add dsh-m@<version>
```

1. **Restart DSH Web** after installing (one-click restart works too).
2. Refresh the page and click "**Plugin Marketplace**" at the bottom of the sidebar.

First listings include: DSH Skins, DSH Web Search, the Lark / QQ / Weixin / WeCom / DingTalk channel bridges, and dsh-m itself.

## Panel

| View | Capabilities |
|---|---|
| **Market** | Card flow with search, category filters and tags; expandable details; "Install" — npm sources pin the latest exact version, GitHub sources pin the release/tag commit |
| **Installed** | What your web profile actually has, annotated "via market / non-market"; update badges, upgrade, two-step confirm uninstall; 📖 README preview (64KB cap) |
| **Settings** | Registry cache status + force refresh, registry source override, dsh-m self-update |

After any mutation a "⚡ Restart" banner appears — restart goes through the systemd unit (same-origin checked, detached-helper fallback) and polls by boot id until the service is back. Installs stream live pnpm progress (resolve → download → link → build).

## Agent tools (7)

| Tool | Purpose |
|---|---|
| `dshm_search` | Search the curated registry (renders cards in chat) |
| `dshm_list` | List installed plugins (market / non-market annotated) |
| `dshm_install` | Install by listing id |
| `dshm_uninstall` | Uninstall (confirm first; data kept, leftovers reported) |
| `dshm_outdated` | Check for newer versions |
| `dshm_upgrade` | Upgrade to the latest |
| `dshm_restart` | Restart DSH Web (with user consent) |

## CLI

```sh
dshm search [--query topic] [--category ui]
dshm list | outdated | registry
dshm install --id dsh-web-search
dshm upgrade --pkg dsh-web-search --yes
dshm uninstall --pkg dsh-web-search --yes
dshm restart --yes
```

## Registry

`registry.json` is hand-curated and served at runtime via **raw.githubusercontent / jsDelivr `@main`** (local 60-min TTL cache + bundled snapshot fallback) — listing updates are decoupled from plugin releases. To add or amend a listing, edit `registry.json` and open a PR; CI validates schema, npm/GitHub existence, duplicate ids and URL reachability.

Security baseline: HTTPS-only fetches with size caps and timeouts; npm installs verified by lock integrity + post-install version match; GitHub installs pinned to commit SHA; pnpm build scripts are allowed-by-policy with an explicit report when unblocked.

## Development

```sh
npm ci
npm run build        # tsc (host/core/cli) + esbuild (client, tree-shaking off)
npm run typecheck
node scripts/validate-registry.mjs
```

For local iteration use a `link:` dependency (same trick as dsh-skins): point the profile dependency at this repo, then `npm run build` + restart.

Release: `npm version patch|minor|major && git push --tags` → OIDC trusted publishing.

## FAQ

**Why don't GitHub-sourced update hints follow main?**
Intermediate commits on main can be unstable. dsh-m tracks **releases / tags** only (`releases/latest` first, tags list as fallback) and pins the commit SHA the tag points to.

**Does uninstalling delete my data?**
No. Only the package reference in the profile is removed (live UI disabled first), and suspected leftover paths are reported to you.

**Does it work with third-party skins?**
Yes. Every color comes from DSH theme semantic tokens (`state-*` / `brand-*` / `bg-overlay`), verified against the official light/dark themes and third-party skins.

## License

MIT
