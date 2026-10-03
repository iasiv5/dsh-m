/**
 * Doctor Day1（ADR-0010）Task 1：类型契约 + detectLayout 布局探测。
 * 运行：npm run build && node --test tests/doctor.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectLayout } from '../lib/core/doctor.js'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dshm-doctor-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('detectLayout（布局判据与优先级，评审 R1.1）', () => {
  it('isolated：无声明且 .pnpm 含包目录 → isolated', async () => {
    mkdirSync(join(root, 'node_modules', '.pnpm', 'foo@1.0.0'), { recursive: true })
    assert.equal(await detectLayout(root), 'isolated')
  })

  it('hoisted：workspace 声明 nodeLinker: hoisted → hoisted', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n')
    assert.equal(await detectLayout(root), 'hoisted')
  })

  it('冲突并存（本机实况形态）：声明 hoisted + .pnpm 仅 lock.yaml → 声明优先，判 hoisted', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), '# vestigial\n')
    assert.equal(await detectLayout(root), 'hoisted')
  })

  it('冲突并存加强：声明 hoisted + .pnpm 含包目录 → 声明仍然优先', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    mkdirSync(join(root, 'node_modules', '.pnpm', 'foo@1.0.0'), { recursive: true })
    assert.equal(await detectLayout(root), 'hoisted')
  })

  it('unknown：皆无 → unknown', async () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    assert.equal(await detectLayout(root), 'unknown')
  })

  it('unknown（判据收紧）：无声明且 .pnpm 仅 lock.yaml → 不算 isolated', async () => {
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), '# vestigial\n')
    assert.equal(await detectLayout(root), 'unknown')
  })

  it('workspace 声明存在但无 nodeLinker 键 → 不构成 hoisted 判据，按 .pnpm 判', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    mkdirSync(join(root, 'node_modules', '.pnpm', 'foo@1.0.0'), { recursive: true })
    assert.equal(await detectLayout(root), 'isolated')
  })
})
