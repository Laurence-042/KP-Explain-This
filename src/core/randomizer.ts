import type { BookDocument, DieLanding, InitRollResult, KeywordPick, RollResult } from './types'
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
 * 骰面 → 数字位：面 1–9 即数字本身，面 10 视为 0（百分骰惯例）。
 */
export function dieDigit(dieValue: number): number {
  return dieValue % 10
}

/** 已按落点阅读顺序排列的骰面，从左到右依次作为高位到低位。 */
export function diceToNumber(dice: number[]): number {
  let n = 0
  for (const d of dice) n = n * 10 + dieDigit(d)
  return n
}

/** 页内按文本阅读顺序（上到下、同行左到右）；跨页落点排在后面。 */
export function diceInPageOrder(dice: number[], picks: KeywordPick[]): number[] {
  return [...picks]
    .sort((a, b) => a.pageIndex - b.pageIndex || a.offset - b.offset || a.dieIndex - b.dieIndex)
    .map((pick) => dice[pick.dieIndex])
}

/** 封面上按纵坐标、横坐标阅读。 */
export function diceInCoverOrder(dice: number[], landings: DieLanding[]): number[] {
  return dice.map((value, index) => ({ value, index, landing: landings[index] }))
    .sort((a, b) => a.landing.y - b.landing.y || a.landing.x - b.landing.x || a.index - b.index)
    .map(({ value }) => value)
}

/** 纯函数：给定骰面，在当前页掷骰（关键词来自当前页起向后，nextPage = 位组合数 mod 总页数） */
export function computeRollOnPage(
  doc: BookDocument,
  currentPageIndex: number,
  dice: number[],
  landingWordIndices: number[],
): RollResult {
  const total = pageCount(doc)
  if (landingWordIndices.length !== dice.length) throw new Error('dice and landings must have the same length')
  const used = new Set<string>()
  const picks = dice.map((dieValue, dieIndex) => {
    const pick = pickKeywordOnPage(doc, currentPageIndex, dieValue, dieIndex, used, landingWordIndices[dieIndex])
    used.add(normalizeKeyword(pick.keyword))
    return pick
  })
  return { dice, picks, nextPageIndex: nearestValidPage(doc, diceToNumber(diceInPageOrder(dice, picks)) % total) }
}

/** 纯函数：合书初掷，只决定初始页 */
export function computeInitPage(doc: BookDocument, dice: number[], landings: DieLanding[]): InitRollResult {
  const total = pageCount(doc)
  if (landings.length !== dice.length) throw new Error('dice and landings must have the same length')
  return { dice, landings, pageIndex: nearestValidPage(doc, diceToNumber(diceInCoverOrder(dice, landings)) % total) }
}

export function rollOnPage(doc: BookDocument, currentPageIndex: number, diceCount: number): RollResult {
  const dice = rollDice(diceCount)
  const wordCount = doc.pages[currentPageIndex]?.words.length ?? 0
  const landings = dice.map(() => wordCount > 0 ? rollDie(wordCount) - 1 : 0)
  return computeRollOnPage(doc, currentPageIndex, dice, landings)
}

export function rollInitPage(doc: BookDocument, diceCount: number): InitRollResult {
  const dice = rollDice(diceCount)
  const landings = dice.map(() => ({ x: rollDie(1000) / 1000, y: rollDie(1000) / 1000 }))
  return computeInitPage(doc, dice, landings)
}
