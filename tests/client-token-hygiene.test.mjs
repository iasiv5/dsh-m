/**
 * 令牌卫生守卫（2026-11-12 retro 落地）。
 * 根因形态：客户端样式引用主题包不存在的 --dsw-alias-* 名（Agent 集成卡 label-strong
 * 事故 a51cd7d；bg-elevated / fill-secondary / interactive-bg-selected 残留 14 处）——
 * var() 恒走浅色回退值，深色模式不可读。
 * 名单快照：@deepseek-ai/dsh-client-ui-theme@0.2.2-rc.2 的全部 138 个 alias（提取命令见
 * 01_docs/research/dsw-alias-tokens.md；主题包在仓库外、CI 不可达，故内嵌。宿主升级新增
 * alias 不影响本守卫——只有引用名单之外才红；刷新名单用提取命令重新生成）。
 * 范围：仅 --dsw-alias-*。--dsw-radius-* / --dsw-elevation-* / --dsw-mask-blur /
 * --dsw-shadow-* 属宿主其他包的命名空间，不在本守卫内（client-render-smoke 钉死的官方 token）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client')

const DEFINED_ALIAS = [
'--dsw-alias-bg-base', '--dsw-alias-bg-document-preview', '--dsw-alias-bg-document-selection',
'--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
'--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3',
'--dsw-alias-bg-mask-drop', '--dsw-alias-bg-mask-photo', '--dsw-alias-bg-module-platform',
'--dsw-alias-bg-multi-select', '--dsw-alias-bg-overlay', '--dsw-alias-bg-skeleton',
'--dsw-alias-border-inverted', '--dsw-alias-border-inverted2', '--dsw-alias-border-l1',
'--dsw-alias-border-l2', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l3',
'--dsw-alias-border-l4', '--dsw-alias-border-selected', '--dsw-alias-brand-primary',
'--dsw-alias-brand-primary-invert', '--dsw-alias-brand-primary-new-colorprimary-new-color',
'--dsw-alias-brand-text', '--dsw-alias-button-contrast-fill', '--dsw-alias-button-elevated-fill',
'--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover',
'--dsw-alias-button-ghost-active-border', '--dsw-alias-button-ghost-active-fill',
'--dsw-alias-button-ghost-active-hover', '--dsw-alias-button-info-fill', '--dsw-alias-button-info-hover',
'--dsw-alias-button-primary-dimmed', '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover',
'--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-fill-invisible',
'--dsw-alias-button-tool-bar-hover', '--dsw-alias-card-fill', '--dsw-alias-card-fill-hover',
'--dsw-alias-card-tile-fill', '--dsw-alias-chart-messages', '--dsw-alias-chart-system',
'--dsw-alias-chart-tools', '--dsw-alias-code-diff-added', '--dsw-alias-code-diff-deleted',
'--dsw-alias-file-diff-added-bg', '--dsw-alias-file-diff-added-gutter', '--dsw-alias-file-diff-added-marker',
'--dsw-alias-file-diff-deleted-bg', '--dsw-alias-file-diff-deleted-gutter', '--dsw-alias-file-diff-deleted-marker',
'--dsw-alias-hovercard-bg', '--dsw-alias-hovercard-label-primary', '--dsw-alias-hovercard-label-secondary',
'--dsw-alias-hovercard-label-tertiary', '--dsw-alias-hovercard-state-done', '--dsw-alias-hovercard-state-error',
'--dsw-alias-illustration-background', '--dsw-alias-illustration-backing', '--dsw-alias-illustration-detail',
'--dsw-alias-illustration-inset', '--dsw-alias-illustration-shadow', '--dsw-alias-illustration-surface',
'--dsw-alias-interactive-bg-active', '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-accent',
'--dsw-alias-interactive-bg-hover-danger', '--dsw-alias-interactive-bg-hover-solid',
'--dsw-alias-json-tree-hover', '--dsw-alias-json-tree-icon', '--dsw-alias-json-tree-keyword',
'--dsw-alias-json-tree-number', '--dsw-alias-json-tree-property', '--dsw-alias-json-tree-punctuation',
'--dsw-alias-json-tree-string', '--dsw-alias-label-caption', '--dsw-alias-label-deep-diving',
'--dsw-alias-label-deep-diving-shimmer', '--dsw-alias-label-dimmed', '--dsw-alias-label-document-preview',
'--dsw-alias-label-on-color', '--dsw-alias-label-primary', '--dsw-alias-label-primary-bluish',
'--dsw-alias-label-primary-dimmed', '--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted',
'--dsw-alias-label-secondary', '--dsw-alias-label-shimmer', '--dsw-alias-label-tertiary',
'--dsw-alias-link', '--dsw-alias-markdown-citation', '--dsw-alias-markdown-code-block',
'--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-code-segment-selected',
'--dsw-alias-markdown-code-segment-unselected', '--dsw-alias-markdown-inline-code',
'--dsw-alias-markdown-placeholder', '--dsw-alias-markdown-tag', '--dsw-alias-menu-group-header-fill',
'--dsw-alias-menu-icon', '--dsw-alias-onboarding-accent', '--dsw-alias-onboarding-card-fill',
'--dsw-alias-onboarding-checkbox-border', '--dsw-alias-onboarding-secondary-fill',
'--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2', '--dsw-alias-scrollbar-hover-l1',
'--dsw-alias-scrollbar-hover-l2', '--dsw-alias-settings-card-fill', '--dsw-alias-settings-card-stroke',
'--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary', '--dsw-alias-state-done-primary',
'--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary', '--dsw-alias-state-idle-primary',
'--dsw-alias-state-success-primary', '--dsw-alias-state-success-secondary', '--dsw-alias-state-success-tertiary',
'--dsw-alias-state-warn-label', '--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-secondary',
'--dsw-alias-state-warn-tertiary', '--dsw-alias-switch-thumb', '--dsw-alias-toast-action',
'--dsw-alias-toast-bg', '--dsw-alias-toast-label', '--dsw-alias-tooltip-bg', '--dsw-alias-tooltip-key-bg',
'--dsw-alias-tooltip-label', '--dsw-alias-trajectory-accent', '--dsw-alias-turn-trigger-bg',
'--dsw-alias-turn-trigger-bg-hover',
]

const clientSources = () =>
  readdirSync(clientDir)
    .filter((f) => /\.(js|jsx)$/.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(clientDir, f), 'utf8') }))

test('令牌卫生：src/client 引用的 --dsw-alias-* 全部在主题包定义名单内', () => {
  const files = clientSources()
  assert.ok(files.length > 30, `src/client 文件枚举非空（实测 ${files.length} 个）`)
  const offenders = []
  for (const { file, text } of files) {
    for (const name of new Set(text.match(/--dsw-alias-[a-z0-9-]+/g) ?? [])) {
      if (!DEFINED_ALIAS.includes(name)) offenders.push(`${file}: ${name}`)
    }
  }
  assert.deepEqual(offenders, [], `引用了主题包不存在的 alias（恒走回退色，深色模式不可读的根因形态）：${offenders.join('; ')}`)
})

test('令牌卫生：已知失效 alias 清零（label-strong 事故名单 + stock-kanban 名单）', () => {
  const all = clientSources().map((x) => x.text).join('')
  const dead = [
    'label-strong', 'bg-elevated', 'fill-secondary', 'interactive-bg-selected',
    'border-secondary', 'bg-hover', 'label-warning',
  ]
  for (const name of dead) {
    assert.equal(all.split(`--dsw-alias-${name}`).length - 1, 0, `--dsw-alias-${name} 已清零`)
  }
})

test('令牌卫生：核心活令牌在位（接线防漂移）', () => {
  const styles = readFileSync(join(clientDir, 'styles.js'), 'utf8')
  const core = [
    'border-l1', 'border-l2', 'bg-base', 'bg-layer-1', 'bg-layer-2', 'bg-layer-3', 'bg-mask-1',
    'interactive-bg-hover', 'interactive-bg-active', 'label-primary', 'label-secondary',
    'label-tertiary', 'label-caption', 'state-business-primary', 'state-error-primary', 'state-success-primary',
  ]
  for (const name of core) {
    assert.ok(styles.includes(`--dsw-alias-${name}`), `--dsw-alias-${name} 在位`)
  }
})
