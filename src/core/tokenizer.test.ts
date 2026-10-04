import { describe, expect, it } from 'vitest'
import { isValidKeywordWord, normalizeKeyword, tokenize } from './tokenizer'

describe('tokenize', () => {
  it('英文：只保留词，过滤标点与空白，偏移正确', () => {
    const text = 'Hello, world!  The knife is here.'
    const tokens = tokenize(text)
    expect(tokens.map((t) => t.word)).toEqual(['Hello', 'world', 'The', 'knife', 'is', 'here'])
    expect(tokens[0].offset).toBe(0)
    expect(tokens[1].offset).toBe(7)
    expect(tokens[3].offset).toBe(19)
    for (const t of tokens) {
      expect(text.slice(t.offset, t.offset + t.word.length)).toBe(t.word)
    }
  })

  it('中文：按词典成词，标点不产生 token', () => {
    const text = '夜色中的旧书店，弥漫着尘埃。'
    const tokens = tokenize(text)
    const words = tokens.map((t) => t.word)
    expect(words).not.toContain('，')
    expect(words).not.toContain('。')
    // 偏移必须指向原文
    for (const t of tokens) {
      expect(text.slice(t.offset, t.offset + t.word.length)).toBe(t.word)
    }
    expect(words.join('')).toBe('夜色中的旧书店弥漫着尘埃')
  })

  it('中英混排（断言与词典切分方式无关）', () => {
    const text = '夜色 knife 走进 winter'
    const tokens = tokenize(text)
    const words = tokens.map((t) => t.word)
    expect(words).toContain('knife')
    expect(words).toContain('winter')
    // 中文字符不丢失、顺序保留
    expect(words.filter((w) => /[\u4e00-\u9fff]/.test(w)).join('')).toBe('夜色走进')
    for (const t of tokens) {
      expect(text.slice(t.offset, t.offset + t.word.length)).toBe(t.word)
    }
  })
})

describe('isValidKeywordWord', () => {
  it('拉丁词：>=3 且非停用词', () => {
    expect(isValidKeywordWord('knife')).toBe(true)
    expect(isValidKeywordWord('debt')).toBe(true)
    expect(isValidKeywordWord('ab')).toBe(false)
    expect(isValidKeywordWord('the')).toBe(false)
    expect(isValidKeywordWord('THE')).toBe(false)
    expect(isValidKeywordWord("don't")).toBe(true)
  })

  it('中文词：>=2 且非停用词', () => {
    expect(isValidKeywordWord('书店')).toBe(true)
    expect(isValidKeywordWord('尘埃')).toBe(true)
    expect(isValidKeywordWord('中')).toBe(false)
    expect(isValidKeywordWord('我们')).toBe(false)
    expect(isValidKeywordWord('什么')).toBe(false)
  })

  it('数字与符号无效', () => {
    expect(isValidKeywordWord('123')).toBe(false)
    expect(isValidKeywordWord('---')).toBe(false)
    expect(isValidKeywordWord('')).toBe(false)
  })
})

describe('normalizeKeyword', () => {
  it('拉丁转小写、去首尾空白', () => {
    expect(normalizeKeyword(' Knife ')).toBe('knife')
    expect(normalizeKeyword('书店')).toBe('书店')
  })
})
