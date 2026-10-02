# dsh-m — Plugin Marketplace for DeepSeek Harness

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.2.0--rc.2-2563eb)](#faq)

English · [中文](./README.md)

dsh-m is a plugin marketplace for DeepSeek Harness (DSH): **browse · install · uninstall · upgrade**, entirely on your machine — no server, no account. The "Plugin Marketplace" panel opens from the sidebar, with agent-tool and CLI surfaces sharing the same core.

**Highlights**

- **Dual profile** — the same package installs into Web (`web`) and official Desktop (`desktop`); everything manages the host's current profile;
- **Dual-catalog market** — the 4,000+ entry community catalog (awesome-dsh-plugin) is the default, layered with a hand-curated registry; zoned browsing with click-to-install;
- **Three consistent surfaces** — the GUI panel, eight `dshm_*` agent tools, and the `dshm` CLI share one data model and semantics;
- **Security baseline** — npm exact versions with integrity checks, GitHub installs pinned to commit SHA, official pluginManager delegation, and key-by-key build approvals.

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp" alt="Plugin Marketplace panel — Market view: Community / Curated / Favorites zones, category chips, and plugin cards (verified / installed badges, npm & GitHub detail links)" width="100%">
  <p><sub>The "Plugin Marketplace" panel · browse Community, Curated, and Favorites with compatibility and install status</sub></p>
</div>

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Panel](#panel)
- [Agent tools (8)](#agent-tools-8)
- [CLI](#cli)
- [Community catalog (awesome-dsh-plugin)](#community-catalog-awesome-dsh-plugin)
- [Curated registry (registry.json)](#curated-registry-registryjson)
- [Documentation](#documentation)
- [FAQ](#faq)

Version history is not expanded on this page — see [`CHANGELOG.md`](https://github.com/iasiv5/dsh-m/blob/main/CHANGELOG.md) for the complete record.

## Requirements

- Node.js ≥ 22 on the host side;
- DSH Web or official Desktop (supported host generations: see the [FAQ matrix](#faq));
- No extra services or accounts — installing and managing plugins happens entirely locally.

## Quick start

1. In DSH, open the official plugin manager and choose "Add plugin".
2. Enter `dsh-m`, select an install source that works for your network, then click "Install".
3. Follow the host lifecycle to activate it: restart DSH Web and refresh the page; on official Desktop, quit and reopen the app.
4. Once loaded, open "Plugin Marketplace" from the bottom of the sidebar.

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/official-plugin-install.webp" alt="DSH official plugin manager: the Add Plugin dialog with dsh-m entered and an install source selected" width="86%">
  <p><sub>Recommended · add and install dsh-m from DSH's official plugin manager</sub></p>
</div>

> **Upgrade note:** The official plugin manager currently says in-place updates are not supported. To upgrade through it, uninstall `dsh-m` first, then install the newer version; follow the latest UI guidance if this changes.

## Panel

| View | Capabilities |
|---|---|
| **Market** | Community (4,000+ entries) / Curated / Favorites zones, each keeping its own category, search, sort, and pagination state; cards open a detail modal with install progress and results shown in place. |
| **Operations** | Installs, upgrades, uninstalls, and toggles flow through one global operation log — state lives off cards and resumes automatically after host reloads. |
| **Installed** | What the current profile actually has: source annotation, live phase badge, one-click toggle, upgrade, and two-step confirmed uninstall. |
| **Settings** | Curated registry configuration and status, community catalog toggle, dsh-m self-update. |

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/settings.webp" alt="Settings view — community catalog status card (catalog version / route / entries), curated registry configuration card (address draft with force-refresh / validate & apply / restore default / download), and the About card" width="86%">
  <p><sub>Settings view · community catalog status, curated registry configuration, and dsh-m self-update</sub></p>
</div>

How changes take effect (Web only):

- After install / uninstall / upgrade, the Market and Installed views sync automatically — no need to close and reopen the panel;
- A "⚡ Restart" banner follows: under systemd, the DSH launcher's `appExit` hands the restart to the unit's `Restart` policy; hosts without `appExit` fall back by design;
- The client confirms the new process by boot id, dismisses the banner, and lets DSH Web's background reconnection restore the page — no forced full reload;
- Installs stream live pnpm progress (resolve → download → link → build).

On Desktop, changes take effect via the official app lifecycle: quit and reopen the app after installing. Restart-chain mechanics and per-generation verification records live in [`docs/DESIGN.md`](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md).

## Agent tools (8)

| Tool | Purpose |
|---|---|
| `dshm_search` | Search curated & community listings (renders cards in chat) |
| `dshm_list` | List installed plugins (market / non-market annotated) |
| `dshm_install` | Install by listing id (peer compatibility precheck before install; incompatible results return structured data for user confirmation, then `force` retries) |
| `dshm_uninstall` | Uninstall (confirm first; data kept, leftovers reported) |
| `dshm_outdated` | Check for newer versions |
| `dshm_upgrade` | Upgrade to the latest |
| `dshm_toggle` | Toggle a plugin on/off (confirm by default, execute directly when the user already asked in the same message) |
| `dshm_restart` | Restart DSH Web (with user consent) |

## CLI

```sh
dshm search [--query topic] [--category ui] [--source community|primary|all] [--limit N] [--offset N]
dshm list | outdated | registry
dshm install --id dsh-web-search [--force]   # --force: skip the precheck gate after confirming the risk
dshm upgrade --pkg dsh-web-search --yes [--force]
dshm uninstall --pkg dsh-web-search --yes
dshm toggle --pkg dsh-web-search --on|--off --yes   # file-level edit; applies on restart
dshm restart --yes
```

When the registry is unavailable, `registry` / `search` / `outdated` print the configured vs active address and exit 1; `list` still shows installed plugins. The CLI uses its own cache namespace and never touches the Web side's.

**Profile target**: the CLI always acts on the web profile — `--profile web` makes it explicit; `--profile desktop` is rejected outright (Desktop plugin management belongs to the official Desktop app). On headless hosts you can still install the plugin via the official `dsh` CLI: `dsh plugin --profile web add dsh-m`.

> `npm install -g dsh-m` installs only the `dshm` CLI (terminal management) — it does **not** register the plugin into the web profile; it can coexist with the official-manager install.

## Community catalog (awesome-dsh-plugin)

**The community catalog is dsh-m's default catalog**: anchored to the npm package [`dsh-plugin-catalog`](https://www.npmjs.com/package/dsh-plugin-catalog) (CC0-1.0, the full awesome-dsh-plugin directory, 4,000+ entries). On top of it sits the hand-curated **curated registry** (registry.json); the data layer merges and dedupes (the curated registry **always takes precedence**, duplicate community entries displaced), and the display layer splits into Community / Curated zones (ADR-0004) — the community zone no longer shows entries duplicated by the curated registry, and the curated zone stays a single curated-order page.

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/community-catalog.webp" alt="Market view, Community zone — Community / Curated / Favorites tabs, the search row, and counted open category chips" width="86%">
  <p><sub>Community catalog · the default landing zone: zone tabs, persistent search, and counted open category chips</sub></p>
</div>

- **Fetch chain**: dist-tags probe → jsDelivr pinned fetch → npmmirror → unpkg fallback; unchanged versions are not re-fetched, probes are skipped within TTL. Latest-version probes use a memory-only cache: it is dropped on every DSH restart (publish a new version, restart, and the new version shows up), and a plugin's cached entry is invalidated immediately after a successful install/upgrade/uninstall via dsh-m. On failure it falls back to the runtime cache under `<cache dir>/awesome/` and **explicitly labels it "cached snapshot"** — stale data never masquerades as fresh.
- **Switch & pin**: `communityCatalog` toggle in Settings (default on, live), `communityCatalogPin` to lock the catalog version (exact semver); CLI opt-out with `DSHM_COMMUNITY_CATALOG=0`, pin with `DSHM_COMMUNITY_CATALOG_PIN`.
- **Categories & search**: community categories are an open set (23 known categories with bilingual labels — Chinese maintained in-repo as the single source of truth, English from the upstream catalog, served per UI language); search runs a relevance-weighted pipeline (Chinese + English); the community zone offers a sort switch (downloads/stars/added × asc/desc, default downloads-desc; missing downloads ≠ zero downloads).
- **Install semantics**: community entries go through the same install path as curated entries (npm exact version / GitHub pinned commit SHA); the browse page probes npm entries only — GitHub entries are not probed at page level (anonymous 60 req/h quota is uncontrollable).
- **Installed-page budget (best-effort)**: update checks for GitHub-sourced plugins are capped at ≤25 wire requests per run and ≤50 per rolling hour per host process (passive checks only; active install/upgrade unaffected); capped items are honestly labeled "check incomplete" instead of "all up to date". A standalone CLI process does not share the host budget and makes no guarantee under concurrency.
- **Capability disclosure**: capabilities/red lines appear only in the detail fold (**absent = not scanned ≠ not detected**), never as card badges; screenshots load only in the detail layer and pass a client-side allowlist.
- **Not a security review**: the community catalog is all-inclusive and **not security-reviewed** — verify plugin origin and capabilities before installing; the curated registry's curation and CI checks do not apply to community entries.

## Curated registry (registry.json)

The curated registry is hand-curated, layered on top of the community catalog (duplicates always defer to it), and organized into **five curated buckets**: Essentials / Cui's Picks / iasi In-house / Tencent Lighthouse / Watchlist. It currently includes DSH Skins, DSH TUI, ModSearch, Better Sidebar, DSH Context, and more.

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/curated-registry.webp" alt="Market view, Curated zone — Community / Curated / Favorites tabs and the five curated-bucket chips (Essentials / Cui's Picks / iasi In-house / Tencent Lighthouse / Watchlist)" width="86%">
  <p><sub>Curated registry · the five curated buckets: Essentials / Cui's Picks / iasi In-house / Tencent Lighthouse / Watchlist</sub></p>
</div>

The registry is fetched at runtime over two lines — **GitHub raw (`@main`) → GitHub mirror (jsDelivr CDN, backup)** — ordered adaptively by the last successful route, falling back to the local 60-min TTL cache and the bundled snapshot. Listing updates stay decoupled from plugin releases: after a push, allow up to one cache period (or force a refresh in Settings). To add or amend a listing, edit `registry.json` and open a PR; CI validates the strict schema, npm/GitHub existence, duplicate ids and URL reachability.

**Custom curated registry (replaces the default)**: the Settings tab supports a single custom registry address that **replaces** the default curated registry (no merging) and **only affects the Curated zone** — the community catalog is untouched:

1. "Download default registry" gives you a copy of the official listing;
2. edit the copy yourself (add/remove entries);
3. paste its address in Settings and hit "Validate & apply" — an **HTTPS URL**, a local **absolute path / `file://`** (HTTP only for 127.0.0.1/localhost debugging);
4. validation failures (bad fields, missing path, over 2 MiB / 1,000 entries, …) are never saved — the currently active registry stays; a successful apply takes effect **immediately, no restart** (only the first deploy of a new dsh-m version needs one restart);
5. "Restore default" switches back to the official registry in one click.

Rules and limits: strict v1 schema (unknown fields / invalid ids / oversized values / duplicates reject the whole file, never truncated); the copy is a standalone snapshot and does **not** auto-sync with the official listing; a failing custom source keeps its own last good cache and never silently falls back to the official registry; old custom-source caches are cleaned after switching (the default cache is kept); custom registries are not validated by official CI — install only from sources you trust; full local paths appear only on the Settings tab, tools and cards show short statuses.

Security baseline: HTTPS-only fetches (loopback HTTP excepted) with per-hop redirect checks, size caps and timeouts; npm installs verify the exact version's dist integrity against the pnpm lockfile — mismatches fail closed and roll back; GitHub installs pinned to commit SHA; pnpm build scripts are allowed-by-policy with an explicit report when unblocked.

## Documentation

| Doc | Read it when |
|---|---|
| [CHANGELOG.md](https://github.com/iasiv5/dsh-m/blob/main/CHANGELOG.md) | You want the details of any release (bilingual, complete back to 0.4.x) |
| [docs/DESIGN.md](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md) | Design consensus, panel behavior details, dual-generation compatibility, and the restart chain; development & release workflow in its §6 |
| [docs/adr/](https://github.com/iasiv5/dsh-m/tree/main/docs/adr) | Architecture decisions: delegation & fallback, precise build approval, community catalog merge, zoned market, dual profile |
| [docs/registry-copy-guide.md](https://github.com/iasiv5/dsh-m/blob/main/docs/registry-copy-guide.md) | Writing descriptions and tags for curated registry entries |
| [docs/plans/](https://github.com/iasiv5/dsh-m/tree/main/docs/plans) | Implementation plan archive, one per release |

## FAQ

**1. Why don't GitHub-sourced update hints follow main?**
Intermediate commits on main can be unstable. dsh-m tracks **releases / tags** only (`releases/latest` first, tags list as fallback) and pins the commit SHA the tag points to.

**1.5 What works on the official Desktop?**
Desktop (the `desktop` profile) supports browsing the market, **installing new packages**, and plugin toggles. Since 0.9.8, upgrades, uninstalls, and dsh-m self-updates are also delegated to the official `pluginManager`; an unavailable service returns a structured refusal with guidance. One-click restart remains part of the official Desktop app lifecycle, so quit and reopen the app. Installed badges and the installed list reflect only the Desktop profile; favorites and operation logs do not sync with Web.

**2. Does uninstalling dsh-m delete my data?**
No. Only the package reference in the profile is removed (live UI disabled first), and suspected leftover paths are reported to you.

**3. Will a custom registry slow the market down?**
The market list is server-paginated (24/48/96 per page); even a 1,000-entry registry queries latest versions for the current page only, so browsing stays fast.

**4. What if my custom source goes down?**
dsh-m serves its last successful cache for that source (the Settings tab's effective-source row labels it honestly); with no cache at all the market reports the listing unavailable while installed plugins stay manageable. Fix the address or restore the default anytime.

**5. Which DSH Web versions are supported?**

| DSH version | Settings path | Verification |
|---|---|---|
| `0.1.2-rc.1` | shape-detection fallback to the cordis config-file path | contract-checked |
| `0.1.5-rc.1` / `rc.2` | `register()` scope path | checked; rc.1 additionally live-verified `/dshm` ping and authenticated `303 → 200` |
| `0.1.7-rc.1` / `rc.2` | Config `.volatile()` fields + `settings.update` + the `loader/volatile-update` event | checked; the two rcs ship byte-identical dsh-settings, so one implementation covers both |
| `0.2.0-rc.1` / `rc.2` | same as `0.1.7` | `rc.2` is the current live runtime; the restart chain was live-verified on 2026-10-01 |

- The path is chosen by runtime **shape detection**, not version branching; unrecognized shapes degrade to the cordis config-file path with marketplace features unaffected. Implementation details: [`docs/DESIGN.md`](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md) §12.
- Systemd deployments must configure `Restart=on-failure` or `Restart=always`; otherwise use the deployment's manual restart procedure.

## License

MIT
