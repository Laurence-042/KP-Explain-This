import type { RoleDef, WorldState } from './types'
import type { LLMSession } from './llm/session'
import { buildKpResolveUser, buildKpSceneOpening, buildKpSystemPrompt } from './prompts'

/**
 * 角色控制器统一接口（story 要求：LLM 与玩家同基类、相同接口操作）。
 * 人类玩家、LLM KP、未来的 LLM PC 与联机远程玩家都实现本接口；
 * 引擎只面向 RoleController 编排，不关心背后是谁。
 */

export type ActionRequestKind =
  /** KP：开启新场景 */
  | 'kp-scene'
  /** KP：响应已通过验证的玩家行动 */
  | 'kp-respond'
  /** PC：描述一次行动 */
  | 'pc-act'

export type ActionRequest = {
  kind: ActionRequestKind
  round: number
  /** 只读世界状态快照 */
  world: WorldState
  /** 该角色的本轮关键词 */
  keywords: string[]
  /** kp-respond：已验证行动 */
  validatedAction?: { roleName: string; text: string }
  /** kp-scene：上一场景结尾（衔接用） */
  lastNarrative?: string
  /** 流式增量回调（LLM 控制器透传） */
  onStream?: (delta: string) => void
}

export type ControllerResponse = {
  /** KP：原始完整输出（叙事 + state_changes JSON 块）；PC：行动文本 */
  text: string
}

export interface RoleController {
  readonly role: RoleDef
  /** 引擎请求一次行动；abort 通过 signal 传递（Promise 以 AbortError 拒绝） */
  requestAction(req: ActionRequest, signal: AbortSignal): Promise<ControllerResponse>
  /** 引擎协商：是否同意重骰当前场景 */
  requestRerollConsent(): Promise<boolean>
  /** 响应已被引擎采纳。appliedText：KP=剥离 JSON 后的叙事；PC=行动原文 */
  onApplied(req: ActionRequest, appliedText: string): void
  /** PC 行动被 Validator 驳回（人类控制器可刷新提示） */
  onRejected?(reason: string): void
  /** 场景级回滚点（重骰时回滚世界状态与控制器自身历史） */
  sceneCheckpoint(): unknown
  sceneRestore(cp: unknown): void
  /** 作废一切挂起中的请求（重骰/切换场景时由引擎调用或 signal 触发） */
  abort(): void
}

// ===== 人类控制器：Promise 挂起，由 UI 通过 useGame 转发 resolve =====

export type HumanControllerHooks = {
  /** 引擎开始/停止等待该玩家提交行动 */
  onAwaitAction?: (awaiting: boolean) => void
  /** 引擎发起重骰协商（未来多人时其他人类玩家的确认入口） */
  onAwaitConsent?: (awaiting: boolean) => void
  /** 行动被驳回 */
  onRejected?: (reason: string) => void
}

export class HumanController implements RoleController {
  readonly role: RoleDef
  private hooks: HumanControllerHooks
  private pending: {
    resolve: (r: ControllerResponse) => void
    reject: (e: Error) => void
    signal: AbortSignal
    onAbort: () => void
  } | null = null
  private pendingConsent: ((ok: boolean) => void) | null = null

  constructor(role: RoleDef, hooks: HumanControllerHooks = {}) {
    this.role = role
    this.hooks = hooks
  }

  requestAction(_req: ActionRequest, signal: AbortSignal): Promise<ControllerResponse> {
    this.abort()
    return new Promise<ControllerResponse>((resolve, reject) => {
      const onAbort = () => {
        const p = this.detachPending()
        p?.reject(new DOMException('aborted', 'AbortError'))
      }
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending = { resolve, reject, signal, onAbort }
      this.hooks.onAwaitAction?.(true)
    })
  }

  /** UI 提交行动文本；返回是否成功送达引擎等待中的请求 */
  submitText(text: string): boolean {
    const content = text.trim()
    const p = this.detachPending()
    if (!p || !content) return false
    p.resolve({ text: content })
    return true
  }

  requestRerollConsent(): Promise<boolean> {
    this.cancelConsent()
    return new Promise<boolean>((resolve) => {
      this.pendingConsent = (ok: boolean) => {
        this.pendingConsent = null
        this.hooks.onAwaitConsent?.(false)
        resolve(ok)
      }
      this.hooks.onAwaitConsent?.(true)
    })
  }

  /** UI 侧给出同意/拒绝（未来多人的协商弹窗入口） */
  consent(ok: boolean): void {
    this.pendingConsent?.(ok)
  }

  get awaitingAction(): boolean {
    return this.pending !== null
  }

  onApplied(): void {
    // 人类不需要历史维护；UI 通过引擎事件刷新
  }

  onRejected(reason: string): void {
    this.hooks.onRejected?.(reason)
  }

  sceneCheckpoint(): unknown {
    return null
  }

  sceneRestore(): void {
    // 人类无历史
  }

  abort(): void {
    const p = this.detachPending()
    p?.reject(new DOMException('aborted', 'AbortError'))
    this.cancelConsent()
  }

  /** 解绑（不触发）abort 监听并取回挂起的 settle 函数 */
  private detachPending(): { resolve: (r: ControllerResponse) => void; reject: (e: Error) => void } | null {
    if (!this.pending) return null
    const { resolve, reject, signal, onAbort } = this.pending
    this.pending = null
    signal.removeEventListener('abort', onAbort)
    this.hooks.onAwaitAction?.(false)
    return { resolve, reject }
  }

  private cancelConsent(): void {
    this.pendingConsent?.(false)
  }
}

// ===== LLM KP 控制器：持有独立会话，负责场景叙事 =====

export class LlmKpController implements RoleController {
  readonly role: RoleDef
  readonly session: LLMSession

  constructor(role: RoleDef, session: LLMSession) {
    this.role = role
    this.session = session
  }

  async requestAction(req: ActionRequest, signal: AbortSignal): Promise<ControllerResponse> {
    this.session.params.systemPrompt = () =>
      buildKpSystemPrompt(req.world, req.keywords, req.round)
    const userMessage =
      req.kind === 'kp-respond' && req.validatedAction
        ? buildKpResolveUser({ roleId: this.role.id, text: req.validatedAction.text }, req.validatedAction.roleName)
        : buildKpSceneOpening(req.round, req.lastNarrative)
    const text = await this.session.send(userMessage, {
      onChunk: req.onStream,
      signal,
      stage: req.kind === 'kp-respond' ? 'kp-resolve' : 'kp-scene',
    })
    return { text }
  }

  /** LLM KP 总是同意重骰（接口保留：未来可改为真问模型） */
  async requestRerollConsent(): Promise<boolean> {
    return true
  }

  onApplied(_req: ActionRequest, appliedText: string): void {
    // 引擎已完成解析与日志，历史只保留纯叙事（去掉 JSON 块，节省上下文）
    this.session.amendLastAssistant(appliedText)
  }

  sceneCheckpoint(): unknown {
    return {
      historyLength: this.session.messages.length,
      summaryText: this.session.summaryText,
    }
  }

  sceneRestore(cp: unknown): void {
    const data = cp as { historyLength?: number; summaryText?: string } | null
    if (!data || typeof data.historyLength !== 'number') return
    this.session.messages.length = Math.min(data.historyLength, this.session.messages.length)
    if (typeof data.summaryText === 'string') this.session.summaryText = data.summaryText
  }

  abort(): void {
    // 进行中的请求由引擎经 signal 中止
  }
}
