/**
 * search-normalize-corpus 固定格式守卫：整文件合法 JSON；cases 每条独占一行（grep 友好）。
 * 生成器 scripts/gen-search-normalize-corpus.mjs 的 serializeCorpus 与本格式一一对应。
 * 运行：node --test tests/search-normalize-corpus-format.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'tests', 'fixtures', 'search-normalize-corpus.json')
const text = readFileSync(path, 'utf8')

describe('search-normalize-corpus 固定格式：每条用例独占一行', () => {
  it('整文件是合法 JSON，cases 数组非空', () => {
    const obj = JSON.parse(text)
    assert.ok(Array.isArray(obj.cases) && obj.cases.length > 0)
  })

  it('cases 每条独占一行，且逐行解析后与 JSON 解析结果一致', () => {
    const obj = JSON.parse(text)
    const lines = text.split('\n')
    const start = lines.findIndex((l) => l.includes('"cases":['))
    assert.ok(start >= 0, '缺少 "cases":[ 起始行')
    const caseLines = lines.slice(start + 1).filter((l) => l.length > 0 && !l.startsWith(']}'))
    assert.equal(caseLines.length, obj.cases.length, '每条用例应恰好占一行')
    caseLines.forEach((line, i) => {
      assert.deepEqual(JSON.parse(line.replace(/,$/, '')), obj.cases[i], `第 ${i} 条用例行与解析结果不一致`)
    })
  })
})
