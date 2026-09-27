/**
 * 开关/徽标/横幅分流的纯视图模型（plan Task 17；Node 可测，无 DOM）。
 *
 * 相位点只映射 phase 五值（B4 定稿）：「已停用」不由相位点表达，归 Switch 状态
 * （enabled===false 时相位必为 null，两输入源各管各的）。
 * toggleViewModel 输出 i18n key + 参数，成品文案 lookup 留在 main.jsx。
 */

/** phase → 徽标点 class + i18n key（null → 无点）。 */
const PHASE_VIEW = {
  active: { phaseDotClass: 'ok', phaseLabelKey: 'phase.active' },
  failed: { phaseDotClass: 'err', phaseLabelKey: 'phase.failed' },
  pending: { phaseDotClass: 'idle', phaseLabelKey: 'phase.pending' },
  loading: { phaseDotClass: 'busy', phaseLabelKey: 'phase.loading' },
  unloading: { phaseDotClass: 'busy', phaseLabelKey: 'phase.unloading' },
}

const LOCK_TITLE_KEYS = {
  self: 'toggle.lock.self',
  protected: 'toggle.lock.protected',
  'no-entry': 'toggle.lock.noentry',
}

/**
 * 已装卡开关视图模型（一次计算，卡片内多处消费）。
 * @param {{ enabled?: boolean; phase?: string | null; toggleable?: boolean; lockReason?: string }} it
 */
export function toggleViewModel(it) {
  const phase = PHASE_VIEW[it.phase] ?? { phaseDotClass: '', phaseLabelKey: null }
  const toggleable = it.toggleable !== false && it.lockReason === undefined
  return {
    phaseDotClass: phase.phaseDotClass,
    phaseLabelKey: phase.phaseLabelKey,
    switchOn: it.enabled === true,
    switchDisabled: !toggleable,
    switchTitleKey: it.lockReason ? LOCK_TITLE_KEYS[it.lockReason] || null : null,
  }
}

/**
 * 开关操作结果 → 通知文案 key（live/restart 分流，Rev2 定稿 Q4）。
 * restart 态由调用方联动既有 needsRestart 重启横幅。
 * @param {{ pkg?: string; enabled?: boolean; applied?: string; via?: string; warnings?: string[] }} result
 */
export function toggleNoticeKeys(result) {
  const direction = result.enabled === true ? 'on' : 'off'
  const applied = result.applied === 'live' ? 'live' : 'restart'
  return {
    textKey: `notify.toggled.${direction}.${applied}`,
    params: { pkg: result.pkg || '' },
    needsRestart: applied === 'restart',
  }
}
