import type { Verdict } from './types'
import type { ChatMessage, LLMClient } from './llm/client'
import { parseVerdictJson } from './json-out'
import { validatorRetryPrefix } from './prompts'

/** 把未知的 JSON 值清洗成 Verdict；结构不符返回 null */
export function asVerdict(raw: unknown, keywords: string[]): Verdict | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  if (typeof v.valid !== 'boolean') return null

  const usage: Record<string, boolean> = {}
  const rawUsage =
    typeof v.keyword_usage === 'object' && v.keyword_usage !== null
      ? (v.keyword_usage as Record<string, unknown>)
      : {}
  for (const kw of keywords) {
    // 尝试原词与大小写变体匹配
    const hit =
      findKey(rawUsage, kw) ?? findKey(rawUsage, kw.toLowerCase()) ?? findKey(rawUsage, kw.toUpperCase())
    usage[kw] = hit !== undefined ? rawUsage[hit] === true : false
  }

  return {
    valid: v.valid,
    keyword_usage: usage,
    world_consistent: v.world_consistent === true,
    reason:
      typeof v.reason === 'string' && v.reason.trim()
        ? v.reason.trim()
        : v.valid
          ? '（Validator 未给出理由）'
          : '行动未通过验证',
  }
}

function findKey(map: Record<string, unknown>, key: string): string | undefined {
  if (key in map) return key
  const lower = key.toLowerCase()
  return Object.keys(map).find((k) => k.toLowerCase() === lower)
}

/** 判定是否放行：valid 且全部关键词真正使用 且 与世界状态一致 */
export function verdictPass(verdict: Verdict): boolean {
  const allUsed = Object.values(verdict.keyword_usage).every(Boolean)
  return verdict.valid && allUsed && verdict.world_consistent
}

export type ValidationRunOptions = {
  model: string
  temperature?: number
  signal?: AbortSignal
}

/**
 * 运行一次完整验证（最多两次尝试：JSON 解析失败会带着错误提示重试一次）。
 * 返回 null 表示两次都拿不到合法 JSON（网络/模型问题交由调用方处理错误）。
 */
export async function runValidation(
  client: LLMClient,
  opts: ValidationRunOptions,
  messages: ChatMessage[],
  keywords: string[],
): Promise<Verdict | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = attempt === 0 ? messages : injectRetry(messages)
    let raw: string
    try {
      raw = await client.complete(
        {
          model: opts.model,
          messages: payload,
          temperature: opts.temperature,
        },
        attempt === 0 ? 'validator' : 'validator-retry',
        opts.signal,
      )
    } catch {
      return null
    }
    const parsed = parseVerdictJson(raw)
    const verdict = asVerdict(parsed, keywords)
    if (verdict) return verdict
  }
  return null
}

function injectRetry(messages: ChatMessage[]): ChatMessage[] {
  // 在 user 消息前追加提示（不修改原始数组）
  const last = messages[messages.length - 1]
  const retryUser: ChatMessage = {
    role: 'user',
    content: `${validatorRetryPrefix('JSON 格式错误')}\n\n${last?.content ?? ''}`,
  }
  return [...messages.slice(0, -1), retryUser]
}
