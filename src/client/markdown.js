/**
 * markdown 渲染 pure 逻辑（DESIGN.md §4 README 预览）：safeUrl 安全闸门 + 行内/块级解析。
 * h 由 createMarkdown 注入：生产传 React.createElement，Node 测试传假 h 断言纯结构
 * （假 h 需展平数组 children + 解析函数组件，模仿 React.createElement 语义）。
 * 不依赖 DOM/React，Node tests 直接 import。实现自 main.jsx 391-556 逐字搬迁（零行为变化）。
 */
export function safeUrl(u) {
  const t = String(u || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(t)) return t;
  if (/^[/#]/.test(t)) return t;
  return "#";
}

export function createMarkdown(h) {
  // ↓ 以下注释与 5 个函数自 main.jsx 398-556 逐字迁入，禁止任何行为改动
// 外链统一 target/rel，且阻止冒泡（卡片点击会折叠详情）
function ExtLink({ href, className, children }) {
  return h(
    "a",
    {
      className: className || "dshm-md-a",
      href: safeUrl(href),
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: (e) => e.stopPropagation(),
    },
    children,
  );
}

function MdImg({ src, alt }) {
  return h("img", {
    className: "dshm-md-img",
    src: safeUrl(src),
    alt: alt || "",
    referrerPolicy: "no-referrer",
    onError: (e) => {
      e.currentTarget.style.display = "none";
    },
  });
}

// 行内语法（按优先级）：徽章链接 [![a](i)](l) · 图片 · 链接 · `code` · **粗体** · ~~删除~~ · *斜体* · <autolink> · 裸 URL
function mdInline(text, kb) {
  const re = /(\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))|(!\[[^\]]*\]\([^)]*\))|(\[[^\]]*\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(<https?:\/\/[^>\s]+>)|(https?:\/\/[^\s<>()\[\]{}"'「」【】]+[^\s<>()\[\]{}"'「」【】.,;:!?…，。；：！？）】」"')])/g;
  const src = String(text);
  const nodes = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    const tok = m[0];
    const k = `${kb}-${i++}`;
    if (tok.startsWith("[![")) {
      // [![徽章](img)](link)：badge 常见嵌套，图在链内
      const im = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(tok.slice(1));
      const lm = /\]\(([^)]*)\)\s*$/.exec(tok);
      const img = h(MdImg, { src: im && im[2], alt: im && im[1] });
      const href = lm && lm[1];
      nodes.push(href && safeUrl(href) !== "#" ? h(ExtLink, { key: k, href }, img) : h("span", { key: k }, img));
    } else if (tok.startsWith("![") || tok.startsWith("<![")) {
      const im = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(tok);
      nodes.push(h(MdImg, { key: k, src: im && im[2], alt: im && im[1] }));
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(tok);
      nodes.push(h(ExtLink, { key: k, href: lm && lm[2] }, mdInline(lm ? lm[1] : tok, k)));
    } else if (tok.startsWith("`")) {
      nodes.push(h("code", { key: k }, tok.slice(1, -1)));
    } else if (tok.startsWith("**")) {
      nodes.push(h("strong", { key: k }, mdInline(tok.slice(2, -2), k)));
    } else if (tok.startsWith("~~")) {
      nodes.push(h("del", { key: k }, mdInline(tok.slice(2, -2), k)));
    } else if (tok.startsWith("*")) {
      nodes.push(h("em", { key: k }, mdInline(tok.slice(1, -1), k)));
    } else if (tok.startsWith("<")) {
      const u = tok.slice(1, -1);
      nodes.push(h(ExtLink, { key: k, href: u }, u));
    } else {
      nodes.push(h(ExtLink, { key: k, href: tok }, tok.length > 72 ? `${tok.slice(0, 69)}…` : tok));
    }
    last = m.index + tok.length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}

// 块级语法：围栏代码 · ATX 标题 · 分隔线 · 引用 · 无序/有序列表 · GFM 表格 · 段落
function mdBlocks(lines, kb) {
  const out = [];
  let i = 0;
  let n = 0;
  const isFence = (s) => /^\s*```/.test(s);
  const isHeading = (s) => /^#{1,6}\s+/.test(s);
  const isHr = (s) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(s);
  const isQuote = (s) => /^\s*>/.test(s);
  const isUl = (s) => /^\s*[-*+]\s+/.test(s);
  const isOl = (s) => /^\s*\d+[.)]\s+/.test(s);
  const isTableRow = (s) => s.includes("|") && /^\s*\|/.test(s);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const k = `${kb}-b${n++}`;
    if (isFence(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // 闭合 ```（缺失则到尾部）
      out.push(h("pre", { key: k }, h("code", null, buf.join("\n"))));
      continue;
    }
    if (isHeading(line)) {
      const hm = /^(#{1,6})\s+(.*)$/.exec(line);
      out.push(h(`h${hm[1].length}`, { key: k }, mdInline(hm[2], k)));
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push(h("hr", { key: k }));
      i++;
      continue;
    }
    if (isQuote(line)) {
      const buf = [];
      while (i < lines.length && isQuote(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(h("blockquote", { key: k }, mdBlocks(buf, k)));
      continue;
    }
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        items.push(h("li", { key: `li${items.length}` }, mdInline(re.exec(lines[i])[1], `${k}-${items.length}`)));
        i++;
      }
      out.push(h(ordered ? "ol" : "ul", { key: k }, items));
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && lines[i + 1].includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const cells = (s) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push(
        h("table", { key: k },
          h("thead", null, h("tr", null, head.map((c, x) => h("th", { key: x }, mdInline(c, `${k}h${x}`))))),
          h("tbody", null, rows.map((r, y) => h("tr", { key: y }, r.map((c, x) => h("td", { key: x }, mdInline(c, `${k}${y}x${x}`)))))),
        ),
      );
      continue;
    }
    // 段落：收集到空行或下一个块结构为止
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) && !isQuote(lines[i]) && !isUl(lines[i]) && !isOl(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(h("p", { key: k }, mdInline(buf.join(" "), k)));
  }
  return out;
}

function renderMarkdown(src) {
  return mdBlocks(String(src || "").replace(/\r\n?/g, "\n").split("\n"), "md");
}
  return { ExtLink, MdImg, renderMarkdown };
}
