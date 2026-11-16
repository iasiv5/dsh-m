// tests/fixtures/lockfile-cases.mjs — 锁档观测共享夹具（ADR-0037 T1；评审 R1-2/R2-1/R3-1 用例载体）
// 全部为 pnpm v9 形态 lock 文本；镜像夹具收敛（T8）复用本文件。命名即文档：每例注释注明钉住的决议/仲裁条款。

const V9 = "lockfileVersion: '9.0'\n\n"

export const caseRegistryKey = `${V9}packages:
  'pkg-a@1.2.3':
    resolution: {integrity: sha512-aaa}
`

export const caseScopedQuoted = `${V9}packages:
  '@scope/pkg@2.0.0':
    resolution: {integrity: sha512-sss}
`

// 包络①（B6/评审 R2-1 附带）：双引号键此前 A/B 形观测不到，view 并集归一后可观测
export const caseDoubleQuoted = `${V9}packages:
  "pkg-b@1.0.0":
    resolution: {integrity: sha512-bbb}
    version: 1.0.0
`

// 键归一并集（B5）：node_modules/ 前缀（v6 形态）——A 容忍、C 不容忍，view 取并集
export const caseNodeModulesPrefixV6 = `${V9}packages:
  registry.npmjs.org/foo/node_modules/pkg-c@3.0.0:
    resolution: {integrity: sha512-ccc}
`

// version 归一（B5，B1/doctor 权威）：剥引号 + 全部尾部括号组
export const casePeerSuffix = `${V9}packages:
  'pkg-d@4.5.6(@peer@1.0.0)':
    resolution: {integrity: sha512-ddd}
    version: 4.5.6(@peer@1.0.0)(@other@2.0.0)
`

// integrity 前缀约束（B5，C 权威）：非行首/非 `{`/`,` 前缀的 integrity: 不捕获；
// 无可观测证据字段 → observationOf null（A:305 同语义）
export const caseIntegrityPrefixConstraint = `${V9}packages:
  'pkg-i@1.0.0':
    notintegrity: sha512-zzz
    peerDependenciesMeta:
      react:
        optional: true
`

// 等价性用例（ADR-0037 决议 5 / R1-2）：规范锁上 A 形无约束捕获 ≡ C 形前缀约束捕获。
// A 形探针为快照语义（R2-3）：锚定 market-mutation.ts:296 的 2026-11-16 形态，不跟踪现行实现。
export const caseEquivalence = {
  lock: `${V9}packages:
  'pkg-x@1.0.0':
    resolution: {integrity: sha512-eqq}
`,
  body: '    resolution: {integrity: sha512-eqq}',
}

// commit 三级（B5，A 权威）·第一级：体内 `commit:` 字段，并钉优先级（压过键内/tarball hex）
export const caseCommitField = `${V9}packages:
  'pkg-h@github.com/o/r#ffff111111111111111111111111111111111111':
    resolution: {tarball: https://codeload.github.com/o/r/tar.gz/ffff111111111111111111111111111111111111}
    commit: 1111111111111111111111111111111111111111
`

// commit 三级·第二级：键内 40-hex（体无 commit 字段、tarball 无 hex）
export const caseGitHttpsKey = `${V9}packages:
  'pkg-g@git+https://github.com/o/r#eeee222222222222222222222222222222222222':
    resolution: {tarball: https://github.com/o/r/archive/refs/heads/main.tar.gz}
`

// commit 三级·第三级：tarball URL 内 40-hex（键无 hex、体无 commit 字段）
export const caseGitTarballUrlKey = `${V9}packages:
  'pkg-f@https://example.com/pkg-f-1.0.0.tgz':
    resolution: {tarball: https://codeload.github.com/o/r/tar.gz/dddd333333333333333333333333333333333333}
`

// 重复键（归一后同键）：文件序首条胜 + anomalies 透出（B3）
export const caseDupKeys = `${V9}packages:
  'pkg-dup@1.0.0':
    resolution: {integrity: sha512-111}
  pkg-dup@1.0.0:
    resolution: {integrity: sha512-222}
`

// R2-1：嵌套冒号行（缩进 4 的块样式子映射）入 body 不入键、不截断、不产 anomalies；
// version 行在 peerDependencies: 之后仍可观测；同段后继条目不受影响
export const caseNestedColonLines = `${V9}packages:
  'pkg-n@1.0.0':
    resolution: {integrity: sha512-nnn}
    peerDependencies:
      react: ^18.0.0
    version: 1.0.0
  'pkg-n2@2.0.0':
    resolution: {integrity: sha512-n2n}
`

// 顶格 snapshots: 段（真实 web profile 锁形态实证）键不入 packages 观测——D1 段终止承重墙（评审建议 b）
export const caseSnapshotsSection = `${V9}packages:
  'real@1.0.0':
    resolution: {integrity: sha512-rrr}

snapshots:
  '@antfu/install-pkg@2.1.0':
    resolution: {integrity: sha512-sss2}
`

// 相似包名不误匹配（npm-integrity.test :176 语义在 observationOf/candidatesOf 的投影）
export const caseSimNames = `${V9}packages:
  'pkg@1.2.3':
    resolution: {integrity: sha512-111}
  'pkg-a@1.2.3':
    resolution: {integrity: sha512-222}
`

// lockfileVersion 缺失行 → null（B3：观测不做门）
export const caseNoVersionLine = `packages:
  'pkg-a@1.2.3':
    resolution: {integrity: sha512-aaa}
`

// 无 packages: 段：观测 null、anomalies 空
export const caseNoPackages = `${V9}importers:

  .:
    dependencies:
      pkg-a:
        specifier: ^1.0.0
        version: 1.2.3
`

// lockfileVersion 无引号形态（包络③ view 侧观测值恒 '9.0'）
export const caseUnquotedVersion = `lockfileVersion: 9.0

packages:
  'pkg-a@1.2.3':
    resolution: {integrity: sha512-aaa}
`
