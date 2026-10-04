import type { EngineSnapshot } from './engine'
import type { SerializedSession } from './llm/session'

/**
 * 游戏存档（SaveFile v1）。
 * - localStorage 自动存档：books 只带元信息（不含 text，正文在 IndexedDB）。
 * - 导出 JSON 文件：books 内嵌 text，单文件自包含，导入即恢复。
 */

export const SAVE_APP = 'kp-explain-this'
export const SAVE_VERSION = 1

export type BookMeta = {
  id: string
  name: string
  source: 'txt' | 'pdf'
  /** TXT 虚拟分页的每页词数；PDF 为 0 */
  pageWordCount: number
  /** TXT 原文（导出文件携带；自动存档省略，正文在 IndexedDB） */
  text?: string
  /** PDF 各页抽取文本 */
  pageTexts?: string[]
}

export type SaveFileV1 = {
  app: typeof SAVE_APP
  version: typeof SAVE_VERSION
  savedAt: string
  /** 对局名（默认取 KP 书名） */
  name: string
  engine: EngineSnapshot
  kpSession: SerializedSession
  /** Validator 无历史，只保存参数 */
  validatorSession: SerializedSession
  books: BookMeta[]
}

export function buildSave(
  name: string,
  engine: EngineSnapshot,
  kpSession: SerializedSession,
  validatorSession: SerializedSession,
  books: BookMeta[],
): SaveFileV1 {
  return {
    app: SAVE_APP,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    name,
    engine,
    kpSession,
    validatorSession,
    books,
  }
}

export function encodeSaveFile(save: SaveFileV1): string {
  return JSON.stringify(save, null, 2)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isValidSave(v: unknown): v is SaveFileV1 {
  if (!isObject(v)) return false
  if (v.app !== SAVE_APP || v.version !== SAVE_VERSION) return false
  if (typeof v.name !== 'string') return false
  const engine = v.engine
  if (!isObject(engine)) return false
  if (!Array.isArray(engine.roles) || engine.roles.length === 0) return false
  if (!isObject(engine.world) || !Array.isArray(engine.log)) return false
  if (typeof engine.round !== 'number' || typeof engine.diceCount !== 'number') return false
  for (const key of ['kpSession', 'validatorSession'] as const) {
    const s = v[key]
    if (!isObject(s) || !isObject(s.params) || typeof s.params.model !== 'string') return false
    if (!Array.isArray(s.messages)) return false
  }
  if (!Array.isArray(v.books) || v.books.length === 0) return false
  for (const b of v.books) {
    if (!isObject(b) || typeof b.id !== 'string' || typeof b.name !== 'string') return false
    if (typeof b.pageWordCount !== 'number') return false
    if (b.source !== 'txt' && b.source !== 'pdf') return false
  }
  return true
}

export function decodeSaveFile(raw: string): SaveFileV1 | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValidSave(parsed) ? parsed : null
  } catch {
    return null
  }
}
