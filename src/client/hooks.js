/**
 * 客户端数据 hooks（ADR-0023 第三刀 T9 出仓）：api / useAsync / useMarketData / fmtDate /
 * useScrollableContain。useMarketData 是市场数据唯一 owner（服务端分页 + generation/abort +
 * 快照秒开，历史注释随函数体 verbatim 保留）；useScrollableContain 为滚轮治理条件挂载 hook
 * （消费方：RestartBanner / OperationsCard / MarketPanel toast，见 ADR-0023 附录时序表 T9 行）。
 * 依赖注入：react hooks 具名导入；market-state / market-snapshot 纯逻辑经 ESM import。
 */
import { useState, useEffect, useCallback, useRef } from "react"
import { normalizeMarketQuery, createZoneState, normalizeMarketResponse, searchSourceOf, resetPageOnFilterChange, mergeLatestFields, marketResponseEquivalent } from "./market-state.js"
import { readMarketSnapshot, writeMarketSnapshot, isDefaultFirstPageQuery } from "./market-snapshot.js"

const API = "/dshm";
// ---------- 本地 API（host: /dshm, method 分发） ----------
async function api(method, params, signal) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, ...(params || {}) }),
    ...(signal ? { signal } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `API ${res.status}`);
    if (data && typeof data === "object" && data.issue) err.issue = data.issue; // IncompatibleError 结构化载体
    // 0.9.6：能力表结构化拒绝（ProfileUnsupportedError 409）全字段透传——GUI 据此把
    // 「官方入口指引」渲染成中性 info 横幅，而非红色「升级失败」（Windows 实机反馈）
    if (data && typeof data === "object" && data.code === "unsupported-on-profile") {
      err.unsupported = { action: data.action, profile: data.profile, guidance: typeof data.guidance === "string" ? data.guidance : "" };
    }
    // M2 Task 3：装后守卫拦截的字段全保留（GUI 一键重启只读 restartSafe，不得由 needsRestart 推导）
    if (data && typeof data === "object" && data.kind && Array.isArray(data.violations)) {
      err.guard = { kind: data.kind, violations: data.violations, compensation: data.compensation, needsRestart: data.needsRestart === true, restartSafe: data.restartSafe === true, repairBasis: data.repairBasis };
    }
    // ADR-0026（issue #30）：批量升级三态分流依据——服务端 failureClass 透传（缺省按 target）
    if (data && typeof data === "object" && typeof data.failureClass === "string") err.failureClass = data.failureClass;
    throw err;
  }
  return data;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("zh-CN", { hour12: false }) : "—";
}

function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback((force) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return fn(force)
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((err) => setState({ loading: false, data: null, error: String((err && err.message) || err) }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run(false);
  }, [run]);
  return { ...state, reload: run };
}

// ---------- 市场数据唯一 owner（服务端分页 + generation/abort + 0.9.14 默认首页快照秒开） ----------
function useMarketData(zone = "community") {
  const [query, setQuery] = useState(() => normalizeMarketQuery(createZoneState(zone), zone));
  // 0.9.14 快照秒开：仅首渲染读一次 localStorage（useState 惰性初始化），命中即先渲染上次
  // 默认首页响应（loading=false），background 换新；读侧再过一次 normalize 兜形状漂移
  const [boot] = useState(() => {
    const snap = readMarketSnapshot(typeof window !== "undefined" && window.localStorage ? window.localStorage : null, { zone });
    return snap ? { data: normalizeMarketResponse(snap), has: true } : { data: null, has: false };
  });
  const [data, setData] = useState(boot.data);
  const [loading, setLoading] = useState(!boot.has);
  const [error, setError] = useState(null);
  const genRef = useRef(0);
  const abortRef = useRef(null);
  const queryRef = useRef(query);
  const dataRef = useRef(boot.data);
  const storage = () => (typeof window !== "undefined" && window.localStorage ? window.localStorage : null);

  const fetchPage = useCallback((nextQuery, force, background = false, probeMode = "cache-only") => {
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // background 且已有数据可显示：不置 loading、不清 error（静默换新，失败保留旧数据）
    if (!background || !dataRef.current) {
      setLoading(true);
      setError(null);
    }
    const params = {
      query: nextQuery.query || undefined,
      category: nextQuery.category || undefined,
      // 0.9.25 跨区搜索：query 非空 → source=all（社区+精选一并命中），浏览态维持本区 source
      source: searchSourceOf(nextQuery),
      ...(nextQuery.sort ? { sort: nextQuery.sort } : {}),
      offset: nextQuery.offset,
      limit: nextQuery.limit,
      // 0.9.45 两段加载（ADR-0013）：第一段 cache-only 零网络回页；'full' 为终态语义不下传（core 缺省等价）
      ...(probeMode !== "full" ? { probeMode } : {}),
      ...(force ? { force: true } : {}),
    };
    return api("market", params, ac.signal)
      .then((raw) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        const next = normalizeMarketResponse(raw);
        // 会话内徽标不回退：上一轮响应有 latest 族值而本响应缺 → 按 id 叠加（快照不含 latest 族字段）
        const prevData = dataRef.current;
        const prevItems = prevData && Array.isArray(prevData.items) ? prevData.items : null;
        const mergedItems = mergeLatestFields(next.items, prevItems);
        const merged = mergedItems === next.items ? next : { ...next, items: mergedItems };
        dataRef.current = merged;
        // 零增量提交守卫（C3 附带红利）：内容等价则不提交——引用稳定性不再被无条件 setData 蒸发
        // （toggle 后 refreshViews 四连响应常态；ZoneChips setGeom 同款纪律）。
        // dataRef 照常更新（mergeLatestFields 的 prev 事实源），loading 照常收口，仅跳过 React 提交。
        if (!marketResponseEquivalent(prevData, merged)) setData(merged);
        setLoading(false);
        // 第二段：仅 cache-only 首段有缺口时发起（'full' 恒为终态——防 latestTimedOut 死循环）；
        // force 由 params 传递 → core peek 旧值兜底 + 全页重探（P2）
        if (probeMode === "cache-only" && next.latestComplete === false) {
          return fetchPage(nextQuery, force, true, "full");
        }
        // 快照只在终态写（第一段无缺口，或第二段 merge 完成）——首段缺口 intermediate 态不写，防快照质量降级
        if (isDefaultFirstPageQuery(nextQuery, zone)) writeMarketSnapshot(storage(), { zone, response: merged });
      })
      .catch((e) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        if (background && dataRef.current) return;   // 第二段失败静默保留（Q11②）
        setError(String((e && e.message) || e));
        setLoading(false);
      });
  }, []);

  const updateQuery = useCallback((patch, opts = {}) => {
    const next = resetPageOnFilterChange(queryRef.current, normalizeMarketQuery({ ...queryRef.current, ...patch }, zone));
    queryRef.current = next;
    setQuery(next);
    if (opts.fetch !== false) fetchPage(next, opts.force);
  }, [fetchPage]);

  // 0.9.45：reload（mutation 后 refreshViews / 显式刷新）直发终态语义 full；force 走 params → core peek 旧值兜底 + 全页重探
  const reload = useCallback((force) => fetchPage(queryRef.current, force, false, "full"), [fetchPage]);

  useEffect(() => {
    fetchPage(queryRef.current, false, boot.has);
    return () => abortRef.current?.abort();
  }, [fetchPage]);

  return { query, data, loading, error, reload, updateQuery };
}


// ---------- 滚动区滚轮治理（0.9.72：contain 改为「可滚才挂」） ----------
// 病灶：overscroll-behavior:contain 恒挂在 max-height 滚动区上（0.9.64 随操作记录滚动区引入）。
// overflow-y:auto 使元素无论内容多少都是滚动容器，而规范口径「没有可滚溢出的滚动容器恒在
// 滚动边界」+ contain「到边界禁止向祖先链滚」→ 内容不满时整块区域吞掉滚轮、页面无法翻页。
// Chrome 144 起「Respect overscroll-behavior on non-scrollable scroll containers」落地
// （此前引擎仅在真可滚时才执行 contain，病灶被宽容掩盖），潜伏缺陷被引擎升级激活。
// 修复 = 意图精确化「有得滚才断链」：实测 scrollHeight > clientHeight 才挂 .is-scrollable（=contain）。
// 容器与首子元素都进 ResizeObserver：改宽折行/注记增删引起的可滚性翻转自动复检；dep 由调用方
// 给内容键（条数/文本）。SSR 冒烟（renderToString）effect 不跑、ResizeObserver 缺席即跳过，类名恒缺省。
function useScrollableContain(dep) {
  const ref = useRef(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [dep]);
  return [ref, scrollable ? " is-scrollable" : ""];
}

export { API, api, fmtDate, useAsync, useMarketData, useScrollableContain };
