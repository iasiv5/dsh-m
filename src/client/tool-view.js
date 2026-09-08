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
