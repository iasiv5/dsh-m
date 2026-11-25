# dsh-m threat model

## System overview
dsh-m is a DeepSeek Harness (DSH) plugin that adds a plugin marketplace. It runs **inside the DSH host process** (Web or Desktop profile) with that process's privileges. It lists a curated catalog (`registry.json`, or a configurable registry URL) and a 6,000+ entry community catalog. Its job is to install, upgrade, uninstall and toggle plugins in the active DSH profile: it spawns `dsh plugin` / pnpm, edits profile files (`package.json`, `pnpm-workspace.yaml`, `cordis.patch.yml`), and restarts the host. You can drive it through three surfaces:
- The `/dshm` local API, used by the sidebar panel.
- Seven agent tools.
- The standalone `dshm` CLI.

**Deployment (user-provided):** the DSH Web host running dsh-m **may be exposed to the internet**. There is no separate deployment infrastructure; dsh-m ships as the npm package `dsh-m`, published from GitHub Actions with OIDC trusted publishing.

## Components
| Component | Code | Notes |
|---|---|---|
| Host API | `src/host.ts`, `src/core/host-api.ts` | Single `POST /dshm` route with a method dispatcher (ping, market, readme, install, uninstall, upgrade, self-upgrade, set-enabled, restart, registry-config-apply, set-community, doctor, …). |
| Agent Tools | `src/tools.ts`, `src/core/session-gate.ts` | `dshm_search/list/install/toggle/uninstall/upgrade/restart` plus a system-prompt segment, gated by the sessionTools/sessionPrompt switches. |
| Install & Profile Ops | `src/core/dsh-cli.ts`, `profile-ops.ts`, `profile-transaction.ts`, `market-mutation.ts`, `build-approval.ts`, `exec-route.ts`, `restart.ts`, `toggle.ts`, `patch-yaml.ts`, `atomic-write.ts`, `install-guard.ts`, `local-allow.ts` | Spawns processes, writes profile files, handles build approvals (`allowBuilds`, per-item echo-gated; the `dangerouslyAllowAllBuilds` fallback was removed by the security fix, see ADR-0002 revision) and restarts. |
| Supply-chain Verification | `src/core/npm-integrity.ts`, `lockfile.ts`, `packument.ts`, `ustar.ts`, `npm-route.ts`, `httpx.ts`, `versions.ts`, `release-age.ts` | Exact npm version + integrity pinning, GitHub commit SHA pinning, registry route selection, HTTPS-only fetch primitive. |
| Catalog & Registry | `src/core/registry.ts`, `registry-controller.ts`, `community*.ts`, `market*.ts`, `merged-market.ts`, `registry.json`, `scripts/validate-registry.mjs` | Loads and merges untrusted catalog data. |
| Web Panel | `src/client/**` | React panel that renders catalog entries, READMEs (`markdown.js` safeUrl + HTML allowlist), icons and screenshots. |
| CLI | `src/cli.ts` | Local `dshm` command; env overrides such as `DSHM_NPM_REGISTRY` and `DSHM_LOCAL_UPGRADE_ALLOW`. |
| Release CI | `.github/workflows/**`, `scripts/release*.mjs` | npm publish with provenance; registry check workflow. |

## Trust boundaries and entry points
1. **Remote HTTP → `/dshm` (Host API).** With an internet-exposed Web host, anyone on the internet can send requests. The only gate is DSH's `connection.requestRejection` (Host/Origin/cross-site/auth), which dsh-m calls first and which fails closed to 403 if absent or if it throws. After that come: POST only, JSON Content-Type, a capped body. Mutating methods lead directly to code execution on the host (installing a package and running its build scripts, restarting the host).
2. **LLM agent → Agent Tools.** Tool arguments can be steered by prompt injection from catalog descriptions, READMEs or web content the agent reads. The tool descriptions ask for user confirmation before force / approvedBuilds retries.
3. **Catalog / registry / npm / GitHub data → Catalog & Registry, Supply-chain Verification, Web Panel.** Untrusted third-party content: entry names, specs, URLs, descriptions, READMEs, packuments and tarballs. A configurable registry URL (`registry-config-apply`) changes what the curated catalog says.
4. **Local environment → CLI / Install & Profile Ops.** Environment variables, `.npmrc`, and profile files on disk.

## Assets
- **Integrity of the user's machine (critical, user-provided):** no code execution the user did not choose. This covers unintended plugin installs or upgrades, enabling dependency build scripts without consent, command or argument injection into spawned `dsh`/pnpm, and writes outside the profile.
- Integrity of the DSH profile (installed plugins, `cordis.patch.yml`, lockfiles, config).
- Install provenance: exact npm version + integrity, GitHub SHA pinning, choice of registry.
- The panel's browser origin, which shares DSH's origin (XSS there could call `/dshm`).

## Attacker profiles that matter
- **Unauthenticated remote attacker on the internet (user-provided: the Web host may be internet-exposed).** Wants to reach `/dshm` mutations directly, or cross-site through a victim's browser (CSRF / DNS rebinding), to make the host install or run code.
- **Malicious catalog or registry content author.** Publishes a community entry or README, or controls a configured registry URL, to get XSS in the panel, inject arguments into install specs, or prompt-inject the agent.
- **Network attacker / malicious mirror** between the host and npm, the npm mirror or GitHub. Wants to swap artifacts past integrity/SHA pinning.
- **Prompt-injection attacker steering the agent.** Not ruled out by the user.

## Existing controls
- `/dshm` trust check delegated to DSH `connection.requestRejection`, fail-closed, before any body read. POST + JSON Content-Type only; body cap.
- Spec and package-name allowlist regexes (`dsh-cli.ts`, `packument.ts`). Process-group timeout; output capped at 256 KB.
- npm: exact version + `integrity` verification. GitHub: commit SHA pin. Peer-compat precheck requires explicit `force`.
- Precise build approval on both web and desktop paths: `allowBuilds.<name>: true` is written only for package names the caller echoes back in `approvedBuilds` (originally returned as `pendingBuilds`, after user confirmation); otherwise a structured `needsBuildApproval` result is returned with zero writes. The `dangerouslyAllowAllBuilds` fallback no longer exists — it was removed by the security fix (a blocked install fails closed instead; ADR-0002 revision).
- Explicit install/upgrade `version` on desktop paths must be an exact semver, and the final spec is asserted to be `<pkg>@<exact semver>` before delegation (rejects `npm:`/`github:`/tarball/`file:` source-prefix smuggling).
- `httpx.ts`: HTTPS only (loopback http allowed), at most 3 manual redirects with per-hop `assertSafeUrl`, size cap, timeout.
- `markdown.js`: no raw HTML injection; tag/attribute allowlist; every URL goes through `safeUrl` (http(s)/mailto/anchor only).
- Atomic writes for profile files; `install-guard` checks after install.
- Local-deploy upgrade allowlist (`local-allow.ts`) limited to maintainer-owned packages.

## Out of scope / accepted risk (user-provided)
- **Malicious code inside a plugin the user deliberately chose to install** from the catalog. The catalog is not a security review. Tricking or forcing an install, swapping the artifact, or enabling build scripts without consent stays in scope.

## Open questions
- Does DSH's `requestRejection` require authentication on an internet-exposed Web host, or only check Host/Origin? This decides whether an unauthenticated remote request can reach `install`.
- Whether `registry-config-apply` / `set-community` (changing catalog sources) should require extra confirmation.

## Pending security fixes
Known, **not yet fixed** security issues are tracked as private draft repository security advisories, never in public issues or PRs (see `SECURITY.md`). Before working on security fixes, check https://github.com/iasiv5/dsh-m/security/advisories (Security → Advisories), which needs maintainer access.

**Fixed issues are publicly recorded in the repo itself.** The two findings from the 2026-11 Devin security scan were fixed and shipped in 0.12.25: `sfind-5dbc…` (web install path auto-wrote build-script approvals, and permanently disabled pnpm's build gate via the `dangerouslyAllowAllBuilds` fallback) and `sfind-d4bd…` (desktop install/upgrade spliced an unvalidated `version` into the install spec). Public records: the CHANGELOG 0.12.25 entry, the ADR-0002 revision, and the DESIGN.md security baseline.
