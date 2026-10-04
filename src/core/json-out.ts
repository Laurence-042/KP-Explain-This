/**
 * LLM 输出容错解析。
 *
 * KP 的输出协议：markdown 叙事在前，最后附一个 ```json 围栏块（或裸 JSON 对象）
 * 携带 state_changes。Validator 只输出一个 JSON 对象。
 * 这里的策略顺序：围栏块 → 文本末尾的平衡大括号对象 → 解析失败。
 */

/** 找出文本中最后一个"顶层平衡的大括号对象"的字符区间 */
export function findLastTopLevelObject(text: string): { start: number; end: number } | null {
  let depth = 0
  let inStr = false
  let esc = false
  let spanStart = -1
  let last: { start: number; end: number } | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) spanStart = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && spanStart >= 0) {
          last = { start: spanStart, end: i + 1 }
          spanStart = -1
        }
      }
    }
  }
  return last
}

/** 轻量修复常见 JSON 毛病（尾逗号、截断未闭合），不行就返回 null */
function parseJsonLoose(jsonText: string): unknown | null {
  const trimmed = jsonText.trim()
  const fixed = trimmed.replace(/,\s*([}\]])/g, '$1')
  const attempts = [trimmed, fixed, closeTruncatedJson(fixed)]
  for (const attempt of attempts) {
    if (attempt === null) continue
    try {
      return JSON.parse(attempt)
    } catch {
      // try next
    }
  }
  // 最后再试：从修复文本中截取顶层平衡对象
  if (attempts[1] !== null) {
    const span = findLastTopLevelObject(attempts[1])
    if (span) {
      try {
        return JSON.parse(attempts[1].slice(span.start, span.end))
      } catch {
        // give up
      }
    }
  }
  return null
}

/** 截断修复：统计字符串外未闭合的括号并补上；看起来完整时返回 null */
function closeTruncatedJson(text: string): string | null {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of text) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (stack.length === 0 && !inStr) return null
  // 去掉可能悬挂的 key: / , 尾巴后再闭合
  let base = text.replace(/[,:\[]\s*$/, '')
  base = base.replace(/"[^"]*"?\s*$/, (m) => (m.endsWith('"') ? m : '""'))
  // 重新扫描（去掉尾巴后括号栈可能变化，保守起见直接追加原栈的闭括号）
  const closers = stack
    .reverse()
    .map((c) => (c === '{' ? '}' : ']'))
    .join('')
  return base + closers
}

export type ParsedKpOutput = {
  narrative: string
  /** 解析出的原始 state_changes 对象（未经清洗），null 表示没有/解析失败 */
  stateChangesRaw: unknown | null
  warnings: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 解析 KP 的完整输出：拆出叙事与尾部的 state_changes JSON。
 * 围栏标签大小写不敏感（```JSON/```json），容忍标签与内容同行、
 * 围栏内夹带说明文字——只要块内容能解析成对象即认定是状态块。
 */
export function parseKpOutput(raw: string): ParsedKpOutput {
  const warnings: string[] = []
  let narrative = raw
  let jsonText: string | null = null
  let fenceSeen = false

  // 1) 所有已闭合围栏：优先取最后一个可解析成对象的；
  //    若都不行，退而取最后一个以 { 开头的（认定其本意是状态块，只是格式损坏）
  const closedRe = /```[ \t]*(?:json\w*)?[ \t]*\r?\n?([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let lastGood: { index: number; content: string } | null = null
  let lastBrace: { index: number; content: string } | null = null
  while ((match = closedRe.exec(raw)) !== null) {
    fenceSeen = true
    if (isPlainObject(parseJsonLoose(match[1]))) {
      lastGood = { index: match.index, content: match[1] }
    } else if (match[1].trim().startsWith('{')) {
      lastBrace = { index: match.index, content: match[1] }
    }
  }
  const pickedFence = lastGood ?? lastBrace
  if (pickedFence) {
    narrative = raw.slice(0, pickedFence.index)
    jsonText = pickedFence.content
  }

  // 2) 未闭合的尾随围栏（流式中断/截断）
  if (jsonText === null) {
    const openRe = /```[ \t]*(?:json\w*)?[ \t]*\r?\n?([\s\S]*)$/i
    const open = openRe.exec(raw)
    if (open) {
      fenceSeen = true
      const parsed = parseJsonLoose(open[1])
      if (isPlainObject(parsed) || open[1].trim().startsWith('{')) {
        narrative = raw.slice(0, open.index)
        jsonText = open[1]
      }
    }
  }

  // 3) 无围栏：找文本末尾的顶层平衡对象
  if (jsonText === null) {
    const span = findLastTopLevelObject(raw)
    if (span && looksLikeChangesObject(raw.slice(span.start, span.end))) {
      narrative = raw.slice(0, span.start)
      jsonText = raw.slice(span.start, span.end)
    }
  }

  let stateChangesRaw: unknown | null = null
  if (jsonText !== null) {
    stateChangesRaw = parseJsonLoose(jsonText)
    if (stateChangesRaw === null) {
      warnings.push('KP 输出末尾的 JSON 块解析失败，state_changes 已被忽略')
    }
  } else if (fenceSeen) {
    warnings.push('KP 输出的代码块无法解析为 JSON，state_changes 已被忽略')
  } else {
    warnings.push('KP 输出中没有找到 state_changes JSON 块')
  }

  const trimmedNarrative = narrative.trim()
  if (!trimmedNarrative) {
    warnings.push('KP 输出中没有叙事文本')
  }
  return { narrative: trimmedNarrative, stateChangesRaw, warnings }
}

/** 末尾对象是否像 state_changes（含任一已知键），避免把叙事里的普通大括号当 JSON */
function looksLikeChangesObject(candidate: string): boolean {
  if (!candidate.startsWith('{')) return false
  const knownKeys = [
    'location', 'time', 'scene', 'inventory_added', 'inventory_removed',
    'npc_changes', 'player_changes', 'facts_added', 'events_added',
    'plot_variables', 'scene_end', 'state_changes',
  ]
  return knownKeys.some((k) => candidate.includes(`"${k}"`))
}

/** 解析 Validator 输出：围栏 JSON 或裸 JSON 对象；失败返回 null（调用方可重试） */
export function parseVerdictJson(raw: string): unknown | null {
  const fenced = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/.exec(raw)
  if (fenced) return parseJsonLoose(fenced[1])
  const span = findLastTopLevelObject(raw)
  if (span) return parseJsonLoose(raw.slice(span.start, span.end))
  return parseJsonLoose(raw)
}

/**
 * 流式渲染视图：截掉尾部的 JSON 围栏块，只留叙事部分。
 * 围栏一旦开始出现（```json 后跟 {，大小写不敏感），后续内容不再展示给玩家。
 */
export function narrativeViewForStream(raw: string): string {
  const m = /```[ \t]*(?:json\w*)?[ \t]*\r?\n?\s*\{/i.exec(raw)
  if (m && m.index !== undefined) {
    return raw.slice(0, m.index)
  }
  return raw
}
