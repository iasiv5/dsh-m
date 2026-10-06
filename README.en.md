# dsh-m — Plugin Marketplace for DeepSeek Harness

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](https://github.com/iasiv5/dsh-m/releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](https://github.com/iasiv5/dsh-m/actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.2.0--rc.2-2563eb)](#compatibility--faq)

English · [中文](./README.md)

dsh-m brings **plugin discovery, installation, management, and updates** into one DeepSeek Harness (DSH) panel. Search the community directory and hand-curated picks together. The sidebar panel, eight Agent tools, and the `dshm` CLI share marketplace data. No additional marketplace server or account is needed; the local DSH host performs plugin operations.

![Plugin Marketplace: curated zone, categories, and plugin cards](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp)

## Quick start

In DSH's official **Plugin Manager → Add plugin**, enter `dsh-m`, select an installation source reachable from your network, and install. **Restart DSH Web and refresh the page; on Desktop, quit and reopen the app.** Open “Plugin Marketplace” at the bottom of the sidebar.

![Installing dsh-m with DSH's official plugin manager](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/official-plugin-install.webp)

On a headless Web host, you can also run `dsh plugin --profile web add dsh-m`. Requires Node.js ≥ 22; see the [compatibility table](#compatibility--faq). `npm install -g dsh-m` installs **only the standalone `dshm` CLI**, not the marketplace plugin in a DSH profile.

> In-place update support in the official plugin manager depends on the host version. If it explicitly says updates are unsupported, follow its guidance to uninstall the old version and install the new one. Uninstall does not silently erase plugin data.

## Browse, search, install

- **Community + Curated**: the community directory is on by default, with 4,000+ listings. Curated picks are organized into Essentials / Cui's Picks / iasi In-house / Tencent Lighthouse / Watchlist. Curated entries win when both catalogs list the same plugin; the community zone doesn't duplicate them.
- **Zoned browsing, global search**: each zone remembers its own category, sort, and pagination. A Chinese or English query searches both catalogs and shows their separate hit counts. Favorites provide a shortcut within the local profile.
- **Inspect before installing**: cards show origin, installation status, and version; details show the description, compatibility information, and installation entry point. npm installs pin an **exact version with integrity verification**; GitHub installs pin a **commit SHA**. Peer-incompatible installs require explicit risk acknowledgment.

| Community categories | Curated buckets |
|---|---|
| ![Community directory and open category filters](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/community-catalog.webp) | ![The five curated marketplace buckets](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/curated-registry.webp) |

![Cross-catalog search for skins: curated matches first, community matches grouped below](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/search-results.webp)

![Plugin details: category, version, origin, install command, and install action](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/plugin-detail.webp)

> **Community listing is not a security review.** With 4,000+ entries from varied sources, inspect the author, code, and requested capabilities before installing. Missing capability data means “not scanned,” **not** “no risks found.”

## Installed plugins & settings

**Installed** reflects the current host profile's actual packages: marketplace/non-marketplace origin, runtime phase, available updates, toggles, upgrades, and confirmed uninstall. Operation progress and results are tracked together. A toggle may apply live or require a restart; follow the returned result. Uninstall removes the package reference without silently deleting user data and reports possible leftover paths separately.

![Installed plugins: version, origin, runtime state, toggles; local profile path redacted](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/installed.webp)

**Settings** shows the community catalog's version, fetch route, and cache state, and lets you disable or pin its version. You can download the default curated registry, provide a custom address, and **validate before replacing the Curated zone as a whole** (the Community zone is unaffected). Failed validation preserves the active configuration; successful apply and restore-default are live, without a restart.

![Settings: community-catalog status and curated-registry configuration](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/settings.webp)

A custom registry may come from HTTPS, a local absolute path, or `file://` (HTTP is for loopback debugging only); limits are 2 MiB and 1,000 entries. A custom source is an independent snapshot and **does not sync automatically** with the default curated registry. If it fails, its own last good cache remains in use; dsh-m never silently switches back to the default. See the [registry copy guide](https://github.com/iasiv5/dsh-m/blob/main/docs/registry-copy-guide.md) and [design document](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md) for the full rules.

## Agent tools & CLI

| Agent tools | Purpose |
|---|---|
| `dshm_search` | Search community and curated catalogs; render cards in the conversation |
| `dshm_list` · `dshm_outdated` | List installed and outdated plugins in the current profile |
| `dshm_install` · `dshm_upgrade` · `dshm_uninstall` | Install, upgrade, and uninstall after confirmation; surface compatibility risks first |
| `dshm_toggle` · `dshm_restart` | Toggle runtime state; restart Web with the user's consent |

```sh
dshm search --query theme --source all
dshm list
dshm outdated
dshm install --id dsh-web-search
dshm upgrade --pkg dsh-web-search --yes
dshm uninstall --pkg dsh-web-search --yes
dshm toggle --pkg dsh-web-search --off --yes
dshm restart --yes
```

The GUI and Agent tools manage the **current host profile** (Web or Desktop). The standalone CLI, by contrast, **always targets the web profile** and rejects `--profile desktop`. `--force` may be used with install/upgrade after the user accepts a peer-compatibility risk. If the catalog is unavailable, `registry`, `search`, and `outdated` fail explicitly while `list` still lists installed packages. See the [design document](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md) for full parameters and runtime policy.

## Compatibility & FAQ

| DSH Web generation | Settings path | Verification |
|---|---|---|
| `0.1.2-rc.1` | cordis config-file fallback | Contract checked |
| `0.1.5-rc.1 / rc.2` | `register()` scope | Checked; rc.1 also page-tested |
| `0.1.7-rc.1 / rc.2` | `.volatile()` + `settings.update` | Checked |
| `0.2.0-rc.1 / rc.2` | Same as 0.1.7 | rc.2 and restart path live-tested |

**Is Desktop identical to Web?** No. Desktop browsing, new-package installation, and toggles act on the desktop profile. Upgrades and uninstalls require capabilities from the official host `pluginManager`; if absent, dsh-m returns a structured refusal and guidance. Desktop uses the official app lifecycle rather than Web's one-click restart; quit and reopen as instructed. Favorites, operations, and installed states are separate between profiles.

**When do installs or updates take effect?** On Web, follow the activation result: a client-only update needs a refresh; operations marked restart-required need consent before the host restarts, followed by background reconnection. systemd deployments need `Restart=on-failure` or `Restart=always`; otherwise use your deployment's restart method.

**Why don't GitHub updates follow `main`?** Intermediate commits may be unstable. dsh-m tracks releases/tags and pins their commit SHAs. Because anonymous GitHub API quota is limited, an incomplete passive check is labeled as such rather than “all up to date.”

**What if my custom registry goes down?** Its last successful cache is used first. Without any cache, the registry is reported unavailable while installed plugins remain manageable. Fix the address or restore the default in Settings.

Full history: [CHANGELOG](https://github.com/iasiv5/dsh-m/blob/main/CHANGELOG.md). Architecture and development details: [DESIGN](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md), [ADRs](https://github.com/iasiv5/dsh-m/tree/main/docs/adr). Screenshots were taken from a Web instance; panel version, catalog counts, and installation states vary over time and by profile. To reproduce from the source checkout, run `npm install && npm run capture:readme` with dsh-m installed on the Web host. The development-only capture script is not distributed in the npm plugin package.

## License

[MIT](./LICENSE)
