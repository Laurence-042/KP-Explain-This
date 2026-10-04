import type { BookDocument, InitRollResult, RollResult } from './types'
import { DICE_SIDES } from './constants'
import { pageCount, nearestValidPage, pickKeywordOnPage } from './book'
import { normalizeKeyword } from './tokenizer'

/**
 * 随机源：全部走 crypto.getRandomValues（拒绝采样消除模偏差）。
 * 随机结果只由代码产生，LLM 只解释结果。
 */
export function rollDie(sides: number = DICE_SIDES): number {
  if (sides < 1) throw new Error('sides must be >= 1')
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / sides) * sides
  let v: number
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return (v % sides) + 1
}

export function rollDice(count: number, sides: number = DICE_SIDES): number[] {
  return Array.from({ length: count }, () => rollDie(sides))
}

/**
 * 骰面按位组合：K 个 1d10 依次作为个/十/百…位（骰面 1–10 对应数字 0–9），
 * 本质上是一次均匀的 1d(10^K)。翻页页码 = 该数 mod 总页数。
 */
export function diceToNumber(dice: number[]): number {
  let n = 0
  for (const d of dice) n = n * 10 + (d - 1)
  return n
}

/** 纯函数：给定骰面，在当前页掷骰（关键词来自当前页起向后，nextPage = 位组合数 mod 总页数） */
export function computeRollOnPage(
  doc: BookDocument,
  currentPageIndex: number,
  dice: number[],
): RollResult {
  const total = pageCount(doc)
  const used = new Set<string>()
  const picks = dice.map((dieValue, dieIndex) => {
    const pick = pickKeywordOnPage(doc, currentPageIndex, dieValue, dieIndex, used)
    used.add(normalizeKeyword(pick.keyword))
    return pick
  })
  return { dice, picks, nextPageIndex: nearestValidPage(doc, diceToNumber(dice) % total) }
}

/** 纯函数：合书初掷，只决定初始页 */
export function computeInitPage(doc: BookDocument, dice: number[]): InitRollResult {
  const total = pageCount(doc)
  return { dice, pageIndex: nearestValidPage(doc, diceToNumber(dice) % total) }
}

export function rollOnPage(doc: BookDocument, currentPageIndex: number, diceCount: number): RollResult {
  return computeRollOnPage(doc, currentPageIndex, rollDice(diceCount))
}

export function rollInitPage(doc: BookDocument, diceCount: number): InitRollResult {
  return computeInitPage(doc, rollDice(diceCount))
}
