import { describe, expect, it } from 'vitest'
import {
  bookStats,
  diceReachableMaxPage,
  globalWordCount,
  isPageValid,
  locateWord,
  nearestValidPage,
  pageText,
  parsePdfPages,
  parseTxt,
  pickKeywordOnPage,
} from './book'
import { MIN_VALID_PAGE_WORDS } from './constants'

function genWords(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `word${String(i).padStart(3, '0')}`)
}

describe('parseTxt', () => {
  it('英文分词、页文本切片、页内偏移、有效词标记', () => {
    const doc = parseTxt('b1', 'test', 'knife ab winter the debt', 100)
    expect(doc.source).toBe('txt')
    expect(doc.pages).toHaveLength(1)
    const page = doc.pages[0]
    expect(page.words.map((w) => w.word)).toEqual(['knife', 'ab', 'winter', 'the', 'debt'])
    expect(page.valid).toEqual([true, false, true, false, true])
    expect(pageText(doc, 0)).toBe('knife ab winter the debt')
    // 偏移相对页文本
    expect(page.words[3].offset).toBe(16)
  })

  it('多页：每页词数切分，页文本独立', () => {
    const words = genWords(10)
    const doc = parseTxt('b1', 'test', words.join(' '), 4)
    expect(doc.pages).toHaveLength(3)
    expect(pageText(doc, 0)).toBe(words.slice(0, 4).join(' '))
    expect(pageText(doc, 2)).toBe(words.slice(8).join(' '))
    expect(doc.pages[1].words[0].offset).toBe(0)
  })

  it('换行规范化，偏移仍指向正确位置', () => {
    const doc = parseTxt('b1', 'test', 'knife\r\nwinter\r\ndebt', 100)
    const page = doc.pages[0]
    expect(pageText(doc, 0)).toBe('knife\nwinter\ndebt')
    expect(pageText(doc, 0).slice(page.words[1].offset, page.words[1].offset + 6)).toBe('winter')
  })

  it('空内容抛错', () => {
    expect(() => parseTxt('b', 't', '   \n  ')).toThrow()
  })

  it('bookStats 统计', () => {
    const doc = parseTxt('b1', 'test', 'knife ab winter the debt', 3)
    const stats = bookStats(doc)
    expect(stats.wordCount).toBe(5)
    expect(stats.validWordCount).toBe(3)
    expect(stats.pages).toBe(2)
  })
})

describe('parsePdfPages', () => {
  it('每页独立分词，页数保留真实页数（含无字页）', () => {
    const pageA = 'knife ab winter the debt glass river stone iron wind ' + genWords(MIN_VALID_PAGE_WORDS).join(' ')
    const doc = parsePdfPages('p1', 'pdf', [
      pageA,
      '', // 图片页：无字
      'harbor lantern winter courage debt ember',
    ])
    expect(doc.source).toBe('pdf')
    expect(doc.pageWordCount).toBe(0)
    expect(doc.pages).toHaveLength(3)
    expect(doc.pages[1].words).toHaveLength(0)
    expect(isPageValid(doc, 0)).toBe(true)
    expect(isPageValid(doc, 1)).toBe(false)
    expect(doc.pages[2].words.map((w) => w.word)).toContain('harbor')
  })

  it('中文 PDF 页', () => {
    const doc = parsePdfPages('p1', 'pdf', ['夜色中的旧书店，弥漫着尘埃。'])
    const page = doc.pages[0]
    expect(page.words.map((w) => w.word).join('')).toBe('夜色中的旧书店弥漫着尘埃')
    expect(page.words.every((w) => pageText(doc, 0).slice(w.offset, w.offset + w.word.length) === w.word)).toBe(true)
  })

  it('空页列表抛错', () => {
    expect(() => parsePdfPages('p', 't', [])).toThrow()
  })
})

describe('全局词寻址', () => {
  const doc = parseTxt('b', 't', [...genWords(5), ...genWords(10).map((w) => w + 'x')].join(' '), 5)

  it('locateWord / globalWordCount / 越页一致性', () => {
    expect(globalWordCount(doc)).toBe(15)
    expect(locateWord(doc, 0)).toEqual({ pageIndex: 0, wordIndex: 0 })
    expect(locateWord(doc, 5)).toEqual({ pageIndex: 1, wordIndex: 0 })
    expect(locateWord(doc, 14)).toEqual({ pageIndex: 2, wordIndex: 4 })
  })
})

describe('nearestValidPage', () => {
  it('TXT 尾部短页回退到前一有效页', () => {
    const doc = parseTxt('b1', 't', genWords(MIN_VALID_PAGE_WORDS * 2 + 5).join(' '), MIN_VALID_PAGE_WORDS)
    const last = doc.pages.length - 1
    expect(nearestValidPage(doc, last)).toBe(last - 1)
    expect(nearestValidPage(doc, 99)).toBe(last - 1)
  })

  it('PDF 无字页被跳过', () => {
    const full = genWords(MIN_VALID_PAGE_WORDS).join(' ')
    const doc = parsePdfPages('p', 't', [full, '', full, '', full])
    expect(doc.pages).toHaveLength(5)
    expect(nearestValidPage(doc, 1)).toBe(0)
    expect(nearestValidPage(doc, 3)).toBe(2)
  })
})

describe('pickKeywordOnPage', () => {
  const doc = parseTxt('b1', 'test', 'knife ab winter the debt', 100)

  it('从落点向后取最近的有效词，pick 携带页内偏移', () => {
    const pick = pickKeywordOnPage(doc, 0, 1, 0, new Set(), 0)
    expect(pick.keyword).toBe('knife')
    expect(pick.pageIndex).toBe(0)
    expect(pick.offset).toBe(0)
    expect(pick.length).toBe(5)
  })

  it('三个骰子得到三个互不相同的关键词', () => {
    const used = new Set<string>()
    const picks = [1, 6, 2].map((dv, i) => {
      const pick = pickKeywordOnPage(doc, 0, dv, i, used, [0, 4, 2][i])
      used.add(pick.keyword.toLowerCase())
      return pick
    })
    expect(picks.map((p) => p.keyword)).toEqual(['knife', 'debt', 'winter'])
  })

  it('当前页有效词耗尽时越页取词（pageIndex 指向命中页）', () => {
    const twoPages = parseTxt('b', 't', 'knife ab winter the debt glass river stone iron wind', 5)
    const used = new Set<string>()
    const p1 = pickKeywordOnPage(twoPages, 0, 1, 0, used, 0)
    used.add(p1.keyword.toLowerCase())
    const p2 = pickKeywordOnPage(twoPages, 0, 5, 1, used, 4)
    used.add(p2.keyword.toLowerCase())
    const p3 = pickKeywordOnPage(twoPages, 0, 4, 2, used, 4)
    expect(p1.keyword).toBe('knife')
    expect(p1.pageIndex).toBe(0)
    expect(p2.keyword).toBe('debt')
    expect(p3.keyword).toBe('glass')
    expect(p3.pageIndex).toBe(1)
    // glass 在第 2 页页文本内的偏移
    expect(pageText(twoPages, 1).slice(p3.offset, p3.offset + p3.length)).toBe('glass')
  })
})

describe('diceReachableMaxPage', () => {
  it('K 个 d10 按位组合的覆盖上限 = 10^K', () => {
    expect(diceReachableMaxPage(2)).toBe(100)
    expect(diceReachableMaxPage(3)).toBe(1000)
  })
})
