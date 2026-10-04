import { describe, expect, it } from 'vitest'
import { applyStateChanges, createInitialWorld, sanitizeStateChanges } from './world'
import { MAX_LIST_ITEMS } from './constants'

const P1 = { id: 'pc-a', name: '玩家A' }

function freshWorld() {
  return createInitialWorld([P1])
}

describe('createInitialWorld', () => {
  it('初始化玩家与物品栏', () => {
    const w = freshWorld()
    expect(w.players['pc-a']).toEqual({ name: '玩家A', status: '' })
    expect(w.inventory['pc-a']).toEqual([])
    expect(w.round).toBe(1)
    expect(w.facts).toEqual([])
  })
})

describe('sanitizeStateChanges', () => {
  it('保留合法字段，丢弃未知字段并给出 warning', () => {
    const { changes, warnings } = sanitizeStateChanges({
      location: 'back alley',
      time: 'midnight',
      inventory_added: ['knife', 42, ''],
      unknown_field: 'x',
    })
    expect(changes.location).toBe('back alley')
    expect(changes.inventory_added).toEqual(['knife'])
    expect(warnings.some((w) => w.includes('unknown_field'))).toBe(true)
    expect(warnings.some((w) => w.includes('inventory_added'))).toBe(true)
  })

  it('npc 字符串值视为 status', () => {
    const { changes } = sanitizeStateChanges({
      npc_changes: { debt_collector: 'searching' },
    })
    expect(changes.npc_changes).toEqual({ debt_collector: { status: 'searching' } })
  })

  it('嵌套 {"state_changes": {...}} 自动解包', () => {
    const { changes } = sanitizeStateChanges({
      state_changes: { location: '小巷', facts_added: ['窗碎了'] },
    })
    expect(changes.location).toBe('小巷')
    expect(changes.facts_added).toEqual(['窗碎了'])
  })

  it('非对象输入整体忽略', () => {
    const { changes, warnings } = sanitizeStateChanges('nonsense')
    expect(changes.location).toBeUndefined()
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('scene_end 必须是布尔值', () => {
    expect(sanitizeStateChanges({ scene_end: true }).changes.scene_end).toBe(true)
    expect(sanitizeStateChanges({ scene_end: 'yes' }).changes.scene_end).toBeUndefined()
    expect(sanitizeStateChanges({ scene_end: 'yes' }).warnings.length).toBeGreaterThan(0)
  })
})

describe('applyStateChanges', () => {
  it('location/time/scene 覆盖，facts 去重', () => {
    const w = freshWorld()
    const r1 = applyStateChanges(
      w,
      { location: '小巷', time: '深夜', scene: '逃跑', facts_added: ['窗户已碎'] },
      'pc-a',
    )
    expect(r1.sceneEnd).toBe(false)
    expect(w.location).toBe('小巷')
    expect(w.time).toBe('深夜')
    expect(w.facts).toEqual(['窗户已碎'])
    applyStateChanges(w, { facts_added: ['窗户已碎', '窗户已碎'] }, 'pc-a')
    expect(w.facts).toEqual(['窗户已碎'])
  })

  it('inventory 增删：大小写不敏感去重，删不存在的给出 warning', () => {
    const w = freshWorld()
    applyStateChanges(w, { inventory_added: ['Knife', 'rope'] }, 'pc-a')
    expect(w.inventory['pc-a']).toEqual(['Knife', 'rope'])
    applyStateChanges(w, { inventory_added: ['knife'] }, 'pc-a')
    expect(w.inventory['pc-a']).toEqual(['Knife', 'rope'])
    const r = applyStateChanges(w, { inventory_removed: ['ROPE', 'torch'] }, 'pc-a')
    expect(w.inventory['pc-a']).toEqual(['Knife'])
    expect(r.warnings.some((x) => x.includes('torch'))).toBe(true)
  })

  it('npc_changes 合并且保留既有字段', () => {
    const w = freshWorld()
    applyStateChanges(w, { npc_changes: { debt_collector: { status: 'searching', awareness: 3 } } }, 'pc-a')
    applyStateChanges(w, { npc_changes: { debt_collector: { status: 'lost trail' } } }, 'pc-a')
    expect(w.npcs['debt_collector']).toEqual({ name: 'debt_collector', status: 'lost trail', awareness: 3 })
  })

  it('player_changes 支持 roleId 与玩家名匹配', () => {
    const w = freshWorld()
    applyStateChanges(w, { player_changes: { 'pc-a': { status: '受伤' } } }, 'pc-a')
    expect(w.players['pc-a'].status).toBe('受伤')
    applyStateChanges(w, { player_changes: { 玩家A: { hp: 5 } } }, 'pc-a')
    expect(w.players['pc-a'].hp).toBe(5)
    const r = applyStateChanges(w, { player_changes: { 陌生人: { status: 'x' } } }, 'pc-a')
    expect(r.warnings.some((x) => x.includes('陌生人'))).toBe(true)
  })

  it('plot_variables 与 events', () => {
    const w = freshWorld()
    applyStateChanges(
      w,
      { plot_variables: { tension: 7, escaped: true }, events_added: ['窗户被撬开'] },
      'pc-a',
    )
    expect(w.plotVariables).toEqual({ tension: 7, escaped: true })
    expect(w.events).toEqual(['窗户被撬开'])
  })

  it('列表达到上限时保留最新', () => {
    const w = freshWorld()
    const facts = Array.from({ length: MAX_LIST_ITEMS + 10 }, (_, i) => `事实${i}`)
    applyStateChanges(w, { facts_added: facts }, 'pc-a')
    expect(w.facts).toHaveLength(MAX_LIST_ITEMS)
    expect(w.facts[0]).toBe(`事实${10}`)
  })

  it('scene_end 提示透传', () => {
    const w = freshWorld()
    const r = applyStateChanges(w, { scene_end: true }, 'pc-a')
    expect(r.sceneEnd).toBe(true)
  })
})
