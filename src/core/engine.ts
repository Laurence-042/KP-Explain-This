import type {
  BookDocument,
  DieLanding,
  GameLogEntry,
  GamePhase,
  RoleDef,
  RoleId,
  RoundRoll,
  Verdict,
  WorldState,
} from './types'
import { createInitialWorld, applyStateChanges, sanitizeStateChanges } from './world'
import { rollInitPage, rollOnPage } from './randomizer'
import { parseKpOutput } from './json-out'
import { buildValidatorMessages } from './prompts'
import { runValidation, verdictPass } from './validator'
import type { LLMSession } from './llm/session'
import type { ActionRequest, ActionRequestKind, ControllerResponse, RoleController } from './controller'

/**
 * 游戏引擎（框架无关）：纯编排，只面向 RoleController 接口。
 * - KP 与 PC 都是 RoleController（LLM/人类/未来联机玩家同基类）
 * - Validator 是系统裁判（不是游戏角色），经 validatorSession 提供服务
 * - 场景只能由 KP 的 state_changes.scene_end 自然收尾（自动翻页进入下一轮）；
 *   玩家侧唯一的主动操作是发起重骰，需要全体角色同意（LLM KP 默认同意）
 */

export type EngineEvent =
  | { type: 'phase'; phase: GamePhase }
  | { type: 'log'; entry: GameLogEntry }
  | { type: 'init-roll'; roleId: RoleId; dice: number[]; landings: DieLanding[]; pageIndex: number }
  | { type: 'roll'; roleId: RoleId; round: number; roll: RoundRoll }
  | { type: 'flip'; roleId: RoleId; pageIndex: number; nextPage: boolean }
  | { type: 'kp-stream'; delta: string }
  | { type: 'kp-narrative'; narrative: string; opening: boolean }
  | { type: 'validator-done'; verdict: Verdict; pass: boolean }
  | { type: 'pc-acting'; roleId: RoleId; roleName: string; active: boolean }
  | { type: 'error'; message: string; stage: string }
  | { type: 'mutated' }

export type EngineSnapshot = {
  roles: RoleDef[]
  diceCount: number
  round: number
  phase: GamePhase
  pages: Record<RoleId, number>
  pendingNextPages: Record<RoleId, number>
  rolls: Record<RoleId, RoundRoll | null>
  keywords: Record<RoleId, string[]>
  world: WorldState
  log: GameLogEntry[]
  currentSceneNarrative: string
  sceneEndHint: boolean
}

type RoundCheckpoint = {
  world: WorldState
  logLength: number
  narrative: string
  controllerCheckpoints: unknown[]
}

type ValidatedAction = { roleId: RoleId; roleName: string; text: string }

type SceneResult = 'ended' | 'rerolled' | 'stopped'

/** 分发型 Omit：让 GameLogEntry 判别联合的每个变体各自去掉 id */
type DistributiveOmit<T, K extends string | number | symbol> = T extends unknown ? Omit<T, K> : never
type NewLogEntry = DistributiveOmit<GameLogEntry, 'id'>

const INTERRUPTIBLE_PHASES: ReadonlySet<GamePhase> = new Set([
  'kp-scene',
  'kp-resolve',
  'interrupted',
])

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class GameEngine {
  private emit: (event: EngineEvent) => void
  /** Validator 会话（client/params 由 UI 层随配置更新） */
  validatorSession: LLMSession

  controllers: RoleController[] = []
  diceCount = 3
  round = 0
  phase: GamePhase = 'setup'
  pages: Record<RoleId, number> = {}
  pendingNextPages: Record<RoleId, number> = {}
  rolls: Record<RoleId, RoundRoll | null> = {}
  keywords: Record<RoleId, string[]> = {}
  world: WorldState = createInitialWorld([])
  log: GameLogEntry[] = []
  currentSceneNarrative = ''
  sceneEndHint = false

  private books: Record<string, BookDocument> = {}
  private entrySeq = 0
  private abortController: AbortController | null = null
  private busy = false
  private stopped = false
  /** 本轮重骰回滚点 */
  private checkpoint: RoundCheckpoint | null = null
  /** 全体同意的重骰意图（由循环在各中断点兑现） */
  private rerollApproved = false
  /** interrupted 状态下 UI 的决定通道 */
  private resume: (() => void) | null = null
  private sceneEnded = false

  constructor(validatorSession: LLMSession, emit: (event: EngineEvent) => void) {
    this.validatorSession = validatorSession
    this.emit = emit
  }

  // ===== 查询 =====

  get kpController(): RoleController | undefined {
    return this.controllers.find((c) => c.role.kind === 'kp')
  }

  get pcControllers(): RoleController[] {
    return this.controllers.filter((c) => c.role.kind === 'pc')
  }

  get running(): boolean {
    return this.busy
  }

  get interrupted(): boolean {
    return this.phase === 'interrupted'
  }

  /** 当前是否可以发起重骰（等待玩家行动，或生成中断等待决定） */
  get canRequestReroll(): boolean {
    return this.phase === 'await-action' || this.phase === 'interrupted'
  }

  controllerOf(roleId: RoleId): RoleController | undefined {
    return this.controllers.find((c) => c.role.id === roleId)
  }

  bookOf(role: RoleDef): BookDocument {
    const book = this.books[role.bookId]
    if (!book) throw new Error(`role ${role.id} 的书籍 (${role.bookId}) 尚未载入`)
    return book
  }

  // ===== 开局 =====

  async start(
    controllers: RoleController[],
    validatorSession: LLMSession,
    books: Record<string, BookDocument>,
    diceCount: number,
  ): Promise<void> {
    if (this.busy) return
    this.stopped = false
    this.controllers = controllers
    this.validatorSession = validatorSession
    this.books = books
    this.diceCount = diceCount
    this.round = 0
    this.log = []
    this.keywords = {}
    this.rolls = {}
    this.currentSceneNarrative = ''
    this.sceneEndHint = false
    this.rerollApproved = false
    this.world = createInitialWorld(
      controllers.filter((c) => c.role.kind === 'pc').map((c) => ({ id: c.role.id, name: c.role.name })),
    )
    this.setPhase('init-roll')

    for (const c of controllers) {
      const book = this.bookOf(c.role)
      const init = rollInitPage(book, diceCount)
      this.pages[c.role.id] = init.pageIndex
      this.pendingNextPages[c.role.id] = init.pageIndex
      this.emit({ type: 'init-roll', roleId: c.role.id, dice: init.dice, landings: init.landings, pageIndex: init.pageIndex })
    }
    this.addLog({ type: 'system', text: '合书初掷完成，各角色翻开初始页。', round: 0 })

    this.round = 1
    await this.mainLoop(true)
  }

  /**
   * 存档恢复后继续游戏：不重新掷骰/开场，直接从行动收集阶段续跑主循环。
   */
  async resumeLoop(): Promise<void> {
    if (this.busy) return
    this.stopped = false
    await this.mainLoop(false)
  }

  stop(): void {
    this.stopped = true
    this.abortCurrent()
    this.controllers.forEach((c) => c.abort())
    this.resume?.()
  }

  // ===== 主循环 =====

  /**
   * 主循环：掷轮 → 场景开场 → 行动循环 → 自然收尾翻页 → 下一轮。
   * startWithRoll=false 用于存档恢复（跳过本轮掷骰与开场，直接续行动循环）。
   * 重骰 = 回滚并跳过本轮（doReroll 翻到骰面指示页）→ 新页重掷 → 新开场。
   */
  private async mainLoop(startWithRoll: boolean): Promise<void> {
    while (!this.stopped) {
      if (startWithRoll) {
        await this.rollRound()
        const opening = await this.stepWithRetry(() => this.kpAct('kp-scene'))
        if (opening === 'rerolled') {
          this.doReroll()
          continue
        }
        if (this.stopped) return
      }
      startWithRoll = true
      const result = await this.playSceneActions()
      if (result === 'rerolled') {
        this.doReroll()
        continue
      }
      if (this.stopped) return
      await this.finishScene()
    }
  }

  /** 已有场景的行动循环：逐 PC 收集行动 → 验证 → KP 推进，直到自然收尾/重骰/停止 */
  private async playSceneActions(): Promise<SceneResult> {
    while (!this.sceneEnded && !this.stopped && !this.rerollApproved) {
      let progressed = false
      for (const pc of this.pcControllers) {
        const validated = await this.collectValidatedAction(pc)
        if (validated === null) break // 中断（重骰/停止）
        const st = await this.stepWithRetry(() => this.kpAct('kp-respond', validated))
        if (st === 'rerolled') return 'rerolled'
        progressed = true
        if (this.sceneEnded || this.stopped) break
      }
      if (this.stopped || this.rerollApproved) break
      // 行动收集被中止但既非重骰也非停止：视为挂起，不能误当场景收尾
      if (!progressed && !this.sceneEnded) return 'stopped'
    }
    if (this.stopped) return 'stopped'
    if (this.rerollApproved) return 'rerolled'
    return 'ended'
  }

  /** 掷出本轮骰子并建立重骰回滚点 */
  private async rollRound(): Promise<void> {
    this.world.round = this.round
    this.sceneEndHint = false
    this.sceneEnded = false
    this.checkpoint = {
      world: clone(this.world),
      logLength: this.log.length,
      narrative: this.currentSceneNarrative,
      controllerCheckpoints: this.controllers.map((c) => c.sceneCheckpoint()),
    }
    this.setPhase('rolling')
    for (const c of this.controllers) {
      const book = this.bookOf(c.role)
      const roll = rollOnPage(book, this.pages[c.role.id], this.diceCount)
      this.rolls[c.role.id] = roll
      this.keywords[c.role.id] = roll.picks.map((p) => p.keyword)
      this.pendingNextPages[c.role.id] = roll.nextPageIndex
      this.emit({ type: 'roll', roleId: c.role.id, round: this.round, roll })
    }
    this.addLog({ type: 'round', round: this.round })
    this.emit({ type: 'mutated' })
  }

  /** 执行一次 KP 行动；返回 applied / aborted，不抛异常 */
  private async kpAct(kind: ActionRequestKind, validatedAction?: ValidatedAction): Promise<'applied' | 'aborted'> {
    const kp = this.kpController
    if (!kp) return 'aborted'
    this.setPhase(kind === 'kp-respond' ? 'kp-resolve' : 'kp-scene')
    this.abortController = new AbortController()
    const req: ActionRequest = {
      kind,
      round: this.round,
      world: this.world,
      keywords: this.keywords[kp.role.id] ?? [],
      validatedAction,
      lastNarrative: kind === 'kp-scene' ? this.currentSceneNarrative || undefined : undefined,
      onStream: (delta) => this.emit({ type: 'kp-stream', delta }),
    }
    this.busy = true
    let resp: ControllerResponse
    try {
      resp = await kp.requestAction(req, this.abortController.signal)
    } catch (err) {
      this.busy = false
      this.abortController = null
      if (this.rerollApproved || this.stopped) return 'aborted'
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        this.emit({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          stage: kind === 'kp-respond' ? 'kp-resolve' : 'kp-scene',
        })
      }
      // 用户中止/失败：弹出一条悬挂的 user 消息避免历史错位（KP 控制器重试前会重发）
      this.trimDanglingKpUser()
      this.setPhase('interrupted')
      this.emit({ type: 'mutated' })
      return 'aborted'
    }
    this.busy = false
    this.abortController = null

    const parsed = parseKpOutput(resp.text)
    const actingRoleId = validatedAction?.roleId ?? ''
    const playerIds = Object.keys(this.world.players)
    const shorthandRoleId = actingRoleId || (playerIds.length === 1 ? playerIds[0] : '')
    const { changes, warnings } = sanitizeStateChanges(
      parsed.stateChangesRaw,
      shorthandRoleId ? { players: this.world.players, actingRoleId: shorthandRoleId } : undefined,
    )
    for (const w of parsed.warnings) this.addLog({ type: 'warning', round: this.round, text: `KP 输出解析：${w}` })
    const applyResult = applyStateChanges(this.world, changes, shorthandRoleId)
    for (const w of warnings) this.addLog({ type: 'warning', round: this.round, text: `state_changes 清洗：${w}` })
    for (const w of applyResult.warnings) this.addLog({ type: 'warning', round: this.round, text: w })

    this.currentSceneNarrative = parsed.narrative
    this.addLog({ type: 'scene', round: this.round, opening: kind === 'kp-scene', narrative: parsed.narrative })
    kp.onApplied(req, parsed.narrative)

    if (applyResult.sceneEnd) {
      this.sceneEndHint = true
      this.sceneEnded = true
    }
    this.emit({ type: 'kp-narrative', narrative: parsed.narrative, opening: kind === 'kp-scene' })
    this.setPhase('await-action')
    this.emit({ type: 'mutated' })
    return 'applied'
  }

  /** 失败/中止后挂起，等待 UI 决定（重试 / 重骰），返回 'rerolled' 表示场景已重骰 */
  private stepWithRetry(fn: () => Promise<'applied' | 'aborted'>): Promise<'applied' | 'rerolled'> {
    return new Promise((resolve) => {
      const attempt = async () => {
        while (!this.stopped) {
          if (this.rerollApproved) {
            resolve('rerolled')
            return
          }
          const r = await fn()
          if (r === 'applied') {
            resolve('applied')
            return
          }
          if (this.rerollApproved || this.stopped) {
            resolve('rerolled')
            return
          }
          // interrupted：等待 UI 的重试决定（重骰走 requestReroll 入口）
          await this.waitForRetry()
        }
        resolve('rerolled')
      }
      void attempt()
    })
  }

  private waitForRetry(): Promise<void> {
    return new Promise((resolve) => {
      this.resume = () => {
        this.resume = null
        resolve()
      }
    })
  }

  /** interrupted 状态下的"重试生成"入口（UI 调用）。悬挂消息已在失败时弹出，这里直接重发 */
  retryInterrupted(): void {
    if (this.phase !== 'interrupted') return
    this.resume?.()
  }

  /** 中止当前生成（UI 的"中止"按钮） */
  abort(): void {
    if (INTERRUPTIBLE_PHASES.has(this.phase)) this.abortCurrent()
  }

  private abortCurrent(): void {
    this.abortController?.abort()
  }

  /** KP 会话末尾悬挂的 user 消息（发送后未得到 assistant 回复）弹出，保证历史整齐 */
  private trimDanglingKpUser(): void {
    const kp = this.kpController as { session?: { messages: Array<{ role: string }> } } | undefined
    const messages = kp?.session?.messages
    if (messages && messages.length > 0 && messages[messages.length - 1].role === 'user') {
      messages.pop()
    }
  }

  // ===== 玩家行动收集与验证 =====

  private async collectValidatedAction(pc: RoleController): Promise<ValidatedAction | null> {
    /** LLM PC 的连续失败计数（空回复或被驳回），达到上限暂停等待 UI 决定 */
    let llmFailures = 0
    const isLlmPc = pc.role.kind === 'pc' && pc.role.controller === 'llm'
    while (!this.stopped && !this.rerollApproved) {
      this.setPhase('await-action')
      this.abortController = new AbortController()
      const req: ActionRequest = {
        kind: 'pc-act',
        round: this.round,
        world: this.world,
        keywords: this.keywords[pc.role.id] ?? [],
        sceneNarrative: this.currentSceneNarrative,
      }
      let resp: ControllerResponse
      this.emitPcActing(pc, true)
      try {
        resp = await pc.requestAction(req, this.abortController.signal)
      } catch (err) {
        this.abortController = null
        this.emitPcActing(pc, false)
        if (this.rerollApproved || this.stopped) return null
        if (err instanceof DOMException && err.name === 'AbortError') return null // 中止（重骰/停止）
        // LLM PC 生成失败：与 KP 失败同路的 interrupted 恢复（否则异常会被当中止静默吞掉）
        this.emit({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          stage: 'pc-act',
        })
        this.setPhase('interrupted')
        this.emit({ type: 'mutated' })
        await this.waitForRetry()
        continue
      }
      this.emitPcActing(pc, false)
      this.abortController = null
      const text = resp.text.trim()
      if (!text) {
        if (isLlmPc) llmFailures += 1
        if (await this.pauseIfLlmExhausted(pc, llmFailures)) llmFailures = 0
        continue
      }

      this.addLog({ type: 'action', round: this.round, roleId: pc.role.id, roleName: pc.role.name, text })
      pc.onApplied(req, text)

      this.setPhase('validating')
      const messages = buildValidatorMessages(this.world, this.currentSceneNarrative, this.keywords[pc.role.id] ?? [], {
        roleId: pc.role.id,
        text,
      })
      let verdict: Verdict | null = null
      try {
        verdict = await runValidation(
          this.validatorSession.client,
          {
            model: this.validatorSession.params.model,
            temperature: this.validatorSession.params.temperature,
          },
          messages,
          this.keywords[pc.role.id] ?? [],
        )
      } catch {
        verdict = null
      }
      if (!verdict) {
        this.addLog({ type: 'warning', round: this.round, text: 'Validator 调用失败，本次行动未被接受，请稍后重试。' })
        this.emit({ type: 'error', message: 'Validator 调用失败', stage: 'validator' })
        continue
      }
      const pass = verdictPass(verdict)
      this.addLog({
        type: 'verdict',
        round: this.round,
        ok: pass,
        reason: verdict.reason,
        keywordUsage: verdict.keyword_usage,
        worldConsistent: verdict.world_consistent,
      })
      this.emit({ type: 'validator-done', verdict, pass })
      this.emit({ type: 'mutated' })
      if (!pass) {
        pc.onRejected?.(verdict.reason)
        if (isLlmPc) {
          llmFailures += 1
          if (await this.pauseIfLlmExhausted(pc, llmFailures)) llmFailures = 0
        }
        continue
      }
      return { roleId: pc.role.id, roleName: pc.role.name, text }
    }
    return null
  }

  /** LLM PC 连续 3 次（空回复/被驳回）后暂停为 interrupted，等待 UI 重试或重骰；返回是否触发了暂停 */
  private async pauseIfLlmExhausted(pc: RoleController, failures: number): Promise<boolean> {
    if (failures < 3) return false
    this.addLog({
      type: 'warning',
      round: this.round,
      text: `${pc.role.name} 的行动连续 ${failures} 次未通过，已暂停：可重试生成或重骰本场景。`,
    })
    this.setPhase('interrupted')
    this.emit({ type: 'mutated' })
    await this.waitForRetry()
    return true
  }

  /** LLM PC 生成期间发事件（UI 显示「正在行动」并禁用本地输入） */
  private emitPcActing(pc: RoleController, active: boolean): void {
    if (pc.role.kind !== 'pc' || pc.role.controller !== 'llm') return
    this.emit({ type: 'pc-acting', roleId: pc.role.id, roleName: pc.role.name, active })
  }

  // ===== 重骰（全体同意） =====

  /**
   * 请求重骰当前场景。发起者（人类 PC）的同意由 UI 动作表达；
   * 其余角色（KP / 未来其他 PC）由引擎逐个协商。返回是否达成。
   */
  async requestReroll(initiatorId: RoleId): Promise<boolean> {
    if (!this.canRequestReroll || this.rerollApproved) return false
    const others = this.controllers.filter((c) => c.role.id !== initiatorId)
    const consents = await Promise.all(
      others.map((c) => c.requestRerollConsent().catch(() => false)),
    )
    if (this.stopped) return false
    if (!consents.every(Boolean)) {
      this.addLog({ type: 'system', round: this.round, text: '重骰未获全体同意，当前场景继续。' })
      this.emit({ type: 'mutated' })
      return false
    }
    this.rerollApproved = true
    this.setPhase('reroll')
    // 打断进行中的等待，让主循环兑现重骰：
    // - interrupted：唤醒挂在 waitForRetry 的重试循环
    // - 进行中的 LLM 生成：signal 中止
    // - 挂起的人类行动请求：controller.abort() 拒绝
    if (this.resume) {
      const r = this.resume
      this.resume = null
      r()
    }
    this.abortCurrent()
    this.controllers.forEach((c) => c.abort())
    this.emit({ type: 'mutated' })
    return true
  }

  /**
   * 兑现全体同意的重骰：回滚到本轮开始，然后**跳过本轮**——
   * 翻到本轮骰面组合指示的页（pendingNextPages），主循环随后在新页重掷取词。
   */
  private doReroll(): void {
    const cp = this.checkpoint
    if (cp) {
      this.world = cp.world
      this.log.length = cp.logLength
      this.currentSceneNarrative = cp.narrative
      this.controllers.forEach((c, i) => c.sceneRestore(cp.controllerCheckpoints[i]))
    }
    this.sceneEndHint = false
    this.sceneEnded = false
    this.rerollApproved = false
    this.resume = null
    for (const c of this.controllers) {
      const next = this.pendingNextPages[c.role.id]
      const prev = this.pages[c.role.id]
      this.pages[c.role.id] = next
      this.emit({ type: 'flip', roleId: c.role.id, pageIndex: next, nextPage: next !== prev })
    }
    this.addLog({
      type: 'system',
      round: this.round,
      text: `全体同意重骰：跳过第 ${this.round} 轮场景，翻到骰面指示的页后重掷。`,
    })
    this.round += 1
    this.emit({ type: 'mutated' })
  }

  // ===== 场景收尾 / 翻页 =====

  private async finishScene(): Promise<void> {
    this.setPhase('scene-end')
    for (const c of this.controllers) {
      const next = this.pendingNextPages[c.role.id]
      const prev = this.pages[c.role.id]
      this.pages[c.role.id] = next
      this.emit({ type: 'flip', roleId: c.role.id, pageIndex: next, nextPage: next !== prev })
    }
    this.addLog({ type: 'system', round: this.round, text: `第 ${this.round} 轮场景结束，翻到新的一页。` })
    this.round += 1
    this.emit({ type: 'mutated' })
  }

  // ===== 快照 / 恢复 =====

  snapshot(): EngineSnapshot {
    return {
      roles: this.controllers.map((c) => c.role),
      diceCount: this.diceCount,
      round: this.round,
      phase: this.phase,
      pages: { ...this.pages },
      pendingNextPages: { ...this.pendingNextPages },
      rolls: clone(this.rolls),
      keywords: clone(this.keywords),
      world: clone(this.world),
      log: this.log,
      currentSceneNarrative: this.currentSceneNarrative,
      sceneEndHint: this.sceneEndHint,
    }
  }

  /**
   * 从快照恢复。进行中的 busy phase 一律回到 await-action（快照都在稳定点生成）。
   * controllers 与 books 由调用方先行重建并注入。
   */
  restore(snap: EngineSnapshot, controllers: RoleController[], books: Record<string, BookDocument>): void {
    this.controllers = controllers
    this.books = books
    this.diceCount = snap.diceCount
    this.round = snap.round
    this.pages = snap.pages
    this.pendingNextPages = snap.pendingNextPages
    this.rolls = snap.rolls
    this.keywords = snap.keywords
    this.world = snap.world
    this.log = snap.log
    this.currentSceneNarrative = snap.currentSceneNarrative
    this.sceneEndHint = snap.sceneEndHint
    this.entrySeq = snap.log.length
    this.stopped = false
    this.busy = false
    this.rerollApproved = false
    this.sceneEnded = false
    this.resume = null
    this.phase = this.normalizeRestorePhase(snap.phase)
    // 恢复后仍允许对本轮重骰：用当前状态重建回滚点
    this.checkpoint = {
      world: clone(this.world),
      logLength: this.log.length,
      narrative: this.currentSceneNarrative,
      controllerCheckpoints: this.controllers.map((c) => c.sceneCheckpoint()),
    }
    this.emit({ type: 'mutated' })
  }

  private normalizeRestorePhase(phase: GamePhase): GamePhase {
    if (phase === 'await-action' || phase === 'interrupted') return phase
    return 'await-action'
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase
    this.emit({ type: 'phase', phase })
  }

  private addLog(entry: NewLogEntry): void {
    this.entrySeq += 1
    const full = { id: `e${this.entrySeq}`, ...entry } as GameLogEntry
    this.log.push(full)
    this.emit({ type: 'log', entry: full })
  }
}
