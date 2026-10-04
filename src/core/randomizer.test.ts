import { describe, expect, it } from 'vitest'
import { computeInitPage, computeRollOnPage, diceToNumber, rollDie, rollDice } from './randomizer'
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
  it('个/十/百位组合，骰面 1–10 对应数字 0–9', () => {
    expect(diceToNumber([1, 1, 1])).toBe(0) // 000
    expect(diceToNumber([10, 10, 10])).toBe(999) // 999
    expect(diceToNumber([3, 10, 1])).toBe(290) // 2 9 0
    expect(diceToNumber([1, 2])).toBe(1) // 两位：01
    expect(diceToNumber([4])).toBe(3) // 单骰：3
  })
})

describe('computeRollOnPage', () => {
  it('位组合数 mod 总页数得到 nextPageIndex', () => {
    expect(computeRollOnPage(doc, 0, [6, 6, 6]).nextPageIndex).toBe(1) // 555 % 2
    expect(computeRollOnPage(doc, 0, [5, 5, 5]).nextPageIndex).toBe(0) // 444 % 2
  })

  it('关键词取自当前页且互不相同', () => {
    const r = computeRollOnPage(doc, 0, [1, 6, 2])
    expect(r.picks.map((p) => p.keyword)).toEqual(['knife', 'debt', 'winter'])
  })

  it('当前页有效词耗尽时越页取词', () => {
    const r = computeRollOnPage(doc, 0, [1, 5, 10])
    expect(r.picks.map((p) => p.keyword)).toEqual(['knife', 'debt', 'glass'])
    expect(r.picks[2].pageIndex).toBe(1)
  })

  it('picks 与 dice 一一对应', () => {
    const r = computeRollOnPage(doc, 0, [2, 4, 7])
    expect(r.picks.map((p) => p.dieValue)).toEqual([2, 4, 7])
    expect(r.picks.map((p) => p.dieIndex)).toEqual([0, 1, 2])
  })
})

describe('computeInitPage', () => {
  it('只决定初始页', () => {
    const r = computeInitPage(doc, [3, 3, 3])
    expect(r.dice).toEqual([3, 3, 3])
    expect(r.pageIndex).toBe(222 % 2) // 位组合 222 → 0
  })
})
