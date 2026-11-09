// issue #55 页脚市场入口几何源锚（client-compat-overlay.test.mjs 同款惯例：readFileSync styles.js，
// 红灯语义是「接线/文本变了」而非「行为变了」）。三块物理事实：
// P1 几何变量化（默认值=0.12.10 现值，缺省态零漂移）；P2 横向对齐宿主刻度（弃 -2px/width+4px 外溢
// trick，改宿主 border-inline 透明边解法，内容起点 14px→20px 修与「设置」行 6px 错位）；
// §3 共享锚子规则收窄到自有条目。量化断言一律 needle 全文出现次数语义（CODING-STANDARDS
// 测试锚纪律）；单行锚不含 \n（CRLF 检出，source-anchor-hygiene 守卫）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stylesSrc = readFileSync(join(root, "src/client/styles.js"), "utf8");
const count = (needle) => stylesSrc.split(needle).length - 1;

test("issue #55 P1：入口几何变量化，默认值逐字等于现值（缺省态零漂移）", () => {
  assert.equal(count("var(--dshm-entry-height,42px)"), 1, "height 变量化（默认 42）");
  assert.equal(
    count("margin:var(--dshm-entry-margin-y,4px) 0"),
    1,
    "纵向 margin 变量化（默认 4px）；横向 -2px 由 P2 退役、不再变量化",
  );
  assert.equal(count("var(--dshm-entry-radius,"), 1, "圆角变量化（回落宿主 --dsw-radius-md）");
  assert.equal(count("font-size:var(--dshm-entry-font-size,14px)"), 1, "字号变量化（默认 14）");
  assert.equal(count("line-height:var(--dshm-entry-line-height,22px)"), 1, "行高变量化（默认 22）");
  assert.equal(count("var(--dshm-entry-icon,16px)"), 2, "图标变量化（宽+高两处，默认 16）");
  assert.equal(count("var(--dshm-entry-rail,36px)"), 2, "rail 尺寸变量化（宽+高两处，默认 36）");
  assert.ok(
    stylesSrc.includes(
      ".dshm-entry.rail{width:var(--dshm-entry-rail,36px);height:var(--dshm-entry-rail,36px);margin:8px auto 10px;padding:0;justify-content:center;border-radius:50%;gap:0}",
    ),
    "rail 规则整行形态：圆形 50% 与 8/auto/10 margin 不变量化（收起态与宿主 railRow 同几何）",
  );
});

test("issue #55 P2：横向对齐宿主刻度——外溢 trick 退役、border-inline 透明边上场（内容起点 14px→20px）", () => {
  assert.equal(count("width:calc(100% + 4px)"), 0, "width 外溢 trick 退役");
  assert.equal(count("margin:4px -2px"), 0, "-2px 负边距退役");
  assert.equal(count("padding:0 10px 0 8px"), 0, "10/8 不对称 padding 退役（P2 改 9/9）");
  assert.equal(count("padding:0 9px"), 1, "padding 9/9（根 padding 8 + 透明边 3 + 内补 9 = 20px 与官方行对齐）");
  assert.equal(
    count("border-inline:var(--dsh-sidebar-paint-inset,3px) solid transparent"),
    1,
    "宿主 paint-inset 透明边解法（宿主未声明变量时回落 3px 实测值）",
  );
  assert.ok(
    stylesSrc.includes(
      ".dshm-entry{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;height:var(--dshm-entry-height,42px);margin:var(--dshm-entry-margin-y,4px) 0;padding:0 9px;border:0;border-inline:var(--dsh-sidebar-paint-inset,3px) solid transparent;border-radius:var(--dshm-entry-radius,var(--dsw-radius-md,12px));background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:var(--dshm-entry-font-size,14px);line-height:var(--dshm-entry-line-height,22px);cursor:pointer;overflow:hidden}",
    ),
    "展开态规则整行形态（border:0 之后 border-inline 后置覆盖；box-sizing 已有，width:100% 含边）",
  );
});

test("issue #55 §3：共享锚子规则收窄到自有条目（> * → > .dshm-entry）", () => {
  assert.equal(count('[data-slot="sidebar.footer.action"]>*'), 0, "无前缀子规则退役");
  assert.equal(
    count('[data-slot="sidebar.footer.action"]>.dshm-entry{flex:none;min-width:0}'),
    1,
    "子规则收窄到 dsh-m 自有条目",
  );
  assert.equal(
    count('[data-slot="sidebar.footer.action"]{display:flex!important;flex-direction:column;width:100%;min-width:0}'),
    1,
    "锚级列向改写保留：宿主 ANCHOR_STYLE 以内联样式钉 display:contents，非 important 声明对内联恒败，故 !important 不可去；列向为同槽多注册者（cordis/dsh-skins）纵向堆叠承重，不可收窄",
  );
});
