/**
 * 官方插件页显示名元数据守卫（0.10.15）：DSH 宿主 readPluginMeta 的取值链是
 * 「exported locale 的 meta.title/description → package.json name/description → 包名」，
 * 且 en.json 是 locale 目录的发现锚（无 en.json 时整目录跳过、标题回退包名）。
 * 本守卫锁死三件事：exports 暴露 ./locale/*.json、双语 locale 文件在位且 meta 合法、
 * assert-pack 门禁把 locale 文件列为发布必备（防发版静默丢文件）。
 * 运行：node --test tests/plugin-meta-locale.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

import { REQUIRED, packIssues } from '../scripts/assert-pack.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function readLocale(language) {
  const file = join(root, 'locale', `${language}.json`)
  return { file, parsed: JSON.parse(readFileSync(file, 'utf8')) }
}

function metaOf(language) {
  const { _file, parsed } = readLocale(language)
  const meta = parsed.meta
  assert.ok(meta && typeof meta === 'object' && !Array.isArray(meta), `locale/${language}.json 缺 meta 对象`)
  for (const field of ['title', 'description']) {
    assert.equal(typeof meta[field], 'string', `locale/${language}.json meta.${field} 必须是字符串`)
    assert.ok(meta[field].trim() !== '', `locale/${language}.json meta.${field} 不得为空`)
  }
  return meta
}

describe('插件页显示名 locale 元数据（0.10.15）', () => {
  it('package.json 暴露 ./locale/*.json 导出并把 locale 列入发布面', () => {
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', '宿主经 exports 解析 locale 资源，缺键即回退包名')
    assert.ok(manifest.files.includes('locale'), 'files 必须携带 locale 目录（npm 发布面）')
  })

  it('双语 locale 文件在位且 meta.title/description 均为非空字符串', () => {
    const en = metaOf('en')
    const zh = metaOf('zh')
    assert.ok(en.title.includes('dsh-m'), '英文标题须含包名（与「插件市场（dsh-m）」同构）')
    assert.equal(zh.title, '插件市场（dsh-m）', '中文标题回归锚：官方插件页显示名')
  })

  it('中文描述与 package.json description 一致（两处文案单源对齐）', () => {
    const zh = metaOf('zh')
    assert.equal(zh.description, manifest.description, 'locale/zh.json 的描述应与 package.json description 逐字一致')
  })

  it('assert-pack 门禁把 locale 文件列为发布必备且清单自洽', () => {
    for (const required of ['locale/en.json', 'locale/zh.json']) {
      assert.ok(REQUIRED.includes(required), `REQUIRED 缺 ${required}`)
    }
    const withLocale = [...REQUIRED]
    assert.deepEqual(packIssues(withLocale), [], '齐备清单应零 issue')
    const withoutLocale = REQUIRED.filter((f) => !f.startsWith('locale/'))
    const issues = packIssues(withoutLocale)
    assert.equal(issues.length, 1, '缺 locale 文件应报单一 issue')
    assert.ok(issues[0].includes('locale/en.json') && issues[0].includes('locale/zh.json'), 'issue 须点名两个 locale 文件')
  })
})
