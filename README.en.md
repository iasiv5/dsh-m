# dsh-m — Plugin Marketplace for DeepSeek Harness

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20verified-2563eb)](#faq)

English · [中文](./README.md)

A DeepSeek Harness (DSH) plugin marketplace with a customizable registry: **browse, install, uninstall, upgrade** — all local. Ships as a DSH web plugin: the "Plugin Marketplace" sidebar entry opens a three-view panel, backed by seven `dshm_*` agent tools and the `dshm` CLI.

## Quick start

**Paste this whole block to your agent to install:**

```text
Install and enable the DSH plugin dsh-m:
1. Run `dsh plugin --profile web add dsh-m`
2. Restart DSH Web to load the plugin (on this machine: `systemctl --user restart dsh-web.service`; or restart it your usual way)
3. Poll `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080` until it returns 200 again
4. Run `curl -s -X POST http://127.0.0.1:3080/dshm -H 'content-type: application/json' -d '{"method":"ping"}'` and confirm the reply has `plugin: dsh-m`
5. Then remind me to refresh the page and click "Plugin Marketplace" at the bottom of the sidebar
```

> `npm install -g dsh-m` installs only the `dshm` CLI (terminal management) — it does **not** register the plugin into the web profile; it can coexist with the plugin install above.

The default registry includes DSH Skins, ModSearch, the Lark / QQ / Weixin / WeCom / DingTalk channel bridges, and dsh-m itself.

## Panel

| View | Capabilities |
|---|---|
| **Market** | Card flow with search and category filters (server-side filtering + pagination, 50 per page — even a 1,000-entry registry probes the current page only); expandable details; "Install" — npm sources pin the latest exact version, GitHub sources pin the release/tag commit |
| **Installed** | What your web profile actually has, annotated "via market / non-market"; update badges, upgrade, two-step confirm uninstall; 📖 README preview (64KB cap) |
| **Settings** | Registry address draft with "Validate & apply / Restore default / Download default registry.json / Check entries reachability"; configured vs active address and status at a glance; force refresh; dsh-m self-update |

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

When the registry is unavailable, `registry` / `search` / `outdated` print the configured vs active address and exit 1; `list` still shows installed plugins. The CLI uses its own cache namespace and never touches the Web side's.

## Registry

`registry.json` is hand-curated and fetched at runtime in order: **GitHub raw (`@main`) → GitHub mirror (jsDelivr CDN, backup line) → local 60-min TTL cache → bundled snapshot** — listing updates are decoupled from plugin releases. To add or amend a listing, edit `registry.json` and open a PR; CI validates the strict schema, npm/GitHub existence, duplicate ids and URL reachability.

**Custom registry (overrides the official one)**: the Settings tab supports a single custom registry address that **replaces** the default registry (no merging):

1. "Download default registry.json" gives you a copy of the official listing;
2. edit the copy yourself (add/remove entries);
3. paste its address in Settings and hit "Validate & apply" — an **HTTPS URL**, a local **absolute path / `file://`** (HTTP only for 127.0.0.1/localhost debugging);
4. validation failures (bad fields, missing path, over 2 MiB / 1,000 entries, …) are never saved — the currently active registry stays; a successful apply takes effect **immediately, no restart** (only the first deploy of a new dsh-m version needs one restart);
5. "Restore default" switches back to the official registry in one click.

Rules and limits: strict v1 schema (unknown fields / invalid ids / oversized values / duplicates reject the whole file, never truncated); the copy is a standalone snapshot and does **not** auto-sync with the official listing; a failing custom source keeps its own last good cache and never silently falls back to the official registry; old custom-source caches are cleaned after switching (the default cache is kept); custom registries are not validated by official CI — install only from sources you trust; full local paths appear only on the Settings tab, tools and cards show short statuses.

Security baseline: HTTPS-only fetches (loopback HTTP excepted) with per-hop redirect checks, size caps and timeouts; npm installs verify the exact version's dist integrity against the pnpm lockfile — mismatches fail closed and roll back; GitHub installs pinned to commit SHA; pnpm build scripts are allowed-by-policy with an explicit report when unblocked.

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

**1. Why don't GitHub-sourced update hints follow main?**
Intermediate commits on main can be unstable. dsh-m tracks **releases / tags** only (`releases/latest` first, tags list as fallback) and pins the commit SHA the tag points to.

**2. Does uninstalling dsh-m delete my data?**
No. Only the package reference in the profile is removed (live UI disabled first), and suspected leftover paths are reported to you.

**3. Will a custom registry slow the market down?**
Listings over 200 entries trigger a performance notice. The market list is server-paginated (50 per page); even a 1,000-entry registry queries latest versions for the current page only.

**4. What if my custom source goes down?**
dsh-m serves its last successful cache for that source and marks it as cached; with no cache at all the market shows "registry unavailable" while installed plugins stay manageable. Fix the address or restore the default anytime.

## License

MIT
