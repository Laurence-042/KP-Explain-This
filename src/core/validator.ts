import type { Verdict } from './types'
import type { ChatMessage, LLMClient } from './llm/client'
import { parseVerdictJson } from './json-out'
import { validatorRetryPrefix } from './prompts'

/**
 * 用人不疑：判定结论全部逐字采用 LLM Validator 的输出，代码不改写、不补默认值。
 * 宽松/严格的校准只发生在 prompt 层（prompts.ts 的即兴标准与判例锚点）。
 * 输出不完整（缺 valid / world_consistent / keyword_usage 未覆盖全部关键词）
 * 视为坏判定 → 重试一次，仍失败则按调用失败处理。
 */
export function asVerdict(raw: unknown, keywords: string[]): Verdict | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  if (typeof v.valid !== 'boolean') return null
  if (typeof v.world_consistent !== 'boolean') return null

  const rawUsage =
    typeof v.keyword_usage === 'object' && v.keyword_usage !== null
      ? (v.keyword_usage as Record<string, unknown>)
      : {}
  const usage: Record<string, boolean> = {}
  for (const kw of keywords) {
    // 尝试原词与大小写变体匹配
    const hit =
      findKey(rawUsage, kw) ?? findKey(rawUsage, kw.toLowerCase()) ?? findKey(rawUsage, kw.toUpperCase())
    // 模型没给结论的关键词不猜：整个判定视为不完整，交由上层重试
    if (hit === undefined || typeof rawUsage[hit] !== 'boolean') return null
    usage[kw] = rawUsage[hit]
  }

  return {
    valid: v.valid,
    keyword_usage: usage,
    world_consistent: v.world_consistent,
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

/** 判定是否放行：valid 且全部关键词已使用 且 与世界状态一致（三者都是 Validator 的结论） */
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
 * 运行一次完整验证（最多两次尝试：JSON 解析失败或判定不完整会带着错误提示重试一次）。
 * 返回 null 表示两次都拿不到完整判定（网络/模型问题交由调用方处理错误）。
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
    content: `${validatorRetryPrefix('JSON 格式错误，或 valid / world_consistent / keyword_usage 未覆盖全部玩家关键词')}\n\n${last?.content ?? ''}`,
  }
  return [...messages.slice(0, -1), retryUser]
}
