import type { BookDocument, BookPage, KeywordPick } from './types'
import { DEFAULT_PAGE_WORDS, MIN_VALID_PAGE_WORDS, MAX_BOOK_CHARS } from './constants'
import { tokenize, isValidKeywordWord, normalizeKeyword } from './tokenizer'

/**
 * 页导向的书籍解析：
 * - TXT：全篇分词后按每页词数虚拟分页，页文本为原文切片，词偏移平移为页内偏移。
 * - PDF：每页独立分词（真实页），无字页保留（占页数，翻页时被 nearestValidPage 跳过）。
 * 骰子取词允许跨页向后兜底（页内有效词不足时），因此词的全局序 = 各页词顺序拼接。
 */

export function pageCount(doc: BookDocument): number {
  return doc.pages.length
}

/** 全书词总数（跨页扫描用） */
export function globalWordCount(doc: BookDocument): number {
  let n = 0
  for (const p of doc.pages) n += p.words.length
  return n
}

/** 全局词索引 → (页索引, 页内词索引) */
export function locateWord(doc: BookDocument, globalIndex: number): { pageIndex: number; wordIndex: number } {
  let remaining = globalIndex
  for (let i = 0; i < doc.pages.length; i++) {
    const len = doc.pages[i].words.length
    if (remaining < len) return { pageIndex: i, wordIndex: remaining }
    remaining -= len
  }
  const lastPage = doc.pages[doc.pages.length - 1]
  return {
    pageIndex: Math.max(0, doc.pages.length - 1),
    wordIndex: Math.max(0, (lastPage?.words.length ?? 1) - 1),
  }
}

/** (页索引, 页内词索引) → 全局词索引 */
export function globalIndexOf(doc: BookDocument, pageIndex: number, wordIndex: number): number {
  let n = 0
  for (let i = 0; i < pageIndex && i < doc.pages.length; i++) n += doc.pages[i].words.length
  return n + wordIndex
}

/** 解析 TXT：规范化换行 → 分词 → 虚拟分页（每页 pageWordCount 个词） */
export function parseTxt(
  id: string,
  name: string,
  rawText: string,
  pageWordCount: number = DEFAULT_PAGE_WORDS,
): BookDocument {
  const text = rawText.replace(/\r\n?/g, '\n')
  if (!text.trim()) throw new Error('book content is empty')
  if (text.length > MAX_BOOK_CHARS) {
    throw new Error(`book too large: ${text.length} chars (max ${MAX_BOOK_CHARS})`)
  }
  const wordsPerPage = Math.max(1, Math.floor(pageWordCount))
  const tokens = tokenize(text)
  if (tokens.length === 0) throw new Error('book has no words')

  const pages: BookPage[] = []
  for (let start = 0; start < tokens.length; start += wordsPerPage) {
    const chunk = tokens.slice(start, start + wordsPerPage)
    const pageStartOffset = chunk[0].offset
    const last = chunk[chunk.length - 1]
    const pageText = text.slice(pageStartOffset, last.offset + last.word.length)
    pages.push({
      text: pageText,
      words: chunk.map((t) => ({ word: t.word, offset: t.offset - pageStartOffset })),
      valid: chunk.map((t) => isValidKeywordWord(t.word)),
    })
  }
  return { id, name, source: 'txt', pageWordCount: wordsPerPage, pages }
}

/** 解析 PDF：pageTexts 为 pdfjs 逐页抽取的文本（纯函数，core 不依赖 pdfjs） */
export function parsePdfPages(id: string, name: string, pageTexts: string[]): BookDocument {
  if (pageTexts.length === 0) throw new Error('pdf has no pages')
  const pages: BookPage[] = pageTexts.map((raw) => {
    const text = raw.replace(/\r\n?/g, '\n')
    const tokens = tokenize(text)
    return {
      text,
      words: tokens.map((t) => ({ word: t.word, offset: t.offset })),
      valid: tokens.map((t) => isValidKeywordWord(t.word)),
    }
  })
  return { id, name, source: 'pdf', pageWordCount: 0, pages }
}

/** "有足够文字的页"判定：页内词数下限（无字/图片页会被翻页逻辑跳过） */
export function isPageValid(doc: BookDocument, pageIndex: number): boolean {
  const page = doc.pages[pageIndex]
  return Boolean(page && page.words.length >= MIN_VALID_PAGE_WORDS)
}

/** 就近找有效页（先近者、同距取向前），全无效时原样返回 */
export function nearestValidPage(doc: BookDocument, pageIndex: number): number {
  const total = pageCount(doc)
  const target = Math.min(Math.max(pageIndex, 0), total - 1)
  if (isPageValid(doc, target)) return target
  for (let d = 1; d < total; d++) {
    const back = target - d
    if (back >= 0 && isPageValid(doc, back)) return back
    const fwd = target + d
    if (fwd < total && isPageValid(doc, fwd)) return fwd
  }
  return target
}

export function pageText(doc: BookDocument, pageIndex: number): string {
  return doc.pages[pageIndex]?.text ?? ''
}

/**
 * 骰面 → 页内词位映射：每个骰子把页面分成 10 档，
 * die 落在 (die%10)/10 档的起点（与页码位约定一致：面 10 = 第 0 档），
 * 再偏移骰子序号避免同点数挤在同一位置。
 */
export function dieToWordIndex(pageLen: number, dieValue: number, dieIndex: number): number {
  if (pageLen <= 0) return 0
  const pos = Math.floor(((dieValue % 10) / 10) * pageLen) + dieIndex
  return Math.min(pageLen - 1, Math.max(0, pos))
}

/**
 * 在掷骰页取关键词：从骰子落点开始按全书全局序向后找第一个
 * "有效且未用过"的词（页内不足自动越页），书尾回绕书首；
 * 全书有效词耗尽则放宽去重约束，仍无则退化为落点词。
 */
export function pickKeywordOnPage(
  doc: BookDocument,
  pageIndex: number,
  dieValue: number,
  dieIndex: number,
  usedNorms: Set<string>,
): KeywordPick {
  const total = globalWordCount(doc)
  if (total === 0) throw new Error('book has no words')
  const startPage = doc.pages[Math.min(Math.max(pageIndex, 0), doc.pages.length - 1)]
  const begin = globalIndexOf(doc, pageIndex, dieToWordIndex(startPage.words.length, dieValue, dieIndex))

  const isValidAt = (g: number) => {
    const { pageIndex: pi, wordIndex: wi } = locateWord(doc, g)
    const page = doc.pages[pi]
    return page.valid[wi] && !usedNorms.has(normalizeKeyword(page.words[wi].word))
  }
  const anyValidAt = (g: number) => {
    const { pageIndex: pi, wordIndex: wi } = locateWord(doc, g)
    return doc.pages[pi].valid[wi]
  }

  let found = scanForward(begin, total, isValidAt) ?? scanForward(begin, total, anyValidAt)
  if (found === null) found = begin % total

  const { pageIndex: pi, wordIndex: wi } = locateWord(doc, found)
  const word = doc.pages[pi].words[wi]
  return {
    dieIndex,
    dieValue,
    pageIndex: pi,
    offset: word.offset,
    length: word.word.length,
    keyword: word.word,
  }
}

function scanForward(begin: number, total: number, predicate: (i: number) => boolean): number | null {
  for (let k = 0; k < total; k++) {
    const i = (begin + k) % total
    if (predicate(i)) return i
  }
  return null
}

/** 书籍统计（开局面板展示用） */
export function bookStats(doc: BookDocument): {
  wordCount: number
  validWordCount: number
  pages: number
} {
  let words = 0
  let valid = 0
  for (const p of doc.pages) {
    words += p.words.length
    for (const v of p.valid) if (v) valid++
  }
  return { wordCount: words, validWordCount: valid, pages: pageCount(doc) }
}

/**
 * 骰子覆盖能力：K 个 1d10 按位组合 ≈ 一次 1d(10^K)。
 * 若书总页数 > 10^K，超出部分的页永远不会被翻到（UI 据此提示）。
 */
export function diceReachableMaxPage(diceCount: number): number {
  return 10 ** diceCount
}
