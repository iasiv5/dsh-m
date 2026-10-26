/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（chrome.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：safeScreenshots, officialLinks, LinksRow, Icon, Spin, PhaseDot, ToggleSwitch, TwoStepButton, RestartBanner, SearchBox, compactCount, Shot, useImgChain, UseImgChainProbe, Lightbox, XIcon, FsIcon
 */
import React from "react";
import rd from "react-dom";
const PHASE_LABEL = { resolving: "phase.resolving", downloading: "phase.downloading", linking: "phase.linking", building: "phase.building" };


// ---------- README 预览 ----------

// ---------- 已装页 ----------

// ---------- 设置页 ----------








const OP_STATUS_CLS = {
  queued: "", running: "run", input: "warn", done: "ok", warned: "warn", failed: "err", superseded: "sup",
};

const h = React.createElement;
const { useState, useEffect, useCallback, useRef, useMemo } = React;
import { api, useScrollableContain } from "./hooks.js";
import { lookup } from "./i18n.js";
import { createMarkdown } from "./markdown.js";
import { backdropCloseHandlers } from "./backdrop.js";
import { lbStep, lbNeighbors, swipeDir } from "./lightbox.js";
import { WESERV_TIMEOUT_MS, weservUrl, serviceBucketOf, tierOrder, nextTier, needsTimeout, preferredTier, rememberSuccess } from "./img-chain.js";
import { iconCandidates } from "./icon-view.js";
import { RESTART_POLL_MS, RESTART_DEADLINE_MS, nextRestartWait, isAmbiguousRestartRequestError } from "./restart-wait.js";
import { DetailModal } from "./detail-modal.jsx";

// markdown 渲染件工厂（createMarkdown 注入 h，与 main.jsx 同款）
const { ExtLink, MdImg, renderMarkdown } = createMarkdown(h);

function Icon({ entry }) {
  const letter = String(entry.name || entry.id || "?").charAt(0).toUpperCase();
  // ADR-0025 图标解析链（T4/T5）：候选序 = 目录声明(仅 https URL) → 已装官方 data URI → GitHub 头像
  // （icon-view.js）。每个候选 URL 仍走 useImgChain 投递（weserv h=96 → 原图 → 败）。
  // R-2Q1：hooks 全量无条件调用、禁止 hook 前提前 return——已装页 key=pkg 复用实例，插件升级使
  // 候选从无到有时 hook 数变化会崩子树；「无候选零 IO 零计时器」由渲染层短路 + useImgChain !url 守卫达成。
  const candidates = useMemo(() => iconCandidates(entry), [entry]);
  const [idx, setIdx] = useState(0);
  const candidateKey = candidates.join("|");
  const [prevKey, setPrevKey] = useState(candidateKey);
  if (prevKey !== candidateKey) {
    // 候选集变化（换 entry）→ 渲染期 derived-state 重置（useImgChain prevUrl 同款，无中间帧）
    setPrevKey(candidateKey);
    setIdx(0);
  }
  const current = candidates[idx] ?? null;
  const isData = current !== null && current.startsWith("data:");
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // R-2Q3：data:/无候选喂空串——useImgChain 对 !url 不挂 8s 计时器，也不白算 weservUrl 编码
  const chain = useImgChain(current !== null && !isData ? current : "", { h: 96, active: show });
  // 候选间降级：本 URL 双层（weserv+原图）耗尽 → 下一候选（渲染期 setState，Discarding render）
  if (chain.failed && idx < candidates.length - 1) setIdx(idx + 1);
  // 渲染层短路：未可见（IO 门控，SSR 恒 false）/ 无候选 / 当前候选耗尽 → 字母占位（ref 恒挂，首帧必经）
  if (!show || candidates.length === 0 || chain.failed) {
    return h("div", { className: "dshm-icon", "aria-hidden": "true", ref }, letter);
  }
  if (isData) {
    // 已装官方 meta.icon（base64 data URI）：不走 weserv，直连渲染；失败静默降下一候选
    return h("img", {
      className: "dshm-icon",
      src: current,
      alt: "",
      loading: "lazy",
      referrerPolicy: "no-referrer",
      decoding: "async",
      onError: () => setIdx(idx + 1),
    });
  }
  return h("img", {
    className: "dshm-icon",
    src: chain.src,
    alt: "",
    loading: "lazy",
    referrerPolicy: "no-referrer",
    decoding: "async",
    onError: chain.onError,
    onLoad: chain.onLoad,
  });
}

function Spin() {
  return h("span", { className: "dshm-spin" });
}

function safeScreenshots(entry) {
  const list = Array.isArray(entry && entry.screenshots) ? entry.screenshots : [];
  return list
    .filter((u) => typeof u === "string" && u.length <= 2048)
    .map((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "https:") return null;
        if (parsed.hostname === "github.com" || parsed.hostname.endsWith(".githubusercontent.com")) return u;
        return null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 8);
}

function officialLinks({ npm, github, homepage }) {
  const links = [];
  if (github) links.push(["GitHub", `https://github.com/${github}`]);
  if (npm) links.push(["npm", `https://www.npmjs.com/package/${npm}`]);
  if (!links.length && homepage) links.push([lookup("link.home"), homepage]);
  return links;
}

function LinksRow(props) {
  const links = officialLinks(props);
  if (!links.length) return null;
  const kids = [];
  links.forEach(([label, href], idx) => {
    if (idx) kids.push(h("span", { key: `sep${idx}`, className: "dshm-links-sep" }, "·"));
    kids.push(h(ExtLink, { key: label, href }, label));
  });
  return h("div", { className: "dshm-links" }, h("span", { className: "dshm-links-k" }, `${lookup("detail.links")}：`), ...kids);
}

function PhaseDot({ vm }) {
  if (!vm.phaseDotClass) return null;
  return h(
    "span",
    { className: `dshm-dot ${vm.phaseDotClass}`, title: vm.phaseLabelKey ? lookup(vm.phaseLabelKey) : null },
    "\u25CF",
  );
}

function ToggleSwitch({ vm, disabled, onChange, title }) {
  return h(
    "label",
    {
      className: `dshm-switch${vm.switchOn ? " on" : ""}${vm.switchDisabled ? " locked" : ""}`,
      title: title || (vm.switchTitleKey ? lookup(vm.switchTitleKey) : null),
      onClick: (e) => {
        e.stopPropagation();
        if (!vm.switchDisabled && !disabled) onChange(!vm.switchOn);
      },
    },
    h("input", { type: "checkbox", checked: vm.switchOn, disabled: vm.switchDisabled || disabled, readOnly: true }),
    h("span", { className: "dshm-switch-slider" }),
  );
}

function TwoStepButton({ label, confirmLabel, className, onConfirm, disabled }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);
  return h(
    "button",
    {
      className: `${className || "dshm-btn"} ${arm ? "danger" : ""}`.trim(),
      disabled,
      onClick: (e) => {
        e.stopPropagation();
        if (!arm) {
          setArm(true);
        } else {
          setArm(false);
          onConfirm();
        }
      },
    },
    arm ? confirmLabel : label,
  );
}

function RestartBanner({ note, onDone, desktop, onRestarted }) {
  const [phase, setPhase] = useState("idle"); // idle | restarting | waiting
  const [err, setErr] = useState(null);
  const restart = useCallback(async () => {
    setErr(null);
    setPhase("restarting");
    try {
      const ping0 = await api("ping");
      try {
        await api("restart");
      } catch (requestError) {
        // The host may have accepted restart and closed the socket before the
        // JSON response flushed. Continue with boot-id verification for that
        // ambiguous network case; definite HTTP errors still fail immediately.
        if (!isAmbiguousRestartRequestError(requestError)) throw requestError;
      }
      setPhase("waiting");
      const deadlineAt = Date.now() + RESTART_DEADLINE_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, RESTART_POLL_MS));
        if (nextRestartWait({ phase: "before-ping", now: Date.now(), deadlineAt }) === "timeout") {
          throw new Error(lookup("restart.timeout"));
        }
        let bootChanged = false;
        try {
          const ping = await api("ping");
          bootChanged = ping.boot !== ping0.boot;
        } catch {
          /* 服务重启中，继续轮询 */
        }
        if (nextRestartWait({ phase: "after-ping", bootChanged }) === "done") break;
      }
      // Do not force window.location.reload() here. DSH Web owns the browser
      // connection and has its own background recovery/retry loop; a full-page
      // reload during the auth/route handoff can land on a blank error page.
      setPhase("idle");
      // 0.9.2：先就地刷新 ping（版本角标/profile chip），再关横幅；回调异常不影响横幅收尾
      if (onRestarted) {
        try { onRestarted(); } catch { /* 回调异常不阻塞横幅关闭 */ }
      }
      onDone(true);
    } catch (e) {
      setPhase("idle");
      setErr(String((e && e.message) || e));
    }
  }, [onDone, onRestarted]);
  // 0.9.72 滚轮治理：横幅文本超限才有滚动语义，不满限时不挂 contain（吞滚轮病灶同款）
  const text = phase === "restarting" ? lookup("restart.doing") :
    phase === "waiting" ? lookup("restart.waiting") :
    err ? lookup("restart.failed", { err }) :
    note || lookup("banner.done");
  const [textRef, textScrollCls] = useScrollableContain(text);
  return h(
    "div",
    { className: "dshm-banner" },
    h("span", { className: `dshm-banner-text${textScrollCls}`, ref: textRef }, text),
    phase === "idle" && !err && !desktop ? h("button", { className: "dshm-btn primary sm", onClick: restart }, lookup("restart.now")) : null,
    phase === "restarting" || phase === "waiting" ? Spin() : null,
    phase === "idle" && err ? h("button", { className: "dshm-btn sm", onClick: () => onDone(false) }, lookup("common.ok")) : null,
    phase === "idle" && !err ? h("button", { className: "dshm-btn sm", onClick: () => onDone(false) }, lookup("common.later")) : null,
  );
}

function SearchBox({ placeholder, initial, onCommit }) {
  const [draft, setDraft] = useState(initial || "");
  const [composing, setComposing] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const schedule = (v) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(v), 250);
  };
  const onChange = (v) => {
    setDraft(v);
    if (composing) return; // IME 组合期间不排定提交（组合结束再排）
    schedule(v);
  };
  const submitNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onCommit(draft);
  };
  return h(
    "div",
    { className: "dshm-search" },
    h("input", {
      ref: inputRef,
      className: "dshm-input",
      placeholder,
      value: draft,
      style: draft ? { paddingRight: "32px" } : null,
      onChange: (e) => onChange(e.target.value),
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: (e) => {
        setComposing(false);
        schedule(e && e.target ? e.target.value : draft);
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          submitNow();
        }
      },
      onBlur: submitNow,
    }),
    draft
      ? h("button", {
          className: "dshm-xbtn dshm-xbtn-infield",
          title: lookup("common.clear"),
          onClick: () => {
            setDraft("");
            if (timerRef.current) clearTimeout(timerRef.current);
            onCommit("");
            if (inputRef.current) inputRef.current.focus();
          },
        }, h(XIcon))
      : null,
  );
}

/** 计数紧凑化（11.9k 形态；title 属性给精确数）。 */
function compactCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
  }
  return String(n);
}

function Shot({ src, onClick, onBroken }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const chain = useImgChain(src, { h: 300, active: show });
  // 评审 R2-9：onBroken 经 effect 上报（渲染体内直调父 setState 会触发 React 告警/循环）
  useEffect(() => {
    if (chain.failed && onBroken) onBroken(src);
  }, [chain.failed, onBroken, src]);
  return h(
    "div",
    {
      ref,
      className: "dsvm-shotbox",
      onClick, role: "button", tabIndex: 0,
      // 0.9.45 U8：键盘可达（此前 role=button 但键盘无法开灯箱）
      onKeyDown: (e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.isComposing) {
          e.preventDefault();
          onClick();
        }
      },
    },
    show
      ? (chain.failed ? null : h("img", { className: "dsvm-shot", src: chain.src, alt: "", loading: "lazy", referrerPolicy: "no-referrer", fetchPriority: "low", decoding: "async", onError: chain.onError, onLoad: chain.onLoad }))
      : null,
  );
}

// 语义：当前层 tier 初始 = 打开时刻的偏好层（Q18 初始 weserv）；url 变化即重置为最新偏好层
// （灯箱翻页复用同一 <img> 换 src）；onError 经 nextTier 前进（weserv→direct→failed）；
// onLoad 记 rememberSuccess（最近成功层，成功才晋升，结构性不降级）；retry 重走整链不动桶偏好。
// 8s 人工超时仅当 active && needsTimeout(当前层)——「img 实际开始加载后才计时」由 active 门控：
// Shot 传 active: show（IO 未可见不计时，杜绝不可见耗尽 weserv 层）；Lightbox/Icon 恒真（缺省）。
function useImgChain(url, opts) {
  const { w, h, active = true } = opts || {};
  const bucket = useMemo(() => serviceBucketOf(url), [url]);
  // 链启动偏好快照（0.9.61 执行期修正·同批竞态）：同屏多图并行走链时，任一图成功会翻转全局偏好，
  // 若前进时读「当前偏好」，仍在旧 tier0 上的兄弟图会 nextTier(旧层, 新偏好)=序末 → 跳过兜底直判死
  // （探针 A18 实证：缩略图 1 经 direct 成功后 2/3 全灭）。故链内前进只认启动快照，翻转只影响下一条链。
  const startPrefRef = useRef(null);
  if (startPrefRef.current === null) startPrefRef.current = preferredTier(serviceBucketOf(url));
  const [tier, setTier] = useState(() => tierOrder(startPrefRef.current)[0]);
  // settled（评审 R1-1）：当前层已成功交付——8s 守卫必须随之解除，否则成功图 8s 后被强制换层重载
  // （大陆场景 → direct 败 → 缩略图误剔除/图标字母化/灯箱看着看着变占位）。
  const [settled, setSettled] = useState(false);
  const startChain = useCallback(() => {
    startPrefRef.current = preferredTier(serviceBucketOf(url));
    setSettled(false);
    setTier(tierOrder(startPrefRef.current)[0]);
  }, [url]);
  // url 变化 → 渲染期重置（derived-state 模式，评审 R1-5）：effect 重置存在「中间帧」——首帧用旧 tier
  // 算新 url 的 src 先发请求。渲染期比较 prevUrl 立即重渲染，无中间帧。
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    startPrefRef.current = preferredTier(serviceBucketOf(url));
    setSettled(false);
    setTier(tierOrder(startPrefRef.current)[0]);
  }
  const failed = tier === "failed";
  const src = failed ? "" : tier === "weserv" ? weservUrl(url, { w, h }) : url;
  // 序感知前进：以启动快照序换下一层（对称双兜底 Q3——preferred=direct 时 direct 败仍要试 weserv）
  // 评审 R2-3 防御性重置：当前 settled 后 onError 不可达（成功后同 src 不再 error），未来若引入「成功后再失败」路径时此重置保证语义完备
  const advance = () => { setSettled(false); setTier((t) => nextTier(t, startPrefRef.current)); };
  const onError = advance;
  const onLoad = useCallback(() => {
    setSettled(true);
    rememberSuccess(bucket, tier);
  }, [bucket, tier]);
  const retry = startChain;
  useEffect(() => {
    // 8s 守卫（仅 weserv 层；评审 R1-1：settled 即解除；评审 R1-1 附：空 url 不挂——字母兜底 Icon 白挂计时器）
    if (!url || !active || settled || !needsTimeout(tier)) return;
    const timer = setTimeout(advance, WESERV_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [url, active, settled, tier]);
  return { src, failed, retry, onError, onLoad, settled };
}

/** 冒烟/诊断专用：hook 完整链行为的出口（初始 src + onError/onLoad 接线 + failed 终态）。
 * 注意不 解构 props——解构出的 h 会遮蔽模块级 h(=React.createElement)，酿成「h is not a function」。 */
function UseImgChainProbe(props) {
  const chain = useImgChain(props.url, { w: props.w, h: props.h });
  if (chain.failed) return h("div", { className: "dsvm-probe-failed" }, "chain:failed");
  return h("img", { src: chain.src, alt: "", referrerPolicy: "no-referrer", decoding: "async", onError: chain.onError, onLoad: chain.onLoad });
}

// 根因（窗口态「图片占满、没有导航、无法退出」）：灯箱 position:fixed 是 .dshm-panel
// （backdrop-filter + overflow:hidden）的后代 → 面板盒成了包含块；图片按视口单位放大
// （旧 94vw/80vh 在 ≥730px 高的窗口里必然超出 ≤680px 的面板盒），‹›/圆点被裁到屏外，
// 又没有 ✕，全屏态面板恰为视口才侥幸可见。v2 三层修复：
// ① createPortal 挂 document.body——逃出包含块，任何面板状态（窗口/全屏/窄屏）都按真实视口定位；
// ② 控件全部绝对定位贴边（右上 ✕ 常驻、两侧 ‹›、底部计数+圆点 pill）——构造上不可能被图片挤出屏；
// ③ 点图即关（zoom-out 光标）+ 遮罩点击关 + Esc（DetailModal 文档级）——四条退出路径。
// 键盘 ←/→ 仍在 DetailModal 文档级监听（portal 不影响）；SSR/无 document 环境回退非 portal 树（冒烟测试可渲染）。
function Lightbox({ shots, index, onNav, onClose }) {
  const single = shots.length <= 1;
  const closeRef = useRef(null);
  const prevFocusRef = useRef(null);
  useEffect(() => {
    // 焦点还原（评审 R3）：记录开灯箱前的聚焦元素（截图缩略图），卸载时归还焦点——键盘用户不丢位置。
    // 捕获必须声明在「聚焦 ✕」effect 之前（effect 按声明序执行），否则捕获到的是 ✕ 自身。
    prevFocusRef.current = document.activeElement;
    return () => {
      const el = prevFocusRef.current;
      if (el && el.isConnected) el.focus();
    };
  }, []);
  useEffect(() => {
    // 对齐 DetailModal U8：开灯箱即聚焦关闭钮，键盘用户第一时间可达退出
    if (closeRef.current) closeRef.current.focus();
  }, []);
  // 0.9.61 图片加载链：weserv(w=1600, webp)→原图→双败占位（重试 + 打开原图逃生门）。
  // index 变化即 url 变化 → hook 自重置（复用同一 <img> 换 src）。
  const chain = useImgChain(shots[index], { w: 1600 });
  // 0.9.65 邻图预取：当前图 settled 后静默预热左右邻——URL 用与 useImgChain 完全
  // 同形的 weservUrl(w=1600)（逐字节同 URL，翻页直接命中浏览器缓存近零等待）。
  // 纯 best-effort：不碰赢家记忆/链状态，预取失败对真实链零影响（导航时照常走
  // weserv→原图双兜底）；prefetchedRef 去重防来回翻页重复发起；Set 随灯箱挂载期
  // 生命周期，重开灯箱重新预热。单图由 lbNeighbors 返回空表自然短路。
  const prefetchedRef = useRef(null);
  if (prefetchedRef.current === null) prefetchedRef.current = new Set();
  useEffect(() => {
    if (typeof Image === "undefined") return;
    if (!chain.settled || chain.failed) return;
    for (const n of lbNeighbors(index, shots.length)) {
      const url = shots[n];
      if (typeof url !== "string" || url === "" || prefetchedRef.current.has(url)) continue;
      prefetchedRef.current.add(url);
      const img = new Image();
      img.decoding = "async";
      img.src = weservUrl(url, { w: 1600 });
    }
  }, [chain.settled, chain.failed, index, shots]);
  // 0.9.65 触屏滑动切换：touch 指针横向滑过阈值（swipeDir 判向）即翻页，与键盘/‹›
  // 同走 lbStep。只认 pointerType==="touch"——鼠标拖拽维持原生语义（图=原生拖拽、
  // 遮罩=按下+点击才关，0.9.27 防拖拽误关守卫不破）；滑动终结后 500ms 内吞掉合成
  // click（拖拽本就不产 click，此处双保险：即便落在 ✕/遮罩上也不触发其点击语义）。
  const swipeRef = useRef(null);
  const swipedAtRef = useRef(0);
  const onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    swipeRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    if (e.pointerType !== "touch" || !swipeRef.current) return;
    const dir = swipeDir(e.clientX - swipeRef.current.x, e.clientY - swipeRef.current.y);
    swipeRef.current = null;
    if (!dir || single) return;
    swipedAtRef.current = Date.now();
    // 0.9.66 方向修正：触屏走内容拖拽隐喻——手指把条带往左拖（dx<0，dir=-1）＝翻到右边
    // 那张（下一张），与相册/车龙惯例一致；「ArrowRight=next」的光标隐喻只属于键盘，
    // 触屏必须取反映射（-dir）。0.9.65 锚错隐喻致真机方向相反（用户实机反馈定谳）。
    onNav(lbStep(index, -dir, shots.length));
  };
  const onClickCapture = (e) => {
    if (Date.now() - swipedAtRef.current < 500) e.stopPropagation();
  };
  const node = h(
    "div",
    { className: "dsvm-lightbox", role: "dialog", "aria-modal": "true", "aria-label": lookup("lb.title"), onPointerDown, onPointerUp, onClickCapture, ...backdropCloseHandlers(onClose) },
    chain.failed
      ? h(
          "div",
          { className: "dsvm-lbfail", onClick: (e) => e.stopPropagation() },
          h("div", { className: "dsvm-lbfailmsg" }, `⚠ ${lookup("lb.fail")}`),
          h("button", { className: "dsvm-btn", onClick: chain.retry }, lookup("lb.retry")),
          h(ExtLink, { href: shots[index] }, lookup("lb.open")),
        )
      : [
          // 0.9.62 走链期间转圈占位（settled 即卸载）；0.9.63 onClick=onClose——
          // backdropCloseHandlers 仅 target===根 时关（防拖拽误关），转圈是子元素，
          // 不补这条则点在 34px 转圈上无动作；急躁关闭是合理逃生门，与点图即关同语义。
          !chain.settled && chain.src ? h("div", { className: "dsvm-lbspin", "aria-hidden": "true", onClick: onClose }) : null,
          h("img", { className: `dsvm-lbimg${chain.settled ? " dsvm-lbimg-on" : ""}`, src: chain.src, alt: "", onClick: onClose, referrerPolicy: "no-referrer", decoding: "async", onError: chain.onError, onLoad: chain.onLoad }),
        ],
    h("button", { ref: closeRef, className: "dsvm-btn dsvm-lbclose", "aria-label": lookup("common.close"), title: lookup("common.close"), onClick: onClose }, h(XIcon)),
    single ? null : h("button", { className: "dsvm-btn dsvm-lbarrow prev", "aria-label": lookup("lb.prev"), title: lookup("lb.prev"), onClick: () => onNav(lbStep(index, -1, shots.length)) }, "‹"),
    single ? null : h("button", { className: "dsvm-btn dsvm-lbarrow next", "aria-label": lookup("lb.next"), title: lookup("lb.next"), onClick: () => onNav(lbStep(index, 1, shots.length)) }, "›"),
    single
      ? null
      : h(
          "div",
          { className: "dsvm-lbbar" },
          h("span", { className: "dsvm-lbcount" }, `${index + 1} / ${shots.length}`),
          // 评审 R4：key 用序号而非 URL——safeScreenshots 不去重，同一 URL 两次出现即 key 撞车
          h("div", { className: "dsvm-lbdots" }, ...shots.map((s, i) => h("span", { key: i, className: `dsvm-lbdot${i === index ? " on" : ""}`, onClick: () => onNav(i) }))),
          h("span", { className: "dsvm-lbhint" }, lookup("lb.hint")),
        ),
  );
  return typeof document !== "undefined" && document.body && typeof rd.createPortal === "function"
    ? rd.createPortal(node, document.body)
    : node;
}

function XIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", "aria-hidden": "true" },
    h("path", { d: "M6 6l12 12M18 6L6 18", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round" }));
}

function FsIcon({ full }) {
  return full
    ? h("svg", { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }),
        h("rect", { x: "8", y: "8", width: "12", height: "12", rx: "1", stroke: "currentColor", strokeWidth: "2" }))
    : h("svg", { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }));
}

function ProgressLine() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const d = await api("status");
        if (live) setSt(d);
      } catch {
        /* 瞬时失败忽略 */
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, []);
  if (!st) return null;
  const pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : null;
  const phaseLabel = lookup(PHASE_LABEL[st.phase] || "phase.ready");
  return h(
    "div",
    { className: "dshm-prog" },
    Spin(),
    h("span", null, `${st.target} · ${phaseLabel}${st.done ? ` ${st.done}${st.total ? "/" + st.total : ""}` : ""}`),
    pct !== null ? h("span", { className: "bar" }, h("i", { style: { width: pct + "%" } })) : null,
    st.currentPackage ? h("span", { className: "dshm-hint" }, String(st.currentPackage).slice(0, 44)) : null,
  );
}

function ReadmeBlock({ pkg, repo }) {
  const [state, setState] = useState({ loading: true, text: "", err: "", truncated: false, repo: "" });
  useEffect(() => {
    let live = true;
    api("readme", { pkg })
      .then((d) => live && setState({ loading: false, text: d.readme, err: "", truncated: d.truncated, repo: d.repo || "" }))
      .catch((e) => live && setState({ loading: false, text: "", err: String((e && e.message) || e) }));
    return () => {
      live = false;
    };
  }, [pkg]);
  if (state.loading) return h("div", { className: "dshm-hint" }, lookup("readme.loading"), Spin());
  if (state.err) return h("div", { className: "dshm-err" }, state.err);
  if (!state.text) return h("div", { className: "dshm-hint" }, lookup("readme.none"));
  return h(
    "div",
    { className: "dshm-readme md", onClick: (e) => e.stopPropagation() },
    renderMarkdown(state.text, { repo: state.repo || repo }),
    state.truncated ? h("div", { className: "dshm-md-note" }, lookup("readme.truncated")) : null,
  );
}

export { safeScreenshots, officialLinks, LinksRow, Icon, Spin, PhaseDot, ToggleSwitch, TwoStepButton, RestartBanner, SearchBox, compactCount, Shot, useImgChain, UseImgChainProbe, Lightbox, XIcon, FsIcon, ProgressLine, ReadmeBlock };

