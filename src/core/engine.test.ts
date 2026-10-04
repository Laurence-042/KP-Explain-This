import { describe, expect, it } from 'vitest'
import { GameEngine, type EngineEvent } from './engine'
import { LLMClient, type ChatParams } from './llm/client'
import { LLMSession } from './llm/session'
import { HumanController, LlmKpController, type RoleController } from './controller'
import { parseTxt } from './book'
import type { RoleDef } from './types'

/**
 * 引擎集成测试：注入真实控制器类（HumanController / LlmKpController），
 * 只 mock LLMClient 的传输方法。验证：控制器驱动循环、验证门控、
 * scene_end 自动翻页、全体同意重骰（含回滚）、中断重试、双 PC 扩展、快照恢复。
 */

const bookText = Array.from({ length: 100 }, (_, i) => `w${String(i).padStart(3, '0')}`).join(' ')

const KP_SCENE_REPLY =
  '雪夜的小巷尽头，债主的脚步声正在逼近。\n\n```json\n{"location": "雪夜小巷", "scene": "逃避债主", "facts_added": ["债主正在逼近"]}\n```'
const KP_RESOLVE_REPLY =
  '你撬开冻住的窗框翻进仓库，追赶声远去。\n\n```json\n{"location": "仓库", "inventory_added": ["生锈的钥匙"], "npc_changes": {"债主": {"status": "追丢了"}}}\n```'
const KP_RESOLVE_END_REPLY =
  '仓库的门在身后合拢，这一夜结束了。\n\n```json\n{"location": "仓库", "scene_end": true}\n```'
const KP_NEXT_SCENE_REPLY = '仓库深处亮着一盏不该亮着的灯。\n\n```json\n{"scene": "仓库中的灯"}\n```'

/** 轮询等待条件成立（引擎循环异步推进） */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

type StreamMock = (
  params: ChatParams,
  stage: string,
  onChunk: (d: string) => void,
  signal?: AbortSignal,
) => Promise<string>

function makeMocks() {
  const kpClient = new LLMClient('http://fake/v1', 'key')
  const validatorClient = new LLMClient('http://fake/v1', 'key')

  let kpReplyIndex = 0
  const kpReplies: string[] = []
  let kpStreamImpl: StreamMock = async (_p, _s, onChunk) => {
    const reply = kpReplies[kpReplyIndex] ?? KP_SCENE_REPLY
    kpReplyIndex++
    onChunk(reply)
    return reply
  }
  ;(kpClient as unknown as Record<string, unknown>).stream = (
    p: ChatParams,
    s: string,
    onChunk: (d: string) => void,
    signal?: AbortSignal,
  ) => kpStreamImpl(p, s, onChunk, signal)

  let validatorFail = false
  ;(validatorClient as unknown as Record<string, unknown>).complete = async (
    params: ChatParams,
  ) => {
    if (validatorFail) throw new Error('HTTP 500')
    // 从 Validator 请求中提取关键词，全部判 true（宽松 mock）
    const user = [...params.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const kwBlock = user.match(/玩家关键词[\s\S]*?(?=## 玩家行动)/)?.[0] ?? ''
    const kws = [...kwBlock.matchAll(/^- (.+)$/gm)].map((m) => m[1])
    const usage: Record<string, boolean> = {}
    for (const k of kws) usage[k] = true
    return JSON.stringify({ valid: true, keyword_usage: usage, world_consistent: true, reason: 'mock ok' })
  }

  return {
    kpClient,
    validatorClient,
    setKpReplies(list: string[]) {
      kpReplies.length = 0
      kpReplies.push(...list)
      kpReplyIndex = 0
    },
    failNextKp() {
      const prev = kpStreamImpl
      kpStreamImpl = async () => {
        kpStreamImpl = prev
        throw new Error('HTTP 500')
      }
    },
    abortNextKp() {
      const prev = kpStreamImpl
      kpStreamImpl = async () => {
        kpStreamImpl = prev
        throw new DOMException('aborted', 'AbortError')
      }
    },
    set validatorFail(v: boolean) {
      validatorFail = v
    },
  }
}

function makeGame(kpReply?: string[]) {
  const mocks = makeMocks()
  if (kpReply) mocks.setKpReplies(kpReply)

  const kpRole: RoleDef = { id: 'kp', name: 'KP', kind: 'kp', controller: 'llm', bookId: 'b1' }
  const pcRole: RoleDef = { id: 'pc-a', name: '玩家A', kind: 'pc', controller: 'human', bookId: 'b1' }

  const kpSession = new LLMSession(mocks.kpClient, { model: 'kp-model', temperature: 0.8 })
  const validatorSession = new LLMSession(mocks.validatorClient, { model: 'v-model', temperature: 0.1 })

  const events: EngineEvent[] = []
  const engine = new GameEngine(validatorSession, (e) => events.push(e))

  const rejectedReasons: string[] = []
  const human = new HumanController(pcRole, {
    onRejected: (reason) => rejectedReasons.push(reason),
  })
  const kp = new LlmKpController(kpRole, kpSession)
  const books = { b1: parseTxt('b1', '测试书', bookText) }

  return { engine, human, kp, kpSession, validatorSession, events, books, mocks, rejectedReasons, kpRole, pcRole }
}

async function start(engine: GameEngine, controllers: RoleController[], books: Record<string, unknown>) {
  void engine.start(controllers as never, engine.validatorSession, books as never, 3).catch(() => {})
}

describe('GameEngine：控制器驱动循环', () => {
  it('开局 → 掷骰 → KP 场景 → 等待玩家行动（human controller 挂起）', async () => {
    const ctx = makeGame([KP_SCENE_REPLY])
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    const e = ctx.engine
    expect(e.phase).toBe('await-action')
    expect(e.round).toBe(1)
    for (const role of [ctx.kpRole, ctx.pcRole]) {
      expect(e.keywords[role.id]).toHaveLength(3)
      expect(new Set(e.keywords[role.id]).size).toBe(3)
    }
    expect(e.world.location).toBe('雪夜小巷')
    expect(e.currentSceneNarrative).toContain('雪夜')
    // KP 历史：assistant 只保留叙事
    const msgs = ctx.kpSession.messages
    expect(msgs[msgs.length - 1].role).toBe('assistant')
    expect(msgs[msgs.length - 1].content).not.toContain('```')
    ctx.engine.stop()
  })

  it('人类控制器提交行动 → 验证通过 → KP 推进', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_REPLY])
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    expect(ctx.human.submitText('我用 w000 撬开被 w001 冻住的窗，躲开 w002。')).toBe(true)
    await waitFor(() => ctx.human.awaitingAction && ctx.engine.world.location === '仓库')

    expect(ctx.engine.world.inventory['pc-a']).toContain('生锈的钥匙')
    expect(ctx.engine.world.npcs['债主']).toEqual({ name: '债主', status: '追丢了' })
    expect(ctx.engine.log.some((l) => l.type === 'verdict' && l.ok)).toBe(true)
    ctx.engine.stop()
  })

  it('Validator 驳回：行动不进 KP，玩家被通知后可重新提交', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_REPLY])
    // 第一次验证返回拒绝
    ;(ctx.mocks.validatorClient as unknown as Record<string, unknown>).complete = async (params: ChatParams) => {
      const user = [...params.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const kwBlock = user.match(/玩家关键词[\s\S]*?(?=## 玩家行动)/)?.[0] ?? ''
      const kws = [...kwBlock.matchAll(/^- (.+)$/gm)].map((m) => m[1])
      const usage: Record<string, boolean> = {}
      kws.forEach((k, i) => (usage[k] = i === 0))
      return JSON.stringify({ valid: false, keyword_usage: usage, world_consistent: true, reason: '关键词未真正使用' })
    }
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    const worldBefore = JSON.stringify(ctx.engine.world)
    const kpMsgCount = ctx.kpSession.messages.length
    ctx.human.submitText('我随便跑两步。')
    await waitFor(() => ctx.rejectedReasons.length > 0)

    expect(ctx.engine.phase).toBe('await-action')
    expect(JSON.stringify(ctx.engine.world)).toBe(worldBefore)
    expect(ctx.kpSession.messages.length).toBe(kpMsgCount)
    expect(ctx.engine.log.some((l) => l.type === 'verdict' && !l.ok)).toBe(true)
    expect(ctx.human.awaitingAction).toBe(true) // 重新等待该玩家
    ctx.engine.stop()
  })

  it('Validator 网络失败：警告后回到等待，可重试', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_REPLY])
    ctx.mocks.validatorFail = true
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    ctx.human.submitText('行动')
    await waitFor(() => ctx.engine.log.some((l) => l.type === 'warning'))
    expect(ctx.engine.phase).toBe('await-action')
    expect(ctx.human.awaitingAction).toBe(true)
    ctx.engine.stop()
  })

  it('scene_end 自动收尾：翻页进入下一轮并自动生成新场景', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_END_REPLY, KP_NEXT_SCENE_REPLY])
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    ctx.human.submitText('我把门堵死，结束这一切。')
    await waitFor(() => ctx.engine.round === 2 && ctx.human.awaitingAction)

    expect(ctx.engine.currentSceneNarrative).toContain('不该亮着的灯')
    expect(ctx.engine.log.some((l) => l.type === 'system' && l.text.includes('场景结束'))).toBe(true)
    expect(ctx.events.some((ev) => ev.type === 'flip')).toBe(true)
    // 没有任何"主动结束场景"入口（引擎 API 面上不存在 endScene）
    expect((ctx.engine as unknown as Record<string, unknown>).endScene).toBeUndefined()
    ctx.engine.stop()
  })
})

describe('GameEngine：重骰（全体同意）', () => {
  it('回滚世界/日志/KP 历史到本轮开始，重掷骰子并重新开场', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_REPLY, KP_SCENE_REPLY])
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    ctx.human.submitText('我用 w000 撬开 w001 冻住的窗，躲开 w002。')
    await waitFor(() => ctx.engine.world.location === '仓库')
    await waitFor(() => ctx.human.awaitingAction)

    const worldBeforeReroll = JSON.stringify(ctx.engine.world)
    const logBeforeReroll = ctx.engine.log.length
    const kpMsgsBeforeReroll = ctx.kpSession.messages.length
    expect(ctx.human.awaitingAction).toBe(true)

    const ok = await ctx.engine.requestReroll('pc-a')
    expect(ok).toBe(true)
    await waitFor(() => ctx.human.awaitingAction && ctx.engine.world.location === '雪夜小巷')

    // 世界回滚到本轮开场后的状态并由新场景重建
    expect(ctx.engine.world.location).toBe('雪夜小巷')
    expect(ctx.engine.world.inventory['pc-a']).toEqual([]) // 仓库钥匙被回滚
    // 日志被截断到本轮前再追加：round + 新 scene + 重骰 system
    expect(ctx.engine.log.length).toBeLessThan(logBeforeReroll + 4)
    expect(ctx.engine.log.some((l) => l.type === 'system' && l.text.includes('重来'))).toBe(true)
    // KP 历史截断：本轮开场前 1 条（user+assistant 2 条）→ 重新开场后 = 2 条
    expect(ctx.kpSession.messages.length).toBe(2)
    expect(kpMsgsBeforeReroll).toBeGreaterThan(2)
    expect(worldBeforeReroll).toContain('仓库')
    ctx.engine.stop()
  })
})

describe('GameEngine：中断与重试', () => {
  it('KP 生成失败 → interrupted → retryInterrupted 重试成功', async () => {
    const ctx = makeGame([])
    ctx.mocks.setKpReplies([KP_SCENE_REPLY])
    ctx.mocks.failNextKp()
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.engine.phase === 'interrupted')

    expect(ctx.engine.canRequestReroll).toBe(true)
    ctx.engine.retryInterrupted()
    await waitFor(() => ctx.human.awaitingAction)
    expect(ctx.engine.currentSceneNarrative).toContain('雪夜')
    // user 消息没有被重复
    expect(ctx.kpSession.messages.filter((m) => m.role === 'user').length).toBe(1)
    ctx.engine.stop()
  })

  it('生成中途 abort → interrupted → 发起重骰也可用', async () => {
    const ctx = makeGame([])
    ctx.mocks.setKpReplies([KP_SCENE_REPLY])
    ctx.mocks.abortNextKp()
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.engine.phase === 'interrupted')

    const ok = await ctx.engine.requestReroll('pc-a')
    expect(ok).toBe(true)
    await waitFor(() => ctx.human.awaitingAction)
    expect(ctx.engine.currentSceneNarrative).toContain('雪夜')
    ctx.engine.stop()
  })
})

describe('GameEngine：多 PC 扩展（同基类架构验证）', () => {
  it('两个真人 PC 依次行动，各自验证并推进', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_REPLY, KP_RESOLVE_END_REPLY, KP_NEXT_SCENE_REPLY])
    const pcB: RoleDef = { id: 'pc-b', name: '玩家B', kind: 'pc', controller: 'human', bookId: 'b1' }
    const humanB = new HumanController(pcB)

    await start(ctx.engine, [ctx.kp, ctx.human, humanB], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)

    // PC A 行动
    ctx.human.submitText('玩家A：我用 w000 撬窗。')
    await waitFor(() => humanB.awaitingAction)
    expect(ctx.engine.log.some((l) => l.type === 'action' && l.roleId === 'pc-a')).toBe(true)

    // PC B 行动（A 的行动已被 KP 处理）
    const narrativeAfterA = ctx.engine.currentSceneNarrative
    humanB.submitText('玩家B：我从 w003 侧门溜进去。')
    await waitFor(() => ctx.human.awaitingAction && ctx.engine.round === 2)
    expect(ctx.engine.log.some((l) => l.type === 'action' && l.roleId === 'pc-b')).toBe(true)
    expect(narrativeAfterA).toBeTruthy()
    ctx.engine.stop()
  })
})

describe('GameEngine：快照恢复', () => {
  it('snapshot → 新引擎+新控制器 → restore + resumeLoop 后继续游戏', async () => {
    const ctx = makeGame([KP_SCENE_REPLY, KP_RESOLVE_REPLY])
    await start(ctx.engine, [ctx.kp, ctx.human], ctx.books)
    await waitFor(() => ctx.human.awaitingAction)
    ctx.human.submitText('我用 w000 撬开 w001 冻住的窗。')
    await waitFor(() => ctx.engine.world.location === '仓库' && ctx.human.awaitingAction)
    ctx.engine.stop()

    const snap = ctx.engine.snapshot()
    const kpSer = ctx.kpSession.serialize()

    // 重建：新 client/session/controller/engine
    const mocks2 = makeMocks()
    mocks2.setKpReplies([KP_RESOLVE_END_REPLY, KP_NEXT_SCENE_REPLY])
    const kpSession2 = new LLMSession(mocks2.kpClient, { model: 'kp-model' })
    kpSession2.restore(kpSer)
    const kp2 = new LlmKpController(ctx.kpRole, kpSession2)
    const validator2 = new LLMSession(mocks2.validatorClient, { model: 'v-model' })
    const human2 = new HumanController(ctx.pcRole)
    const engine2 = new GameEngine(validator2, () => {})
    engine2.restore(snap, [kp2, human2], ctx.books)

    expect(engine2.phase).toBe('await-action')
    expect(engine2.world).toEqual(ctx.engine.world)
    expect(engine2.keywords).toEqual(ctx.engine.keywords)
    expect(kpSession2.messages).toEqual(ctx.kpSession.messages)

    // resumeLoop 续跑：行动 → KP 收尾（scene_end）→ 自动翻页 → 第 2 轮
    void engine2.resumeLoop().catch(() => {})
    await waitFor(() => human2.awaitingAction)
    human2.submitText('我锁上门休息。')
    await waitFor(() => engine2.round === 2)
    expect(engine2.currentSceneNarrative).toContain('不该亮着的灯')
    expect(engine2.canRequestReroll).toBe(true)
    engine2.stop()
  })
})
