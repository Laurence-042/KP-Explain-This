import { describe, expect, it } from 'vitest'
import { normalizeStoredBook } from './useBooks'

describe('normalizeStoredBook（旧格式书籍记录兼容）', () => {
  it('v1 旧格式（无 source/wordCount）视为 TXT 并补齐字段', () => {
    const legacy = { id: 'b1', name: '旧书', text: 'knife winter debt', addedAt: '2026-10-01T00:00:00Z' }
    const book = normalizeStoredBook(legacy)
    expect(book).toEqual({
      id: 'b1',
      name: '旧书',
      source: 'txt',
      text: 'knife winter debt',
      wordCount: 0,
      addedAt: '2026-10-01T00:00:00Z',
    })
  })

  it('新格式 TXT / PDF 原样通过', () => {
    const txt = normalizeStoredBook({
      id: 'b2', name: 't', source: 'txt', text: 'abc', wordCount: 3, addedAt: 'x',
    })
    expect(txt?.source).toBe('txt')
    expect(txt?.wordCount).toBe(3)

    const pdf = normalizeStoredBook({
      id: 'b3', name: 'p', source: 'pdf', pageTexts: ['a', 'b'], wordCount: 2, addedAt: 'x',
    })
    expect(pdf?.source).toBe('pdf')
    expect(pdf?.pageTexts).toEqual(['a', 'b'])
  })

  it('损坏记录返回 null 而不是抛错', () => {
    expect(normalizeStoredBook(null)).toBeNull()
    expect(normalizeStoredBook('junk')).toBeNull()
    expect(normalizeStoredBook({ name: 'no-id' })).toBeNull()
    expect(normalizeStoredBook({ id: 'x', name: 'n', source: 'pdf' })).toEqual({
      id: 'x',
      name: 'n',
      source: 'pdf',
      pageTexts: [],
      wordCount: 0,
      addedAt: '',
    })
  })
})
