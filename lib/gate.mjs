/**
 * 并发闸门：把「上游拒绝」变成「本地排队」。
 *
 * ## 为什么需要它（不是限流，是配额计数）
 *
 * 码道对**每个账号**只开 3 个并发会话，且一个会话要占满约 60 秒才释放，**中途停止
 * 生成并不减免**（实测 `TM.00001041 并发会话数已达上限(3个)`）。DSH 一轮对话可能
 * 同时发出多个模型请求（主对话、标题生成、压缩摘要），并发发出去就必然撞墙。
 *
 * 所以这里在本地维护「按账号计数的槽位」，超出的请求排队等位；并且**不按请求结束
 * 释放**，而是按实测的 TTL 占位——提前放行等于提前撞墙。
 *
 * ## 与 Python 版的关键差异
 *
 * Python 版用 `threading.BoundedSemaphore` 阻塞等待。DSH 是单进程事件循环，
 * 阻塞会把整个 Host 冻住，所以这里全部是异步的：等待走 `await sleep()`，
 * 并且尊重 AbortSignal（用户点停止时立即退出排队）。
 *
 * @module dsh-api-rules/gate
 */

import { sleep } from './http.mjs'

/** 一个账号的闸门。 */
class AccountGate {
  constructor(limit, holdMs, now) {
    this.limit = limit
    this.holdMs = holdMs
    this.now = now
    /** 到期时间戳列表：长度 = 在飞 + 冷却中的会话数。 */
    this.holds = []
  }

  prune() {
    const now = this.now()
    this.holds = this.holds.filter((expiresAt) => expiresAt > now)
    return this.holds.length
  }

  hasRoom() {
    return this.prune() < this.limit
  }

  occupy() {
    this.holds.push(this.now() + this.holdMs)
  }

  waitMs() {
    const used = this.prune()
    if (used < this.limit) return 0
    this.holds.sort((a, b) => a - b)
    return Math.max(0, this.holds[0] - this.now())
  }
}

/**
 * 一组账号的闸门。
 *
 * 选号语义是「**优先选还有空槽的账号**」：两个账号各有 3 个槽就是 6 个并发容量。
 * 全部排满时才等最早释放的那个，而不是直接失败。候选顺序由调用方决定（它可能已经
 * 按用户偏好排过），这里只按「有空槽」过滤，保持同序。
 */
export class SessionGate {
  constructor(options = {}) {
    this.limit = options.limit ?? 3
    this.holdMs = options.holdMs ?? 60_000
    this.now = options.now ?? Date.now
    /** @type {Map<string, AccountGate>} */
    this.gates = new Map()
  }

  gateOf(key) {
    let gate = this.gates.get(key)
    if (gate === undefined) {
      gate = new AccountGate(this.limit, this.holdMs, this.now)
      this.gates.set(key, gate)
    }
    return gate
  }

  /**
   * 占一个槽位。
   *
   * @returns {Promise<{key: string} | {waitMs: number}>} 没有任何候选时 `{ waitMs: Infinity }`。
   */
  async acquire(candidates, signal) {
    for (;;) {
      if (signal?.aborted === true) return { key: undefined }
      let earliest = Number.POSITIVE_INFINITY
      for (const candidate of candidates) {
        const gate = this.gateOf(candidate)
        if (gate.hasRoom()) {
          gate.occupy()
          return { key: candidate }
        }
        earliest = Math.min(earliest, gate.waitMs())
      }
      if (!Number.isFinite(earliest)) return { key: undefined }
      // 分片等待：既让出事件循环，也保证中途 abort 能及时生效。
      await sleep(Math.min(earliest, 5_000) + 50, signal)
    }
  }

  /** 观测快照（设置卡片上的「会话槽位」那一行）。 */
  snapshot(keys) {
    return keys.map((key) => {
      const gate = this.gateOf(key)
      const used = gate.prune()
      return { key, used, limit: this.limit, waitMs: gate.waitMs() }
    })
  }
}
