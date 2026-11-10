/**
 * issue #57 / ADR-0035：会话面双开关门控纯逻辑（单一事实源）。
 *
 * 归一化口径：`cfg?.x !== false`（undefined = 开，兼容缺省传播边界）；
 * 级联：sessionTools=false ⇒ 提示词段强制不注入（与 sessionPrompt 取值无关）。
 *
 * 宿主求值时机（live 语义的机理依据，2026-11-10 checkout 实证）：
 * - 提示词段 text 函数每次装配求值（dsh-system-prompt :389），空段被 renderPrompt 过滤（:119）；
 * - tools when 谓词逐步求值（dsh-tools :551），谓词非空不进可见视图（:533）。
 * 两谓词闭包持有 registerTools 传入的共享 config 对象（host.ts 传入 controller.config，
 * registry-controller handleExternalWatch 原地同步字段 → 新装配即见新值）。
 */
export interface SessionGateConfig {
  sessionTools?: boolean
  sessionPrompt?: boolean
}

export const SESSION_PROMPT_SECTION_NAME = 'tool:dshm'

export const SESSION_PROMPT_SECTION_ORDER = 211

/** R1 定稿文本（计划「文案钉死」节，主人 2026-11-10 批准）。 */
export const SLIM_PROMPT_SECTION =
  'Plugin marketplace requests (finding / recommending / browsing / installing DSH plugins) route to the dshm_* tools ahead of web_search or bash — each tool\'s own description carries the confirmation and retry discipline. dsh-m follows the current host profile (web or desktop): on desktop only dshm_restart is refused; relay its guidance instead of retrying.'

/** 归一化：undefined = 开（仅显式 false 关闭）。 */
export function sessionToolsEnabled(cfg: SessionGateConfig | undefined): boolean {
  return cfg?.sessionTools !== false
}

/** 级联：sessionTools=false ⇒ 提示词强制不注入。 */
export function sessionPromptEnabled(cfg: SessionGateConfig | undefined): boolean {
  return sessionToolsEnabled(cfg) && cfg?.sessionPrompt !== false
}

/** 装配期取文本：关闭态返回 ''（宿主 renderPrompt 过滤空段）。 */
export function resolveSessionPromptText(cfg: SessionGateConfig | undefined): string {
  return sessionPromptEnabled(cfg) ? SLIM_PROMPT_SECTION : ''
}
