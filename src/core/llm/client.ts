/**
 * LLM 传输层：OpenAI 兼容 chat/completions。
 * 一个 LLMClient 对应一组 baseUrl+apiKey，可被多个 LLMSession 共用。
 * 支持流式（SSE 手工解析）与非流式调用、AbortController、诊断信息脱敏。
 * 传输逻辑自 YA-BYOK-Chat 的 useChat.ts 抽取，浏览器/Node 均可运行。
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
  /** 已被滚动摘要折叠的消息不再发送给 API */
  summarized?: boolean
}

export type ChatParams = {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export type LlmDiagnostics = {
  time: string
  stage: string
  endpoint: string
  model: string
  status?: number
  statusText?: string
  bodyExcerpt?: string
  errorMessage?: string
  userAgent: string
}

function normalizeBase(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : trimmed + '/'
}

export class LLMClient {
  readonly baseUrl: string
  readonly apiKey: string
  private _diagnostics: LlmDiagnostics | null = null

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = normalizeBase(baseUrl)
    this.apiKey = apiKey.trim()
  }

  get ready(): boolean {
    return Boolean(this.baseUrl && this.apiKey)
  }

  get diagnostics(): LlmDiagnostics | null {
    return this._diagnostics
  }

  chatUrl(): string {
    return this.baseUrl + 'chat/completions'
  }

  modelsUrl(): string {
    return this.baseUrl + 'models'
  }

  authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + this.apiKey,
    }
  }

  private redact(text: string): string {
    if (!text) return text
    const trimmed = text.length > 600 ? text.slice(0, 600) + '…' : text
    if (!this.apiKey) return trimmed
    return trimmed.split(this.apiKey).join('***')
  }

  private record(stage: string, params: Pick<ChatParams, 'model'>, partial: Omit<LlmDiagnostics, 'time' | 'userAgent' | 'endpoint' | 'model' | 'stage'>): void {
    this._diagnostics = {
      time: new Date().toISOString(),
      endpoint: this.baseUrl || '(empty)',
      model: params.model || '(empty)',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      ...partial,
      stage,
    }
  }

  /** 拉取模型列表（设置面板用） */
  async listModels(): Promise<string[]> {
    if (!this.ready) throw new Error('LLM client not configured')
    const response = await fetch(this.modelsUrl(), { headers: this.authHeaders() })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const ids = (data?.data ?? [])
      .map((m) => (typeof m?.id === 'string' ? m.id : ''))
      .filter(Boolean)
    return ids.sort((a, b) => a.localeCompare(b))
  }

  /** 非流式补全（Validator / 摘要用），返回完整文本 */
  async complete(params: ChatParams, stage: string, signal?: AbortSignal): Promise<string> {
    const body = buildRequestBody(params, false)
    let response: Response
    try {
      response = await fetch(this.chatUrl(), {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      this.record(stage, params, { errorMessage: err instanceof Error ? err.message : String(err) })
      throw err
    }
    if (!response.ok) {
      let bodyText = ''
      try {
        bodyText = await response.text()
      } catch {
        // ignore
      }
      this.record(stage, params, {
        status: response.status,
        statusText: response.statusText,
        bodyExcerpt: this.redact(bodyText),
      })
      throw new Error(`HTTP ${response.status}`)
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content) {
      this.record(stage, params, { errorMessage: 'empty response' })
      throw new Error('empty response')
    }
    return content
  }

  /** 流式补全（KP 叙事用），逐 delta 回调，返回完整文本 */
  async stream(
    params: ChatParams,
    stage: string,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const body = buildRequestBody(params, true)
    let response: Response
    try {
      response = await fetch(this.chatUrl(), {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      this.record(stage, params, { errorMessage: err instanceof Error ? err.message : String(err) })
      throw err
    }
    if (!response.ok) {
      let bodyText = ''
      try {
        bodyText = await response.text()
      } catch {
        // ignore
      }
      this.record(stage, params, {
        status: response.status,
        statusText: response.statusText,
        bodyExcerpt: this.redact(bodyText),
      })
      throw new Error(`HTTP ${response.status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) {
      this.record(stage, params, { errorMessage: 'no response body' })
      throw new Error('no response body')
    }
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue
          try {
            const json = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{ delta?: { content?: unknown } }>
            }
            const delta = json?.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) {
              fullContent += delta
              onChunk(delta)
            }
          } catch {
            // 忽略无法解析的 SSE 行
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
    if (!fullContent) {
      this.record(stage, params, { errorMessage: 'empty streaming response' })
      throw new Error('empty response')
    }
    return fullContent
  }
}

function buildRequestBody(params: ChatParams, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
  }
  if (params.temperature !== undefined && params.temperature !== null) {
    body.temperature = params.temperature
  }
  if (params.maxTokens !== undefined && params.maxTokens !== null && params.maxTokens > 0) {
    body.max_tokens = params.maxTokens
  }
  return body
}
