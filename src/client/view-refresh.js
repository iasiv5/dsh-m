/**
 * Mutation 后的跨视图刷新编排（DESIGN.md §4）。
 * 市场页与已装页消费同一份 web profile 事实；任一安装、卸载或升级完成后，
 * 两个视图必须一起重新读取，不能只刷新发起操作的那一页。
 * 不依赖 DOM/React，Node tests 直接 import。
 */

export async function refreshAfterMutation({ marketReload, installedReload }) {
  await Promise.all([
    marketReload(false),
    installedReload(),
  ])
}
