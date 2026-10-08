import { describe, expect, it } from 'vitest'
import { computeInitPage, computeRollOnPage, diceInCoverOrder, diceInPageOrder, diceToNumber, rollDie, rollDice } from './randomizer'
import { parseTxt } from './book'

// 每页 5 词，共 2 页（短页由 nearestValidPage 处理）
const doc = parseTxt('b', 't', 'knife ab winter the debt glass river stone iron wind', 5)

describe('rollDie / rollDice', () => {
  it('点数始终在 1..sides 内', () => {
    for (let i = 0; i < 300; i++) {
      const v = rollDie(10)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(10)
    }
  })

  it('rollDice 数量正确且每个点数合法', () => {
    const dice = rollDice(3)
    expect(dice).toHaveLength(3)
    for (const d of dice) {
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(10)
    }
  })
})

describe('diceToNumber（骰面按位组合 ≈ 1d10^K）', () => {
  it('个/十/百位组合，面 1–9 即数字本身、面 10 视为 0', () => {
    expect(diceToNumber([1, 1, 1])).toBe(111)
    expect(diceToNumber([10, 10, 10])).toBe(0) // 000
    expect(diceToNumber([3, 10, 1])).toBe(301)
    expect(diceToNumber([1, 2])).toBe(12) // 两位：12
    expect(diceToNumber([4])).toBe(4) // 单骰：4
    // 用户示例：8 10 4 → 804；10 7 6 → 076 = 76
    expect(diceToNumber([8, 10, 4])).toBe(804)
    expect(diceToNumber([10, 7, 6])).toBe(76)
  })
})

describe('computeRollOnPage', () => {
  it('位组合数 mod 总页数得到 nextPageIndex', () => {
    expect(computeRollOnPage(doc, 0, [5, 5, 5], [0, 2, 4]).nextPageIndex).toBe(1) // 555 % 2
    expect(computeRollOnPage(doc, 0, [4, 4, 4], [0, 2, 4]).nextPageIndex).toBe(0) // 444 % 2
  })

  it('关键词取自当前页且互不相同', () => {
    const r = computeRollOnPage(doc, 0, [1, 2, 8], [0, 2, 4])
    expect(r.picks.map((p) => p.keyword)).toEqual(['knife', 'winter', 'debt'])
  })

  it('当前页有效词耗尽时越页取词', () => {
    const r = computeRollOnPage(doc, 0, [1, 6, 4], [0, 4, 4])
    expect(r.picks.map((p) => p.keyword)).toEqual(['knife', 'debt', 'glass'])
    expect(r.picks[2].pageIndex).toBe(1)
  })

  it('picks 与 dice 一一对应', () => {
    const r = computeRollOnPage(doc, 0, [2, 4, 7], [0, 2, 4])
    expect(r.picks.map((p) => p.dieValue)).toEqual([2, 4, 7])
    expect(r.picks.map((p) => p.dieIndex)).toEqual([0, 1, 2])
  })
})

describe('computeInitPage', () => {
  it('只决定初始页', () => {
    const landings = [{ x: .8, y: .6 }, { x: .2, y: .2 }, { x: .4, y: .6 }]
    const r = computeInitPage(doc, [3, 5, 7], landings)
    expect(r.dice).toEqual([3, 5, 7])
    expect(r.landings).toEqual(landings)
    expect(diceInCoverOrder(r.dice, r.landings)).toEqual([5, 7, 3])
    expect(r.pageIndex).toBe(573 % 2)
  })
})

describe('落点阅读顺序决定数位', () => {
  it('页内从上到下、同行从左到右，骰子生成序号不决定百位', () => {
    const longDoc = parseTxt('long', 'test', Array.from({ length: 110 }, (_, i) => `word${i}`).join(' '), 10)
    const roll = computeRollOnPage(longDoc, 0, [8, 2, 5], [8, 2, 5])
    expect(diceInPageOrder(roll.dice, roll.picks)).toEqual([2, 5, 8])
    expect(roll.nextPageIndex).toBe(258 % 11)
  })

  it('封面同行由左侧骰子作为高位', () => {
    expect(diceInCoverOrder([8, 2, 5], [{ x: .9, y: .2 }, { x: .1, y: .2 }, { x: .5, y: .8 }])).toEqual([2, 8, 5])
  })
})
