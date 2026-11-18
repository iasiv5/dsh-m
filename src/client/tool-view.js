/**
 * 工具视图 payload 解析 pure 逻辑（DESIGN.md §5 ToolCardRow/SearchToolView/ListToolView）：
 * depth-6 启发式抓取 + argsRaw 容错解析。契约漂移时的静默失败语义由测试钉死。
 * 不依赖 DOM/React，Node tests 直接 import。实现自 main.jsx 逐字搬迁（零行为变化）。
 */
export function pickPayload(props) {
  const found = [];
  const visit = (node, depth) => {
    if (!node || depth > 6) return;
    if (typeof node === "string") {
      const t = node.trim();
      if ((t.startsWith("{") || t.startsWith("[")) && t.length > 8) {
        try {
          visit(JSON.parse(t), depth + 1);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    if (Array.isArray(node.items)) found.push(node);
    for (const key of ["block", "meta", "result", "resultView", "view", "data", "value", "payload", "content", "message"]) {
      if (node[key] != null) visit(node[key], depth + 1);
    }
  };
  visit(props, 0);
  return found.find((x) => x && Array.isArray(x.items)) || null;
}

const MARKET_LABEL = { market: "市场", "non-market": "非市场", unknown: "未知" };
const MARKET_CLASS = { market: "dshm-badge", "non-market": "dshm-badge info", unknown: "dshm-badge warn" };

/**
 * ADR-0039：dshm_list 卡片行模型（纯函数，DOM-free）。
 * 新数据形状读 market / update；旧数据形状（无这些字段）按 registryId 与 outdated 回退，与旧版卡片一致。
 */
export function listRowsOf(props) {
  const payload = pickPayload(props);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((it) => {
    const market = typeof it.market === "string" ? it.market : it.registryId ? "market" : "non-market";
    const target = it.latestTag ? it.latestTag : it.latestVersion ? `v${it.latestVersion}` : "最新";
    let updateLabel = null;
    let updateClass = "dshm-badge warn";
    if (typeof it.update === "string") {
      if (it.update === "upgradable") updateLabel = `可升级 → ${target}`;
      else if (it.update === "unchecked") {
        updateLabel = "未检查";
        updateClass = "dshm-badge info";
      } else if (it.update === "incomplete") updateLabel = "检查未完成";
    } else if (it.outdated === true) {
      updateLabel = `可升级${it.latestVersion ? ` → v${it.latestVersion}` : ""}`;
    }
    return {
      key: it.pkg,
      name: it.name,
      pkg: it.pkg,
      version: it.version || "?",
      marketLabel: MARKET_LABEL[market] ?? "未知",
      marketClass: MARKET_CLASS[market] ?? "dshm-badge warn",
      updateLabel,
      updateClass,
      userDisabled: it.userDisabled === true,
    };
  });
}

export function parseToolArgs(props) {
  const block = props?.block;
  const raw = (block && "kind" in block ? block.call?.argsRaw : block?.argsRaw) || "";
  if (!raw || typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
