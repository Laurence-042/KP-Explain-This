import type { ActorState, ApplyResult, StateChanges, WorldState } from './types'
import { MAX_LIST_ITEMS } from './constants'

/** 开局时的世界状态：一切未定，事实源随剧情由 state_changes 累积 */
export function createInitialWorld(players: Array<{ id: string; name: string }>): WorldState {
  const playerMap: Record<string, ActorState> = {}
  const inventory: Record<string, string[]> = {}
  for (const p of players) {
    playerMap[p.id] = { name: p.name, status: '' }
    inventory[p.id] = []
  }
  return {
    location: '',
    time: '',
    scene: '',
    players: playerMap,
    npcs: {},
    inventory,
    facts: [],
    events: [],
    plotVariables: {},
    round: 1,
  }
}

// ===== state_changes 清洗 =====

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s || undefined
}

function asStringList(v: unknown, field: string, warnings: string[]): string[] | undefined {
  if (!Array.isArray(v)) {
    if (v !== undefined) warnings.push(`字段 ${field} 应为字符串数组，已忽略`)
    return undefined
  }
  const items: string[] = []
  for (const item of v) {
    if (typeof item === 'string' && item.trim()) items.push(item.trim())
  }
  if (v.length !== items.length) {
    warnings.push(`字段 ${field} 中有非字符串条目被丢弃`)
  }
  return items
}

/** NPC/玩家状态变化：value 为字符串时视为 status，对象时取其原始字段 */
function asActorChanges(
  v: unknown,
  field: string,
  warnings: string[],
): Record<string, ActorState> | undefined {
  if (!isPlainObject(v)) {
    if (v !== undefined) warnings.push(`字段 ${field} 应为对象，已忽略`)
    return undefined
  }
  const out: Record<string, ActorState> = {}
  for (const [key, value] of Object.entries(v)) {
    const name = key.trim()
    if (!name) continue
    if (typeof value === 'string') {
      out[name] = value.trim() ? { status: value.trim() } : {}
    } else if (isPlainObject(value)) {
      const actor: ActorState = {}
      for (const [k, val] of Object.entries(value)) {
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          actor[k] = val
        }
      }
      out[name] = actor
    } else {
      warnings.push(`${field}.${key} 的值类型不支持，已丢弃`)
    }
  }
  return out
}

function asPlotVariables(
  v: unknown,
  field: string,
  warnings: string[],
): Record<string, string | number | boolean> | undefined {
  if (!isPlainObject(v)) {
    if (v !== undefined) warnings.push(`字段 ${field} 应为对象，已忽略`)
    return undefined
  }
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key.trim()] = value
    }
  }
  return out
}

/** 把未知的 LLM 输出清洗成受控的 StateChanges；未知字段丢弃并记录 warning */
export function sanitizeStateChanges(rawInput: unknown): { changes: StateChanges; warnings: string[] } {
  const warnings: string[] = []
  const changes: StateChanges = {}
  if (!isPlainObject(rawInput)) {
    if (rawInput !== undefined && rawInput !== null) warnings.push('state_changes 不是对象，已整体忽略')
    return { changes, warnings }
  }
  // KP 有时把整个对象多包一层 {"state_changes": {...}}，解包后继续
  let raw: Record<string, unknown> = rawInput
  const nested = raw.state_changes
  if (isPlainObject(nested)) {
    raw = { ...rawInput, ...nested }
    delete raw.state_changes
  }
  const knownKeys = new Set([
    'location', 'time', 'scene', 'inventory_added', 'inventory_removed',
    'npc_changes', 'player_changes', 'facts_added', 'events_added',
    'plot_variables', 'scene_end',
  ])
  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key)) warnings.push(`未知字段 "${key}" 已丢弃`)
  }

  changes.location = asTrimmedString(raw.location)
  changes.time = asTrimmedString(raw.time)
  changes.scene = asTrimmedString(raw.scene)
  changes.inventory_added = asStringList(raw.inventory_added, 'inventory_added', warnings)
  changes.inventory_removed = asStringList(raw.inventory_removed, 'inventory_removed', warnings)
  changes.npc_changes = asActorChanges(raw.npc_changes, 'npc_changes', warnings)
  changes.player_changes = asActorChanges(raw.player_changes, 'player_changes', warnings)
  changes.facts_added = asStringList(raw.facts_added, 'facts_added', warnings)
  changes.events_added = asStringList(raw.events_added, 'events_added', warnings)
  changes.plot_variables = asPlotVariables(raw.plot_variables, 'plot_variables', warnings)
  if (raw.scene_end !== undefined) {
    if (typeof raw.scene_end === 'boolean') changes.scene_end = raw.scene_end
    else warnings.push('scene_end 应为布尔值，已忽略')
  }
  return { changes, warnings }
}

// ===== 合并 =====

function normItem(s: string): string {
  return s.trim().toLowerCase()
}

function pushUnique(list: string[], item: string): void {
  const norm = normItem(item)
  if (list.some((x) => normItem(x) === norm)) return
  list.push(item)
  if (list.length > MAX_LIST_ITEMS) list.splice(0, list.length - MAX_LIST_ITEMS)
}

function mergeActor(target: ActorState, patch: ActorState): void {
  for (const [k, v] of Object.entries(patch)) {
    target[k] = v
  }
}

/**
 * 将（已清洗的）state_changes 合并进世界状态。
 * inventory_* 作用于行动角色；npc/player changes 按名字键合并。
 */
export function applyStateChanges(
  world: WorldState,
  changes: StateChanges,
  actingRoleId: string,
): ApplyResult {
  const warnings: string[] = []
  if (changes.location) world.location = changes.location
  if (changes.time) world.time = changes.time
  if (changes.scene) world.scene = changes.scene

  const inv = (world.inventory[actingRoleId] ??= [])
  for (const item of changes.inventory_added ?? []) pushUnique(inv, item)
  for (const item of changes.inventory_removed ?? []) {
    const norm = normItem(item)
    const idx = inv.findIndex((x) => normItem(x) === norm)
    if (idx >= 0) inv.splice(idx, 1)
    else warnings.push(`物品 "${item}" 不在 ${actingRoleId} 的物品栏中，无法移除`)
  }

  for (const [key, patch] of Object.entries(changes.npc_changes ?? {})) {
    const existing = (world.npcs[key] ??= { name: key })
    mergeActor(existing, patch)
  }
  for (const [key, patch] of Object.entries(changes.player_changes ?? {})) {
    // key 允许是 roleId 或玩家名，尽力匹配
    let roleId = world.players[key] ? key : undefined
    if (!roleId) {
      const byName = Object.entries(world.players).find(
        ([, st]) => st.name === key || normItem(st.name ?? '') === normItem(key),
      )
      roleId = byName?.[0]
    }
    if (!roleId) {
      warnings.push(`player_changes 中的 "${key}" 无法匹配任何玩家，已忽略`)
      continue
    }
    mergeActor(world.players[roleId], patch)
  }

  for (const fact of changes.facts_added ?? []) pushUnique(world.facts, fact)
  for (const event of changes.events_added ?? []) pushUnique(world.events, event)
  for (const [k, v] of Object.entries(changes.plot_variables ?? {})) {
    world.plotVariables[k] = v
  }

  return { sceneEnd: changes.scene_end === true, warnings }
}
