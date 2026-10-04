import type { ChatMessage, LLMClient } from './client'

/**
 * 逻辑会话：独立的 system prompt、模型参数与消息历史。
 * KP 与 Validator 各持一个 LLMSession（可共用同一个 LLMClient，
 * 也可以使用不同的 baseUrl/apiKey/model/temperature，互不影响上下文）。
 */

export type SummaryConfig = {
  autoSummary: boolean
  /** 活跃消息超过该值触发折叠 */
  summarizeAfter: number
  /** 折叠后仍保留原文的最近消息数 */
  retainMessages: number
}

export type SessionParams = {
  model: string
  temperature?: number
  maxTokens?: number
  /** 静态字符串或每次请求重建（用于携带最新 World State） */
  systemPrompt: string | (() => string)
  summary: SummaryConfig
}

export type SerializedSession = {
  params: Omit<SessionParams, 'systemPrompt'> & { systemPrompt: string }
  messages: ChatMessage[]
  summaryText: string
}

const DEFAULT_SUMMARY: SummaryConfig = {
  autoSummary: true,
  summarizeAfter: 20,
  retainMessages: 8,
}

export class LLMSession {
  /** 允许游戏进行中更换连接配置（endpoint/key 变更时由 UI 层整体替换） */
  client: LLMClient
  params: SessionParams
  /** user/assistant 历史（system 每次由 systemPrompt 动态生成，不入列） */
  messages: ChatMessage[] = []
  summaryText = ''
  summarizing = false
  private summarizeWatermark = 0

  constructor(client: LLMClient, params: Partial<SessionParams> & { model: string }) {
    this.client = client
    this.params = {
      temperature: undefined,
      maxTokens: undefined,
      ...params,
      systemPrompt: params.systemPrompt ?? '',
      summary: { ...DEFAULT_SUMMARY, ...params.summary },
    } as SessionParams
  }

  currentSystemPrompt(): string {
    const sp = this.params.systemPrompt
    const base = typeof sp === 'function' ? sp() : sp
    const parts = [base.trim()]
    if (this.summaryText) parts.push(`以下是先前剧情的摘要：\n${this.summaryText}`)
    return parts.filter(Boolean).join('\n\n')
  }

  /** 实际发送给 API 的消息（system + 未折叠消息） */
  activeRequestMessages(): ChatMessage[] {
    const system = this.currentSystemPrompt()
    const active = this.messages.filter((m) => !m.summarized)
    return system ? [{ role: 'system', content: system }, ...active] : [...active]
  }

  pushUser(content: string): void {
    this.messages.push({ role: 'user', content })
  }

  pushAssistant(content: string): void {
    this.messages.push({ role: 'assistant', content })
  }

  /** 用解析后的叙事替换最后一条 assistant 消息（历史里不保存 JSON 块，省上下文） */
  amendLastAssistant(content: string): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        this.messages[i] = { ...this.messages[i], content }
        return
      }
    }
  }

  /** 流式发送一条 user 消息并取回 assistant 回复 */
  async send(
    userContent: string,
    opts: { onChunk?: (delta: string) => void; signal?: AbortSignal; stage?: string } = {},
  ): Promise<string> {
    this.pushUser(userContent)
    const params = {
      model: this.params.model,
      messages: this.activeRequestMessages(),
      temperature: this.params.temperature,
      maxTokens: this.params.maxTokens,
    }
    const stage = opts.stage ?? 'session'
    let reply: string
    if (opts.onChunk) {
      reply = await this.client.stream(params, stage, opts.onChunk, opts.signal)
    } else {
      reply = await this.client.complete(params, stage, opts.signal)
    }
    this.pushAssistant(reply)
    void this.maybeSummarize()
    return reply
  }

  /**
   * 滚动摘要：把较早的活跃消息折叠为一段摘要（水位机制防失败循环，
   * 逻辑移植自 YA-BYOK-Chat 的 maybeSummarize）。
   */
  async maybeSummarize(): Promise<void> {
    const cfg = this.params.summary
    if (!cfg.autoSummary || this.summarizing) return
    const active = this.messages.filter((m) => !m.summarized)
    if (active.length <= cfg.summarizeAfter) return
    if (active.length - this.summarizeWatermark < cfg.summarizeAfter) return
    const foldCount = active.length - cfg.retainMessages
    if (foldCount <= 0) return
    const toFold = active.slice(0, foldCount)
    const transcript = toFold
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n')
    const previous = this.summaryText
      ? `先前的摘要：\n${this.summaryText}\n\n需要并入的新内容：\n`
      : ''
    const instruction =
      '请把下面的游戏记录压缩成一段简洁的剧情摘要（200字以内），' +
      '保留关键事实、人物、地点、物品和未解决的悬念，只输出摘要本身。'
    toFold.forEach((m) => (m.summarized = true))
    this.summarizing = true
    try {
      const reply = await this.client.complete(
        {
          model: this.params.model,
          messages: [{ role: 'user', content: `${instruction}\n\n${previous}${transcript}` }],
          temperature: this.params.temperature,
          maxTokens: this.params.maxTokens,
        },
        'summarize',
      )
      this.summaryText = reply.trim()
    } catch {
      toFold.forEach((m) => (m.summarized = false))
    } finally {
      this.summarizing = false
      this.summarizeWatermark = this.messages.filter((m) => !m.summarized).length
    }
  }

  serialize(): SerializedSession {
    return {
      params: {
        ...this.params,
        systemPrompt: this.currentStaticSystemPrompt(),
      },
      messages: this.messages,
      summaryText: this.summaryText,
    }
  }

  /** 序列化时 systemPrompt 若为函数则求值固化（恢复时作为静态串） */
  private currentStaticSystemPrompt(): string {
    const sp = this.params.systemPrompt
    return typeof sp === 'function' ? '' : sp
  }

  restore(data: SerializedSession): void {
    this.params = {
      ...this.params,
      ...data.params,
      systemPrompt: data.params.systemPrompt || this.params.systemPrompt,
      summary: { ...DEFAULT_SUMMARY, ...data.params.summary },
    }
    this.messages = data.messages.filter(
      (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    )
    this.summaryText = data.summaryText ?? ''
    this.summarizeWatermark = this.messages.filter((m) => !m.summarized).length
  }
}
