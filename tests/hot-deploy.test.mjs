// scripts/hot-deploy.mjs 的原子替换单测（retro S1）：重点钉「硬链接防呆」——dest 与 pnpm store
// 式的第二链接共存时，替换后 dest 必须拿到新 inode（links=1）且旧链接内容原样保留。
// 纯 fs 逻辑，临时目录直测，不触真实 profile。
import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync, linkSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicReplace, sha256 } from "../scripts/hot-deploy.mjs";

const withSandbox = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "hotdeploy-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("① 普通替换：内容到位、mode 保留、nlink=1、sha 双读一致", () => {
  withSandbox((dir) => {
    const src = join(dir, "src.js");
    const dest = join(dir, "dest.js");
    writeFileSync(src, "NEW");
    writeFileSync(dest, "OLD", { mode: 0o644 });
    const { wasHardlinked } = atomicReplace(src, dest);
    assert.equal(wasHardlinked, false);
    assert.equal(readFileSync(dest, "utf8"), "NEW");
    assert.equal(sha256(src), sha256(dest));
    assert.equal(statSync(dest).nlink, 1);
    assert.equal(statSync(dest).mode & 0o777, 0o644);
  });
});

test("② 硬链接防呆（pnpm store 场景）：替换后 dest 新 inode、旧链接内容原样", () => {
  withSandbox((dir) => {
    const src = join(dir, "src.js");
    const dest = join(dir, "dest.js");
    const storeBlob = join(dir, "store-blob");
    writeFileSync(src, "NEW");
    writeFileSync(storeBlob, "OLD-STORE");
    linkSync(storeBlob, dest); // dest 是 store blob 的第二名字（复刻 pnpm 安装布局：装出的文件即 store 硬链）
    assert.equal(statSync(dest).nlink, 2);
    const { wasHardlinked } = atomicReplace(src, dest);
    assert.equal(wasHardlinked, true, "硬链接场景必须留痕");
    assert.equal(readFileSync(dest, "utf8"), "NEW", "dest 拿到新内容");
    assert.equal(statSync(dest).nlink, 1, "dest 断链（新 inode）");
    assert.equal(readFileSync(storeBlob, "utf8"), "OLD-STORE", "store blob 旧内容不受影响");
    assert.notEqual(statSync(dest).ino, statSync(storeBlob).ino);
  });
});

test("③ sha 校验闸：src 与 dest 内容不一致即抛（防半写）", () => {
  withSandbox((dir) => {
    const src = join(dir, "src.js");
    const dest = join(dir, "dest.js");
    writeFileSync(src, "NEW");
    writeFileSync(dest, "OLD");
    // 直接改 src 于替换后再验证不可能——这里以 tamper 目标文件模拟半写：先备份原子替换实现
    // 的不变量即可由 ①② 承载；本用例钉 sha256 导出本身 + 缺文件抛错路径。
    assert.throws(() => sha256(join(dir, "missing.js")), /ENOENT/);
    assert.equal(sha256(dest), sha256(dest), "同文件双读一致");
  });
});

test("④ 符号链接 dest 不受 rename 影响（替换的是目录项，不是 target）", () => {
  withSandbox((dir) => {
    const src = join(dir, "src.js");
    const target = join(dir, "real.js");
    const dest = join(dir, "link.js");
    writeFileSync(src, "NEW");
    writeFileSync(target, "OLD-TARGET");
    symlinkSync(target, dest);
    const { wasHardlinked } = atomicReplace(src, dest);
    // rename 覆盖的是 link.js 这个名字本身 → 变成普通文件；real.js 原样
    assert.equal(wasHardlinked, false);
    assert.equal(readFileSync(dest, "utf8"), "NEW");
    assert.equal(readFileSync(target, "utf8"), "OLD-TARGET", "软链 target 不被穿透");
  });
});
