/**
 * 按 cosmokit 的真实 Volatile 引用协议手造引用（本地 cosmokit 版本较旧无 createVolatile 导出）。
 * 协议：Object.freeze({ get(): snapshot, [Symbol.for('cosmokit.volatile.write')]: (next) => void })。
 */
const WRITE = Symbol.for('cosmokit.volatile.write')

export function makeVolatileRef(value) {
  let current = value
  return Object.freeze({
    get: () => current,
    [WRITE]: (next) => {
      current = next
    },
  })
}

export { WRITE as VOLATILE_WRITE }
