import { STOPWORDS, MIN_CJK_WORD_LEN, MIN_LATIN_WORD_LEN } from './constants'

/**
 * 分词：Intl.Segmenter('zh', word) 对中英混排都有效——
 * 中文按词典成词，英文按空白/标点切分。标点与空白天然被 isWordLike 过滤。
 */
let segmenter: Intl.Segmenter | null = null

function getSegmenter(): Intl.Segmenter {
  if (!segmenter) {
    segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  }
  return segmenter
}

export type Token = {
  word: string
  offset: number
}

/** 提取全部"像词"的片段（跳过标点、空白、纯符号） */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  for (const seg of getSegmenter().segment(text)) {
    if (!seg.isWordLike) continue
    tokens.push({ word: seg.segment, offset: seg.index })
  }
  return tokens
}

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const LATIN_RE = /^[a-zA-Z][a-zA-Z'’-]*$/

/** 判断一个词是否够格作为关键词（长度规则 + 停用词表） */
export function isValidKeywordWord(word: string): boolean {
  if (!word) return false
  if (CJK_RE.test(word)) {
    return word.length >= MIN_CJK_WORD_LEN && !STOPWORDS.has(word)
  }
  if (LATIN_RE.test(word)) {
    const lower = word.toLowerCase()
    return word.length >= MIN_LATIN_WORD_LEN && !STOPWORDS.has(lower)
  }
  // 纯数字、混合符号等一律无效
  return false
}

/** 关键词归一化（去重用）：拉丁转小写，去除常见首尾标点 */
export function normalizeKeyword(word: string): string {
  return word.trim().toLowerCase()
}
