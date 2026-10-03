/**
 * Mutation 后的跨视图刷新编排（DESIGN.md §4）。
 * 市场页、已装页与已装 updates（两段加载第二段，ADR-0008）消费同一份 web profile 事实；
 * 任一安装、卸载或升级完成后，三个视图必须一起重新读取，不能只刷新发起操作的那一页。
 * 不依赖 DOM/React，Node tests 直接 import。
 */

export async function refreshAfterMutation({ marketReload, installedReload, updatesReload }) {
  await Promise.all([
    marketReload(false),
    installedReload(),
    updatesReload(),
  ])
}
