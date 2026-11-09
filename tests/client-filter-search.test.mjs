// issue #56 搜索态筛选「排序两组放回 + 说明行」源锚（client-entry-css.test.mjs 同款惯例：
// readFileSync + needle 全文出现次数语义，红灯语义是「接线/文本变了」而非「行为变了」）。
// 三块物理事实：0.9.25 的 searching 门控退役；搜索态说明行挂现成 .dshm-hint（先例
// community.fallback）；filter.searchhint 双字典落键（client-i18n.test.mjs 直接量审计 +
// ZH/EN 键集配对守卫自动收编，此处再钉出现次数=2 防单语漂移）。
// 行为语义不在此钉：相关性第一关键字由 tests/market.test.mjs「相关性优先于用户排序」锚承重，
// 默认同分 tie-break=downloads 降序缺省序由同文件 0.9.68 score-once 组承重——本改动均不触碰。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const marketTabSrc = readFileSync(join(root, "src/client/market-tab.jsx"), "utf8");
const i18nSrc = readFileSync(join(root, "src/client/i18n.js"), "utf8");
const count = (src, needle) => src.split(needle).length - 1;

test("issue #56：0.9.25 搜索态排序隐藏门控退役（...(searching 展开包装出现次数 0）", () => {
  assert.equal(
    count(marketTabSrc, "...(searching"),
    0,
    "searching 展开包装退役——排序字段/排列方向两组在搜索态照常渲染（updateQuery({sort}) 与 resetPageOnFilterChange 接线原样）；needle 取单行形态（CRLF 检出下跨行锚恒不匹配=假绿）",
  );
});

test("issue #56：搜索态说明行——挂现成 .dshm-hint，仅 searching 态渲染（单行形态锚）", () => {
  assert.equal(
    count(
      marketTabSrc,
      'searching ? h("div", { className: "dshm-hint", key: "searchhint" }, lookup("filter.searchhint")) : null,',
    ),
    1,
    "说明行在浮层顶部、仅搜索态出现（直接量 lookup 键同时进 client-i18n 审计面）",
  );
});

test("issue #56：filter.searchhint 双字典落键（ZH/EN 出现次数各 1，合计 2）", () => {
  assert.equal(count(i18nSrc, '"filter.searchhint": "'), 2, "ZH/EN 各落一次（client-i18n 键集配对守卫同面承重）");
});
