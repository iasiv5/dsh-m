/**
 * 目录链接夹具原语（跨平台）：win32 用 junction——免开发者模式/管理员特权，且是
 * pnpm 在 Windows 的生产链接形态（issue #47 原始环境即 junction）；其余平台回退符号
 * 链接（Linux/CI 零漂移）。等价性实证（2026-11-06，win32 Node 24.19.0 探针）：junction
 * 的 lstat().isSymbolicLink() === true、readlink() 返回干净目标（无 \\?\ 前缀）、悬空目标
 * 可创建——与目录 symlink 在产品码全部链接检测点（doctor.ts analyzeFarm /
 * generation-projection / registry.ts）观测等价。文件链接不可 junction（仅目录），仍用 symlinkSync。
 */
import { symlinkSync } from 'node:fs'

export function linkDirSync(target, path) {
  if (process.platform === 'win32') return symlinkSync(target, path, 'junction')
  return symlinkSync(target, path)
}
