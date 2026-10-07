/**
 * markdown 渲染 pure 逻辑（DESIGN.md §4 README 预览）：safeUrl 安全闸门 + 行内/块级解析。
 * h 由 createMarkdown 注入：生产传 React.createElement，Node 测试传假 h 断言纯结构
 * （假 h 需展平数组 children + 解析函数组件，模仿 React.createElement 语义）。
 * 不依赖 DOM/React，Node tests 直接 import。实现自 main.jsx 391-556 逐字搬迁（零行为变化）。
 *
 * 0.9.47 扩展：内嵌 HTML 子集渲染（GitHub 风 README 的 <p align>/<img>/<a>/<details> 等）。
 * 安全模型：绝不向 DOM 注入原始 HTML 字符串——只把源码解析成「白名单标签 + 白名单属性」，
 * 全部经 h() 构造 React 元素，URL 一律过 safeUrl；未知标签剥壳留内容，
 * script/style/svg 等危险或纯资源容器连同内容一起丢弃（React 对文本节点转义兜底，无注入面）。
 * 自此「逐字搬迁、禁止任何行为改动」仅约束未触及的既有函数；mdBlocks/renderMarkdown/MdImg
 * 的改动见下方各处 0.9.47 注释与 tests/client-markdown.test.mjs。
 *
 * 0.9.48 扩展：①HTML 实体解码（&nbsp;/&amp;/&lt;/数字实体等——文本段与属性值都解，
 * code/pre 内不解；单趟解码不回炉，解码结果只作为文本节点，绝不重新参与标签解析）；
 * ②仓库基址锚定——renderMarkdown(src, { repo: "owner/repo" }) 后，相对 href/src 锚定到
 * GitHub blob/HEAD（链接）与 raw.githubusercontent/HEAD（图片），无基址时保持原行为（归 #）。
 */
// 渲染级仓库基址（同步渲染：renderMarkdown 进出即设置/恢复，无并发重入问题）
let RENDER_REPO = ""; // "owner/repo"；空 = 无基址（相对 URL 一律归 #，0.9.47 及以前行为）

// "owner/repo" 或 GitHub 仓库 URL/形态 → "owner/repo"（仅 github.com；其余返回 ""）
function normalizeRepoInput(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(s)) return s;
  const m = /github\.com[/:]([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?(?:[/?#]|$)/i.exec(s);
  return m ? `${m[1]}/${m[2]}` : "";
}

export function safeUrl(u, kind) {
  const t = String(u || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(t)) return t;
  if (t.startsWith("#")) return t;
  if (RENDER_REPO && (kind === "img" || kind === "link")) {
    const path = t.replace(/^(?:\.\/|\.\.\/|\/)+/, "");
    return kind === "img"
      ? `https://raw.githubusercontent.com/${RENDER_REPO}/HEAD/${path}`
      : `https://github.com/${RENDER_REPO}/blob/HEAD/${path}`;
  }
  if (t.startsWith("/")) return t;
  return "#";
}

// ---------- HTML 实体解码（0.9.48） ----------
// 命名实体取 GitHub README 高频集；数字实体支持十进制/十六进制；单趟解码不回炉
// （&amp;lt; → "&lt;" 文本，与浏览器一致）；未知实体原样保留。
const HTML_ENTITIES = { nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", reg: "®", trade: "™", mdash: "—", ndash: "–", hellip: "…", middot: "·", laquo: "«", raquo: "»", times: "×", divide: "÷", plusmn: "±", deg: "°", sup2: "²", sup3: "³", frac12: "½", frac14: "¼", frac34: "¾", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", bull: "•", dagger: "†", Dagger: "‡", permil: "‰", prime: "′", Prime: "″", larr: "←", uarr: "↑", rarr: "→", darr: "↓", harr: "↔", minus: "−", infin: "∞", ne: "≠", le: "≤", ge: "≥", asymp: "≈", equiv: "≡", check: "✓", cross: "✗", star: "☆", starf: "★", hearts: "♥", alpha: "α", beta: "β", gamma: "γ", delta: "δ", pi: "π", Omega: "Ω", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’" };
const HTML_ENTITY_RE = /&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decodeEntities(s) {
  const t = String(s || "");
  if (!t.includes("&")) return t;
  return t.replace(HTML_ENTITY_RE, (raw, body) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    }
    const named = HTML_ENTITIES[body] !== undefined ? HTML_ENTITIES[body] : HTML_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : raw;
  });
}

// ---------- HTML 子集：模块级纯解析（无 h 依赖） ----------
// 标签 token：属性段要求空白起始且属性名以字母开头，避免把「a < b -> c」误判成标签
const HTML_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
// void 标签（无闭合；img/source 单独处理属性）
const HTML_VOID_TAGS = new Set(["br", "hr", "img", "source", "input", "wbr", "area", "col", "link", "meta"]);
// 内容整体丢弃的容器：脚本/样式/内嵌资源（内容不可信且对 README 预览无意义）
const HTML_SKIP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "noscript", "svg", "title", "textarea", "select", "video", "audio", "canvas", "template", "form", "button", "head"]);
// 块级包裹标签：剥掉首尾标签后按完整 markdown 递归渲染（保留内部标题/列表/表格/围栏结构）
const HTML_BLOCK_WRAP = new Set(["p", "div", "center", "blockquote", "details", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "figure", "figcaption", "section", "article", "main", "header", "footer", "nav", "aside", "dl", "dt", "dd"]);
// 这些包裹标签内部常见空行（details/整篇 div 包裹/表格单元格），寻闭合标签时允许跨空行
const HTML_SPAN_BLANK = new Set(["details", "div", "blockquote", "table", "thead", "tbody", "tr", "ul", "ol", "dl", "figure", "section", "article", "td", "th", "li"]);
// 行内标签 → React 元素映射（a 特走 ExtLink；strong/b 等别名归一）
const HTML_INLINE_MAP = { a: "a", strong: "strong", b: "strong", em: "em", i: "em", del: "del", s: "del", strike: "del", code: "code", kbd: "kbd", sub: "sub", sup: "sup", u: "u", small: "small", mark: "mark", span: "span" };
// 未知标签剥壳时补的视觉分隔（tr/li 等断行、td/th 留空隙），防止内容粘连
const HTML_UNWRAP_SEP = { tr: "br", li: "br", p: "br", h1: "br", h2: "br", h3: "br", h4: "br", h5: "br", h6: "br", table: "br", ul: "br", ol: "br", td: "sp", th: "sp" };

function parseHtmlAttrs(s) {
  const attrs = {};
  if (!s) return attrs;
  const re = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    attrs[m[1].toLowerCase()] = decodeEntities(raw); // 0.9.48：属性值实体解码（URL 里 &amp; → &）
  }
  return attrs;
}

// align 属性 → textAlign（仅四个合法值；不透传 style 属性本身，杜绝任意内联样式）
function htmlAlignStyle(attrs) {
  const a = String(attrs.align || "").toLowerCase();
  return a === "center" || a === "left" || a === "right" || a === "justify" ? { textAlign: a } : undefined;
}

// 显式尺寸的图（Logo/示意图）放开预览 CSS 的 20px 高度帽；徽章类无 width 仍走小图帽
function htmlImgStyle(attrs) {
  const size = (v) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : /^\d+(\.\d+)?%$/.test(v) ? v : null);
  const st = {};
  const w = size(String(attrs.width || ""));
  if (w !== null) {
    st.width = w;
    st.maxWidth = "100%";
    st.height = "auto";
    st.maxHeight = "none";
  }
  const hgt = size(String(attrs.height || ""));
  if (hgt !== null) st.height = hgt;
  return Object.keys(st).length ? st : undefined;
}

// 找 HTML 块的收尾行：优先寻本标签闭合行；跨块容器允许跨空行，其余止于空行（≤400 行兜底）
function htmlBlockEnd(lines, i) {
  const om = /<([a-zA-Z][a-zA-Z0-9-]*)/.exec(lines[i]);
  const tag = om ? om[1].toLowerCase() : "";
  if (!tag || HTML_VOID_TAGS.has(tag)) return i;
  if (new RegExp(`</${tag}\\s*>`, "i").test(lines[i].slice(om.index))) return i; // 同行自闭合
  const closeRe = new RegExp(`</${tag}\\s*>`, "i");
  let lastNonBlank = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].trim()) {
      if (!HTML_SPAN_BLANK.has(tag) || j - i > 400) return lastNonBlank;
      continue;
    }
    lastNonBlank = j;
    if (closeRe.test(lines[j])) return j;
    if (j - i > 400) return j;
  }
  return lastNonBlank;
}

// 深度解码文本节点（0.9.48）：code/pre 内不解码；元素递归其 children；
// 兼容 fake-h（children 在顶层）与 React 元素（children 在 props）两种形态；不改传入节点。
function decodeTextNodes(nodes) {
  return nodes.map((n) => {
    if (typeof n === "string") return decodeEntities(n);
    if (Array.isArray(n)) return decodeTextNodes(n);
    if (n && typeof n === "object" && n.type !== "code" && n.type !== "pre") {
      const cur = n.props && n.props.children !== undefined ? n.props.children : n.children;
      if (cur !== undefined) {
        const wasArr = Array.isArray(cur);
        const decoded = decodeTextNodes(wasArr ? cur : [cur]);
        const next = wasArr ? decoded : decoded[0];
        if (n.props && n.props.children !== undefined) return { ...n, props: { ...n.props, children: next } };
        return { ...n, children: next };
      }
    }
    return n;
  });
}

export function createMarkdown(h) {
  // ↓ 以下注释与 5 个函数自 main.jsx 398-556 逐字迁入，禁止任何行为改动
// 外链统一 target/rel，且阻止冒泡（卡片点击会折叠详情）
function ExtLink({ href, className, children }) {
  return h(
    "a",
    {
      className: className || "dshm-md-a",
      href: safeUrl(href, "link"),
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: (e) => e.stopPropagation(),
    },
    children,
  );
}

// 0.9.47：MdImg 增补可选 style/title（HTML <img> 显式尺寸与悬浮提示用；markdown 路径不传，行为不变）
function MdImg({ src, alt, style, title }) {
  return h("img", {
    className: "dshm-md-img",
    src: safeUrl(src, "img"),
    alt: alt || "",
    title: title || undefined,
    style: style || undefined,
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
      nodes.push(href && safeUrl(href, "link") !== "#" ? h(ExtLink, { key: k, href }, img) : h("span", { key: k }, img));
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

// 块级语法：HTML 块 · 围栏代码 · ATX 标题 · 分隔线 · 引用 · 无序/有序列表 · GFM 表格 · 段落
// 0.9.47：签名增补 depth（HTML 包裹标签递归深度），默认 0 时 markdown 路径行为不变
function mdBlocks(lines, kb, depth = 0) {
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
  // 0.9.47：行首标签即 HTML 块（<p align=…>、<img …>、</div> 等）
  const isHtmlBlock = (s) => /^\s*<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*?)?\/?>/.test(s);
  // 0.9.47：行内出口分流——文本含标签时走 HTML token 流（标签内文本仍交 mdInline），
  // 纯 markdown 文本走原路径，零行为变化
  const inlineOf = (s, key) => decodeTextNodes(/<[a-zA-Z]/.test(s) ? mdHtmlInline(s, key) : mdInline(s, key));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const k = `${kb}-b${n++}`;
    if (isHtmlBlock(line)) {
      const end = htmlBlockEnd(lines, i);
      out.push(...mdHtmlBlock(lines.slice(i, end + 1).join("\n"), `${k}H`, depth));
      i = end + 1;
      continue;
    }
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
      out.push(h(`h${hm[1].length}`, { key: k }, inlineOf(hm[2], k)));
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
      out.push(h("blockquote", { key: k }, mdBlocks(buf, k, depth)));
      continue;
    }
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        items.push(h("li", { key: `li${items.length}` }, inlineOf(re.exec(lines[i])[1], `${k}-${items.length}`)));
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
          h("thead", null, h("tr", null, head.map((c, x) => h("th", { key: x }, inlineOf(c, `${k}h${x}`))))),
          h("tbody", null, rows.map((r, y) => h("tr", { key: y }, r.map((c, x) => h("td", { key: x }, inlineOf(c, `${k}${y}x${x}`)))))),
        ),
      );
      continue;
    }
    // 段落：收集到空行或下一个块结构为止（0.9.47 起含 HTML 块，避免吞掉紧邻的标签行）
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) && !isQuote(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) && !isHtmlBlock(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(h("p", { key: k }, inlineOf(buf.join(" "), k)));
  }
  return out;
}

// ---------- HTML 子集渲染（0.9.47） ----------
// 行内 token 流：白名单标签构造元素（闭合时才 build，天然处理嵌套）；未知标签剥壳留内容；
// 文本段交给 mdInline（段内 markdown 行内语法照常生效）；空行分段降级为多段落。
function mdHtmlInline(src, kb) {
  const out = [];
  const stack = []; // { name, kids, build }  build(children) → 闭合时构造节点
  let last = 0;
  let n = 0;
  let m;
  const cur = () => (stack.length ? stack[stack.length - 1].kids : out);
  const pushText = (t) => {
    if (!t) return;
    const t2 = decodeEntities(t);
    if (!t2.trim()) {
      if (cur().length) cur().push(" "); // 纯空白段保留一个空隙（徽章行间距靠它；&nbsp; 解码后同此）；容器开头则跳过
      return;
    }
    const parts = t2.split(/\n[ \t]*\n+/);
    parts.forEach((part, idx) => {
      const nodes = decodeTextNodes(mdInline(part.replace(/\s+/g, " "), `${kb}t${n++}`)); // 不 trim：保留标签间原有空隙
      if (!nodes.length) return;
      if (idx === 0 || stack.length) cur().push(...nodes);
      else out.push(h("p", { key: `${kb}tp${n++}` }, ...nodes));
    });
  };
  const closeTop = () => {
    const f = stack.pop();
    cur().push(f.build(f.kids));
  };
  const sepNode = (name, key) => {
    const sep = HTML_UNWRAP_SEP[name];
    if (sep === "br") cur().push(h("br", { key }));
    else if (sep === "sp") cur().push(" ");
  };
  HTML_TAG_RE.lastIndex = 0;
  while ((m = HTML_TAG_RE.exec(src))) {
    if (m.index > last) pushText(src.slice(last, m.index));
    const full = m[0];
    const name = m[2].toLowerCase();
    const key = `${kb}h${n++}`;
    if (m[1]) {
      // 闭标签：就近配对（中间未闭合帧隐式闭合）；无配对的已知分隔标签降级补隙
      const idx = stack.map((f) => f.name).lastIndexOf(name);
      if (idx >= 0) {
        while (stack.length > idx + 1) closeTop();
        closeTop();
      } else sepNode(name, key);
    } else if (HTML_SKIP_TAGS.has(name)) {
      // 危险/无意义容器：跳过到对应闭标签，内容整体丢弃
      const cm = new RegExp(`</${name}\\s*>`, "i").exec(src.slice(m.index + full.length));
      HTML_TAG_RE.lastIndex = cm ? m.index + full.length + cm.index + cm[0].length : src.length;
      last = HTML_TAG_RE.lastIndex;
      continue;
    } else if (name === "img") {
      const attrs = parseHtmlAttrs(m[3]);
      cur().push(h(MdImg, { key, src: attrs.src, alt: attrs.alt, title: attrs.title, style: htmlImgStyle(attrs) }));
    } else if (name === "br" || name === "hr") {
      cur().push(h(name, { key }));
    } else if (HTML_VOID_TAGS.has(name) || m[4]) {
      // 其余 void / 自闭合标签：丢弃（picture>source 等）
    } else if (HTML_INLINE_MAP[name]) {
      const attrs = parseHtmlAttrs(m[3]);
      if (name === "a") {
        stack.push({ name, kids: [], build: (kids) => h(ExtLink, { key, href: attrs.href, title: attrs.title }, kids) });
      } else {
        const type = HTML_INLINE_MAP[name];
        const style = htmlAlignStyle(attrs);
        stack.push({ name, kids: [], build: (kids) => h(type, style ? { key, style } : { key }, kids) });
      }
    } else if (/^h[1-6]$/.test(name)) {
      const style = htmlAlignStyle(parseHtmlAttrs(m[3]));
      const lvl = name;
      stack.push({ name, kids: [], build: (kids) => h(lvl, style ? { key, style } : { key }, kids) });
    } else {
      sepNode(name, key);
    }
    last = m.index + full.length;
  }
  if (last < src.length) pushText(src.slice(last));
  while (stack.length) closeTop();
  return out;
}

// 包裹标签内部是否「纯行内内容」：无空行分段、无 markdown 块结构、行首标签均为行内/void
// （tr/td/ul/li 等块级标签开头的行 → 走 markdown 递归保结构）。GitHub 行内语义：img/a/&nbsp;
// 在 <p> 内连排同一行。剥壳产生的首尾空串不算空行分段。
function isInlineOnlyHtml(inner) {
  const lines = String(inner).split("\n");
  if (lines.some((l) => l !== "" && !l.trim())) return false;
  return !lines.some((l) => {
    if (/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`|\|)/.test(l)) return true; // markdown 块结构
    const tm = /^\s*<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(l);
    if (!tm) return false;
    const name = tm[1].toLowerCase();
    return !(name === "img" || name === "br" || name === "hr" || HTML_INLINE_MAP[name]);
  });
}

// HTML 块入口：包裹标签剥壳后按完整 markdown 递归（保标题/列表/表格结构），否则走行内 token 流
function mdHtmlBlock(raw, kb, depth) {
  const s = String(raw).trim();
  if (depth > 8) return [s]; // 深度护栏：异常嵌套降级纯文本（React 转义，无注入面）
  const om = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>/.exec(s);
  if (!om) return mdHtmlInline(s, kb);
  const tag = om[1].toLowerCase();
  if (!HTML_BLOCK_WRAP.has(tag)) return mdHtmlInline(s, kb);
  const cm = new RegExp(`</${tag}\\s*>\\s*$`, "i").exec(s.slice(om[0].length));
  if (!cm) return mdHtmlInline(s, kb);
  let inner = s.slice(om[0].length, om[0].length + cm.index);
  const attrs = parseHtmlAttrs(om[2] || "");
  const style = htmlAlignStyle(attrs);
  const inlineKids = () => (isInlineOnlyHtml(inner) ? mdHtmlInline(inner, kb) : renderMarkdown(inner, depth + 1));
  if (tag === "details") {
    const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    let sumNode = null;
    if (sm) {
      inner = inner.slice(0, sm.index) + inner.slice(sm.index + sm[0].length);
      sumNode = h("summary", { key: `${kb}sum` }, ...mdHtmlInline(sm[1], `${kb}sm`));
    }
    const kids = sumNode ? [sumNode, ...inlineKids()] : inlineKids();
    return [h("details", attrs.open !== undefined ? { key: kb, open: true } : { key: kb }, ...kids)];
  }
  if (/^h[1-6]$/.test(tag)) return [h(tag, style ? { key: kb, style } : { key: kb }, ...mdHtmlInline(inner, kb))];
  // 其余包裹标签：行内优先（GitHub 行内连排语义），块级内容剥壳递归（内层 p 间距 CSS 已收敛）
  return [h(tag, style ? { key: kb, style } : { key: kb }, ...inlineKids())];
}

function renderMarkdown(src, opts = {}, depth = 0) {
  const prev = RENDER_REPO;
  RENDER_REPO = normalizeRepoInput(opts && opts.repo);
  try {
    return mdBlocks(String(src || "").replace(/\r\n?/g, "\n").split("\n"), "md", depth);
  } finally {
    RENDER_REPO = prev;
  }
}
  return { ExtLink, MdImg, renderMarkdown };
}
