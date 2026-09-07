/**
 * 原始 pnpm 报错文本 fixtures（来源标注；供 pnpm-outcome / rollback-heal / npm-integrity
 * 共享，防各文件样本漂移——Task 11）。
 */

/** 2026-09-05 dshm_upgrade 回滚事故（事故同形摘要）：frozen overrides 失配。 */
export const CONFIG_MISMATCH_TEXT =
  '命令失败 (exit 1): ERR_PNPM_LOCKFILE_CONFIG_MISMATCH Cannot proceed with the frozen installation. The current "overrides" configuration doesn\'t match the value found in the lockfile'

/** 2026-09-05 新发布升级事故（事故同形摘要）：packument CDN 滞后导致 NO_MATCHING_VERSION。 */
export const NO_MATCHING_TEXT =
  '命令失败 (exit 1): ERR_PNPM_NO_MATCHING_VERSION No matching version found for @iasiv5/dsh-skins@1.0.3 while fetching it from https://registry.npmjs.org/'

/** v0.2.1 dsh-web-search 手工补丁真实案例（原始文本，含 ERR_PNPM_UNUSED_PATCH；样本同 tests/uninstall-patch.test.mjs rewrite 前）。 */
export const UNUSED_PATCH_TEXT =
  '[ERR_PNPM_UNUSED_PATCH] The following patches were not used: dsh-web-search'
