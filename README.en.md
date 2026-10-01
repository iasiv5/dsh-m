# dsh-m — Plugin Marketplace for DeepSeek Harness

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.2.0--rc.2%20dual--API-2563eb)](#faq)

English · [中文](./README.md)

A DeepSeek Harness (DSH) plugin marketplace with a customizable registry: **browse, install, uninstall, upgrade** — all local. Ships as a DSH web plugin: the "Plugin Marketplace" sidebar entry opens a three-view panel, backed by eight `dshm_*` agent tools and the `dshm` CLI. The same package installs into **both the Web (`web`) and official Desktop (`desktop`) profiles** (0.9.0+; capability table in the changelog).

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp" alt="Plugin Marketplace panel — Market view: Community / Curated / Favorites zones, category chips, and plugin cards (verified / installed badges, npm & GitHub detail links)" width="100%">
  <p><sub>The "Plugin Marketplace" panel · Market view (Community 4,200+ · Curated 23 · Favorites): click a card to install</sub></p>
</div>

## Quick start

**Paste this whole block to your agent to install:**

```text
Install and enable the DSH plugin dsh-m:
1. Run `dsh plugin --profile web add dsh-m`
2. Restart DSH Web to load the plugin (restart the DSH user unit used by your deployment; do not hardcode a unit name)
3. Poll `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080` until it returns 200 again
4. Run `curl -s -X POST http://127.0.0.1:3080/dshm -H 'content-type: application/json' -d '{"method":"ping"}'` and confirm the reply has `plugin: dsh-m`
5. Then remind me to refresh the page and click "Plugin Marketplace" at the bottom of the sidebar
```

> `npm install -g dsh-m` installs only the `dshm` CLI (terminal management) — it does **not** register the plugin into the web profile; it can coexist with the plugin install above.

The default registry includes DSH Skins, ModSearch, the Lark / QQ / Weixin / WeCom / DingTalk channel bridges, and dsh-m itself.

## Panel

| View | Capabilities |
|---|---|
| **Market** | **Zoned** (0.7.0): **Community** (default landing, the 4,000+ full catalog) and **Curated** (hand-picked primary registry, single page) as two independent zones — each keeps its own category/search/sort/pagination state across tab switches; plus a **Favorites** zone (browser-local bookmarks with delisted-entry detection and one-click cleanup). Community zone: two-row collapsible category chips with sticky collapse, sort switch (downloads/stars/added × asc/desc), windowed pagination (24/48/96 per page), card byline (owner/downloads/stars); clicking a card opens a **detail modal** (superset of the card: download window, screenshot lightbox, capabilities collapsed by default, install command); npm sources pin the latest exact version, GitHub sources pin the release/tag commit |
| **Operations** | Install/upgrade/uninstall/toggle all flow through a global operation log (0.7.0): state lives off cards, surviving paging/searching/tab switches; persisted to localStorage and resumed after host reloads (each restored op re-validated "still applies" before executing); benignly-invalidated ops show as a neutral "skipped"; the Installed page gains "Update all (N)" batch queueing |
| **Installed** | What the current profile (web / desktop, 0.9.0+) actually has, annotated "via market / non-market"; update badges, upgrade, two-step confirm uninstall; 📖 README preview (64KB cap); **live phase badge** (●active / ●failed / ○pending) and a **one-click toggle** (0.4.0: delegates to the official pluginManager service for live application; falls back to file-level edits + restart notice when absent; dsh-m itself and official host lifelines are locked) |
| **Settings** | Registry address draft with "Force refresh / Validate & apply / Restore default / Download default registry.json"; configured vs active address and status at a glance (shown only when abnormal); community catalog toggle; dsh-m self-update |

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/settings.webp" alt="Settings view — community catalog status card (catalog version / route / entries), curated registry configuration card (address draft with force-refresh / validate & apply / restore default / download), and the About card" width="86%">
  <p><sub>Settings view · community catalog status, curated registry configuration, and dsh-m self-update</sub></p>
</div>

The restart chain below applies to **Web only** (Desktop takes effect via the official app lifecycle: after installing, quit and reopen the Desktop app — see the 0.9.0 section). After any mutation, the already-open Market and Installed views refresh the profile state together, keeping badges and cards in sync without closing and reopening the marketplace; a "⚡ Restart" banner appears — under systemd, the DSH launcher's `appExit` hook hands the restart back to a unit configured with `Restart=on-failure` or `Restart=always`, avoiding a `systemctl` helper inside the unit cgroup that is about to stop; if `appExit` is unavailable, the fallback uses a manager-owned transient `systemd-run` service and only then a detached helper. The client confirms the replacement by boot id and dismisses the banner, leaving DSH Web's own background connection recovery in control; it does not force a full-page reload during the auth/route handoff. The restart chain has been live-verified on the current DSH Web `0.2.0-rc.2` (2026-10-01): dsh-m probes the unit's `Restart=` policy, hands the stop back via `appExit`, the `status=75/TEMPFAIL` exit is caught by the Restart policy and auto-started, and after recovery the page reconnects in the background with the panel fully functional. Historical scope: the `0.1.5-rc.1` era covered live `/dshm` ping and authenticated `303 → 200` checks; `0.1.2-rc.1` is covered by contract checks plus runtime shape-detection fallback (see the verified array) — with the deployment moved on, no live E2E is chased on retired generations; the transient `systemd-run` fallback only applies to hosts without `appExit` (all supported generations provide it) and stays a documented fallback rather than a release gate; repeated install/uninstall is covered by the profile-transaction test surface (compensation, post-install guard, 813 cases) plus the 0.4.0→0.4.2 consecutive-release evidence. Installs stream live pnpm progress (resolve → download → link → build).

### Fixed in 0.9.5 — GUI read paths missed the active profile on Desktop (Installed tab always showed web)

- **Root cause**: the 0.9.0 dual-profile wiring missed the `installed` / `market` read paths in the Host API — `listInstalledWithMeta` / `listMarket` fell back to `webProfileDir()`: on Desktop the Installed tab always said "no plugins installed in this web profile" and the market "installed" badges stayed empty (the agent-tool surface `dshm_list` was wired correctly, so only the GUI was wrong).
- **Fix**: both now pass `profileDir: profile.dir` + `profile: profile.name` (same as the tools surface; profileContext as the single source of truth); registry/community cache segments follow the `profile` parameter automatically.
- **Copy**: the hardcoded "web profile" in the installed empty/loading states and the profile hint is now profile-neutral (the actual path is still shown).

### Fixed in 0.9.4 — Fullscreen header eaten by the Windows Desktop titlebar (tabs / restore unreachable)

- **Root cause**: on Windows Desktop the shell runs `titleBarStyle:hidden + titleBarOverlay` — the top 40px of the window is a full-width `-webkit-app-region:drag` band (drag hits are decided by layout and ignore z-index / paint order), and the OS-drawn — □ ✕ caption buttons float above everything. The maximized panel header landed inside that band: tab clicks were swallowed by window dragging and the restore/close buttons were covered by the system buttons — no way back.
- **Fix**: the same approach the shell uses for its own overlays — consume the `--dsh-windows-titlebar-height` variable the shell sets on `html` (fullscreen `top:var(…)`; floating `padding-top:max(24px,var(…))`, which also fixes the short-window edge case where the floating panel's top edge sat under the band).
- **Zero drift on Web**: browsers / DSH Web have no such variable — it falls back to 0px, byte-identical to 0.9.3.

### Fixed in 0.9.3 — Windows native support (verified on a real Windows host)

- **Registry atomic writes**: temp file names were derived with `split('/')`, but Windows paths separate with `\` — the "basename" came out as the entire path, the temp-file open always failed silently, and every cache / accepted-metadata write silently failed; now uses `basename()`, identical on all three platforms.
- **Local-file registry address parsing**: `C:\…` drive paths and `\\server\share` UNC were misread as URL schemes (with a misleading "HTTPS only" error), and `file://C:/…` normalized to a drive-less dangling path that always failed with ENOENT; all three local forms (POSIX absolute / Windows drive / UNC) now parse correctly as file kind.
- **Build**: `node_modules/.bin/tsc` is a POSIX sh shim; on Windows `spawnSync` failed with ENOENT — the build now runs TypeScript's JS entry with the current Node, identical on all platforms.
- **Test surface**: on a real Windows host the full 829-case suite went from 41 failures to **0** (821 pass / 8 skipped); POSIX-only contracts (process-group/SIGTERM timing, symlink privileges, platform path assertions, fixed-sleep timing) are now labeled skips, platform-neutral, or poll-based — test contracts unchanged.

### Fixed in 0.9.2 — Header chip stuck on the old version after a service restart

- **In-place refresh once the restart is confirmed**: the moment the boot id confirms DSH Web is back, the panel re-fetches ping — the `dsh-m vX.Y.Z` chip and the profile chip sync to the new process's data instead of lingering on the old version (observed on 0.9.1: chip upgrade + restart still showed v0.9.0).
- **Refetch when the page becomes visible again**: with the panel left open while the service is restarted externally, returning to the tab refetches ping via `visibilitychange` (zero polling cost).
- **Chip version guard**: a self-check verdict whose version doesn't match the current process (stale verdict from the old process) is treated as silent, preventing "v0.9.1 ⬆ v0.9.1"-style misrenders.

### New in 0.9.1 — Header version chip upgrade notice (lights up only when an update exists)

- **Silent by default**: the panel-header `dsh-m vX.Y.Z` chip keeps the static look introduced in 0.7.5 — up to date, failed check, or a local dev build ahead of npm (ahead) never interrupt (ahead only shows a "local dev build" hint in the hover title).
- **Lights up only when outdated**: when `self-check` (npm latest vs the installed version, read-only) finds a newer version, the chip turns into a warn state showing `⬆ v<latest>`; clicking it runs `self-upgrade` (same mutation session + post-install guard) and a "⚡ Restart" banner follows on success. On Desktop the click is rejected structurally by the capability table (409, with official lifecycle guidance).
- **TTL cache + version guard**: check results are cached in browser localStorage for 30 minutes so opening the panel doesn't hit npm every time; after an upgrade + restart the cache auto-invalidates by version. Failed checks stay silent — no error is shown.

### New in 0.9.0 — Official Desktop (dual profile) support

- **One package, two profiles**: dsh-m now installs into the official Desktop's `desktop` profile (`~/.dsh/profiles/desktop`) alongside the Web `web` profile; the catalog, panel, and agent tools are shared, and everything manages the host's current profile (official `profileContext` as the single source of truth).
- **Entrust admission to the host**: every `/dshm` method (including ping and unknown methods) delegates to the official `connection.requestRejection()` before any body is read (trustedHosts / loopback / cross-site / `Origin: null` semantics come from the host); rejected requests consume no body and call no business logic; hosts without the capability fail closed. **Behavior change**: the old home-grown "missing Origin → 403" guard is gone — Origin-less requests from the Desktop bridge are admitted per official semantics, and unauthenticated health probes now follow host trust instead of a blanket 403.
- **Desktop first-release capability table**: read-only market + **installing new packages** (delegated to the official `pluginManager.installBundle`; integrity, locking, and application phases stay with the official manager) + **toggles** (delegated; structured refusal when the service is absent, never a file-level fallback); **upgrade / uninstall / self-update / one-click restart** return structured 409 refusals with official-entry guidance (no official upgrade API exists; restarts belong to the Electron lifecycle); build scripts retry with the exact official `pendingBuilds` list — never an allow-all.
- **Per-profile read model and cache**: market installed-badges, the installed list, and README previews only read the current profile; registry / community / accepted-source caches are segmented per profile (web keeps its legacy paths — zero migration, zero clearing); favorites and operation logs stay per browser origin and do not sync between Web and Desktop.
- **CLI always targets the web profile**: `--profile web` is explicit; `--profile desktop` is rejected with a pointer to the official Desktop plugin management page.
- **Honest limitations**: Desktop on-device (Win/macOS) E2E has not been run; the `registry.json` verified arrays gain **no** Desktop generation (to be recorded after real testing); dsh-m's file-level post-install guard is skipped on Desktop (app.asar probing blind spot) and replaced by official result checks plus a `listBundles` re-read.

### Fixed in 0.8.5

- **dshm_upgrade fake success on guard blocks**: when an upgrade hit the post-install guard (e.g. link/file-sourced plugins cannot be auto-rolled-back), the text output was mis-rendered as "✅ undefined 已升级（最新）"; it now reports the block reason, compensation status and repair basis honestly, consistent with the card title (Guard block).

### Changed in 0.8.4 — Category labels now follow the UI language

- **Community categories**: English names for the 23 known categories come straight from the upstream catalog's `categories.en`; under the English UI, category chips and the category row in detail/favorite modals show English. Upstream categories without an English name fall back to Chinese and keep rendering as raw slugs in the temporary group until labels land in a release. The Chinese UI is unchanged.
- **Curated categories**: the five chips now go through the bilingual dictionary (Market/Tools/UI/Search/Other ⇄ 市场/工具/界面/搜索/其他), consistent with the detail modal.
- **Implementation**: the summary carries `categoryLabelsEn` (derived from the upstream catalog in `communityOutcome`; ids without English are omitted — no second hand-maintained table), and the client merges per UI language. 0.8.1–0.8.3 were local iteration numbers with no separate changelog surface.

### Changed in 0.8.0 — Settings page redo (aligned with the zoned dual-catalog positioning)

- **Information architecture**: Community catalog (from awesome-dsh-plugin) → Curated registry (registry.json) → dsh-m itself → About; the primary registry's user-facing name is now unified as "Curated registry".
- **Community catalog toggle**: a new GUI switch (live effect, instant, no confirm; when off the whole card collapses to one line); new `set-community` API.
- **Curated registry slimmed**: status fields consolidated from 7 rows to 4 (merged address, removed the hard-coded "caching" row); config status only appears when abnormal; buttons reduced to "Force refresh / Validate & apply / Restore default / Download default registry"; "Check entries reachability" removed from the GUI (`registry-diagnose` API kept).
- **Copy fixes**: the custom-source note now says it replaces the whole primary registry and only affects the Curated zone; removed the hard-coded TTL description that didn't match reality (`timeoutMs`/`cacheTtlMin` remain config-file settings).
- **dsh-m itself**: when the local dev build is ahead of npm, show "local dev build" instead of the misleading old "npm latest" (new `ahead` field).
- **About**: copy aligned with the current positioning, plus GitHub repo and issue-tracker links.

### Polished in 0.7.10

- **Head split into three groups**: a hairline divider between the title and tab navigation — "title | nav | status + window controls" reads clearly.
- **Version badge unified color**: the v-number no longer uses the bright primary text color; it matches the dsh-m name in secondary gray.
- **Vertical rhythm consolidated**: window-control cells 26→28px to match tab height; version badge adjusted to 24px; maximize/restore icons unified at 12px; title weight 700→600.

### Fixed in 0.7.9

- **Category chips keep a stable order**: retired the "promote active to front" reordering (every click on a clipped category used to jump it to first place). Instead, when the active category falls inside the collapsed clip region, the row auto-expands so the active filter stays visible — same goal, stable order; a manual collapse under the same active category is respected, and picking another clipped category or "All" resets it.

### Changed in 0.7.8

- **Root cause fix for "maximize does nothing" — CSS hot-update self-healing**: the panel stylesheet was only injected once (`#dshm-css` present → skip), so after a hot update the stale stylesheet lacked rules for new classes (fullscreen/window controls) — new features appeared dead and buttons rendered as unstyled natives. The injected stylesheet now carries a content hash (djb2); reopening the panel after a bundle update swaps in the fresh styles automatically, no page refresh needed.
- **Window-control group recolored**: dropped the raised surface for a transparent background + hairline outline (same language as the search clear button); cells widened 34→44px against mis-clicks; close keeps its red hover.

### Changed in 0.7.7

- **Fullscreen ported from dsh-market**: a maximize/restore control joins the panel head as a unified window-control group (equal-width maximize + close cells, hairline divider, shared SVG line icons; close tints red on hover). Fullscreen fills the viewport without rounded corners, the state is remembered in localStorage, and Esc still closes the panel.
- 0.7.6 catch-up: version badge de-bolded and made static (no copy-on-click); sticky category row's top gap fixed (sticky anchor shifted to offset container padding); close/clear buttons moved to the outlined flat style.

### Changed in 0.7.5

- **Header version chip now shows dsh-m's own version** (`dsh-m v0.7.5`, click to copy; the DSH runtime version lives in Settings and `dshm ping`).
- **× close/clear buttons redrawn**: search clear, detail-modal close, and operation-row remove now use an SVG line icon on a dedicated hover-tinted button; the search clear button floats inside the pill's right edge.
- **Fixed the dsh-market peer warning**: `@deepseek-ai/dsh-tools` peer changed from `*` (strict semver never matches rc prereleases) to the explicit range `^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`; newer rc lines (e.g. 0.3.0-rc.x) need another entry.

### Changed in 0.7.4

- **Panel tabs reverted to the classic segmented style** (0.7.2 mistakenly introduced underline tabs; the rounded button group with a highlighted active tab is back).
- **Full-width search**: fixed the search wrapper missing `display:flex`, which kept the input from stretching to the row.
- **Filter button and page-jump control recolored**: the filter button now uses an elevated surface with squared corners to stand apart from the pill category chips (accent outline when open); the page input is a slim pill with a hairline border and an accent-colored "Go" text button.
- **Sticky category row fully opaque**: the background now uses the opaque base token directly (the previous color-mix translucency still let card text bleed through on the dark theme); the bottom divider stays.

### Changed in 0.7.3 (includes 0.7.2)

- **Home layout modeled after dsh-market**: the market view becomes "zone chips → full-width search row → category chips with a trailing Filter popover"; the popover gets its own look (rounded rectangle + leading chevron) and holds sort field (npm downloads/stars/date added), direction, and page size (the old sort dropdown and pager page-size select are retired).
- **Favorites cards open the detail modal**: fixed favorites-zone cards not responding to clicks — favorite snapshots lack full fields, so opening resolves the complete entry by id (in-memory zones → market API → snapshot fallback), reusing the detail modal and the full install path (peer confirm included).
- **Page-number jump**: the pager gains a page input — type a valid page and hit Enter or "Go" to jump.
- **Frosted sticky category row**: the sticky row now blurs content beneath it (backdrop blur + divider), so card text no longer bleeds through.
- **Removed by request**: the "discover/request listing" line (dsh-m does not accept listings), the "Tasks" button (operations panel is always visible again), and the "Refresh" button (force refresh lives in Settings).
- Note: registry entries carry no host-version requirement field, so dsh-market's "host version" filter has no data source here and was not replicated.

### Fixed in 0.7.1

- **Community entries are installable again**: fixes a 0.7.0 regression where installing a community listing failed with "registry 中没有该条目" (install-by-id only consulted the primary registry, never the community catalog); the path now mirrors upgrades — on a primary miss the catalog is searched by id.
- **Compact market header**: search, refresh, and sort (community zone) move into the zone chips row; informational source banners ("official default registry / custom registry / served from local cache") are retired — their "{count} listings" figure was never wired up (always 0); the "registry unavailable" error and community fallback/stale hints remain.

### New in 0.7.0

- **Zoned market** ([ADR-0004](./docs/adr/0004-zoned-market-display.md)): the dual-catalog data merge stays, but the display splits into Community (default) / Curated / Favorites zones; `dshm_search` and `dshm search` switch to `--source community|primary|all` + `--offset` real pagination (default 10 cards) — `primary_only` is retired.
- **Relevance search**: NFKC normalization + CJK↔Latin boundaries + field weighting (name/npm > owner > description > category > tags), multi-term same-field matching; whole-id exact match takes top priority.
- **Operation log + resume executor**, **local favorites + delisted cleanup**, **detail modal + screenshot lightbox**, community byline/deprecated badges/catalog-snapshot version fallback (never used for outdated).

### New in 0.4.0

- **Enablement toggle**: one-click on/off per installed card; internally routed to a row override (single-row plugins, applies live) or bundle selection (multi-row); the write path delegates to the official `pluginManager` service and falls back to direct loader operations when absent ([ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)).
- **Live phase badges**: a projection of loader fiber state — failed plugins are visible at a glance.
- **Protection roster**: `dsh-m` itself plus the 16 official host lifeline modules cannot be toggled or uninstalled (upgrades unaffected).
- **Precise build approval**: when pnpm blocks build scripts, only the pending list is approved key-by-key; the allow-everything fallback is labeled honestly ([ADR-0002](./docs/adr/0002-precise-build-approval.md)).
- **Peer compatibility precheck**: install/upgrade validates `@deepseek-ai/dsh(-*)` peers against the runtime version before touching the profile (GitHub sources state the check was skipped); on mismatch the GUI asks, the agent tool returns structured data, the CLI takes `--force`.
- **Verified runtimes**: an optional `verified` array per registry entry records DSH runtimes actually tested — a claim of record, not a prediction; display-only, never gates installs.
- **Bundle identity check**: post-install warning when a package lands without a patch layer ("installed as a plain dependency").

### Retired in 0.4.x

- **Metadata source probe**: 0.4.0 introduced an npmjs / npmmirror ping race to pick the metadata read source; it has been removed entirely (including the `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` settings and the settings-page display). The official counterpart probe only pre-selects a registry in the interactive install dialog, which dsh-m does not have, and npmjs measured consistently faster from the host, so the probe always equaled the default. Metadata reads now always use npmjs, matching the install path (profile `.npmrc` default).

## Agent tools (8)

| Tool | Purpose |
|---|---|
| `dshm_search` | Search the curated registry (renders cards in chat) |
| `dshm_list` | List installed plugins (market / non-market annotated) |
| `dshm_install` | Install by listing id (peer compatibility precheck before install; incompatible results return structured data for user confirmation, then `force` retries) |
| `dshm_uninstall` | Uninstall (confirm first; data kept, leftovers reported) |
| `dshm_outdated` | Check for newer versions |
| `dshm_upgrade` | Upgrade to the latest |
| `dshm_toggle` | Toggle a plugin on/off (0.4.0; confirm by default, execute directly when the user already asked in the same message) |
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

**Profile target (0.9.0)**: the CLI always acts on the web profile — `--profile web` makes it explicit; `--profile desktop` is rejected outright (Desktop plugin management belongs to the official Desktop plugin management page).

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

## Community catalog (awesome-dsh-plugin, 0.5.0)

On top of the hand-curated primary registry, the market layers a **read-only community catalog** anchored to the npm package [`dsh-plugin-catalog`](https://www.npmjs.com/package/dsh-plugin-catalog) (CC0-1.0, the full awesome-dsh-plugin directory, 4,000+ entries). The data layer still merges and dedupes with the primary registry **always taking precedence** (duplicate entries displace the community side); the display layer splits into Community / Curated zones (ADR-0004) — the community zone no longer shows entries duplicated by the primary registry, and the curated zone stays a single curated-order page.

- **Fetch chain**: dist-tags probe → jsDelivr pinned fetch → npmmirror → unpkg fallback; unchanged versions are not re-fetched, probes are skipped within TTL. On failure it falls back to the runtime cache under `<cache dir>/awesome/` and **explicitly labels it "cached snapshot"** — stale data never masquerades as fresh.
- **Switch & pin**: `communityCatalog` toggle in Settings (default on, live), `communityCatalogPin` to lock the catalog version (exact semver); CLI opt-out with `DSHM_COMMUNITY_CATALOG=0`, pin with `DSHM_COMMUNITY_CATALOG_PIN`.
- **Categories & search**: community categories are an open set (23 known categories with bilingual labels — Chinese maintained in-repo as the single source of truth, English from the upstream catalog, served per UI language); search runs a relevance-weighted pipeline (Chinese + English); the community zone offers a sort switch (downloads/stars/added × asc/desc, default downloads-desc; missing downloads ≠ zero downloads).
- **Install semantics**: community entries go through the same `installEntry` (npm exact version / GitHub pinned commit SHA); the browse page probes npm entries only — GitHub entries are not probed at page level (anonymous 60 req/h quota is uncontrollable).
- **Installed-page budget (best-effort)**: update checks for GitHub-sourced plugins are capped at ≤25 wire requests per run and ≤50 per rolling hour per host process (passive checks only; active install/upgrade unaffected); capped items are honestly labeled "check incomplete" instead of "all up to date". A standalone CLI process does not share the host budget and makes no guarantee under concurrency.
- **Capability disclosure**: capabilities/red lines appear only in the detail fold (**absent = not scanned ≠ not detected**), never as card badges; screenshots load only in the detail layer and pass a client-side allowlist.
- **Not a security review**: the community catalog is all-inclusive and **not security-reviewed** — verify plugin origin and capabilities before installing; the primary registry's curation and CI checks do not apply to community entries.

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

**1.5 What works on the official Desktop?**
Desktop (the `desktop` profile) first release supports: browsing the market, **installing new packages**, and plugin toggles; upgrade/uninstall/self-update/one-click restart return structured refusals with official-entry guidance (official plugin management page / Desktop app restart). Installed badges and the installed list reflect only what Desktop itself has installed; favorites and operation logs do not sync with the Web side.

**2. Does uninstalling dsh-m delete my data?**
No. Only the package reference in the profile is removed (live UI disabled first), and suspected leftover paths are reported to you.

**3. Will a custom registry slow the market down?**
Listings over 200 entries trigger a performance notice. The market list is server-paginated (24/48/96 per page); even a 1,000-entry registry queries latest versions for the current page only.

**4. What if my custom source goes down?**
dsh-m serves its last successful cache for that source and marks it as cached; with no cache at all the market shows "registry unavailable" while installed plugins stay manageable. Fix the address or restore the default anytime.

**5. Which DSH Web versions are supported?**
Same scope as dsh-skip-browser-auth: the public package contracts for `0.1.2-rc.1`, `0.1.5-rc.1/rc.2`, `0.1.7-rc.1/rc.2`, and `0.2.0-rc.1/rc.2` are all checked (0.2.0-rc.2 being the current live runtime). DSH 0.1.7 reshaped the settings service into `SettingsForms` (the old `settings.register` is gone); dsh-m stays compatible via runtime shape detection: the whole ≤0.1.5 generation uses the `register()` scope path (0.1.5-rc.2's dsh-settings still ships the old API and is covered), while 0.1.7-rc.1 / rc.2 use Config `.volatile()` fields + `settings.update` + the `loader/volatile-update` event (byte-identical dsh-settings and the same loader across both rcs, so one implementation covers both). Unknown shapes degrade to the cordis config-file path with marketplace features unaffected. All these versions expose the dsh-m `appExit` launcher hook used by the restart button, and the restart chain itself was live-verified on the current `0.2.0-rc.2` runtime (2026-10-01, see the Panel section). The 0.1.7 adaptation's live E2E was written back on 2026-09-28: install and `/dshm` toolchain liveness proven on `0.1.7-rc.2` through the consecutive 0.4.0→0.4.2 releases across two service restarts (`dshm list/upgrade` fully working, registry served normally); settings write persistence remains the only unverified bit (dsh-m's own config is already observed persisted in the profile's `cordis.patch.yml` — a GUI write → restart comparison is left for first real use of the settings panel). Systemd deployments must configure `Restart=on-failure` or `Restart=always`; otherwise use the deployment's manual restart procedure.

## License

MIT
