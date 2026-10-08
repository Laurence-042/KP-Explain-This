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

type PlayerChangeContext = { players: Record<string, ActorState>; actingRoleId: string }

/**
 * KP 偶尔省略角色 ID，直接给出当前行动者的状态字段。
 * 只识别明确的状态字段；其他未知键仍按玩家名处理并发出 warning。
 */
function asPlayerChanges(
  value: unknown,
  warnings: string[],
  context?: PlayerChangeContext,
): Record<string, ActorState> | undefined {
  if (!context || !isPlainObject(value) || !context.players[context.actingRoleId]) {
    return asActorChanges(value, 'player_changes', warnings)
  }
  const keys = Object.keys(value)
  const playerNames = Object.values(context.players).map((p) => normItem(p.name ?? ''))
  const hasPlayerKey = keys.some((key) => context.players[key] || playerNames.includes(normItem(key)))
  const directFields = new Set(['status', 'state', 'awake', 'alive', 'injured', 'hp', 'health', 'mood', 'condition', 'location'])
  if (hasPlayerKey || !keys.length || !keys.every((key) => directFields.has(key))) {
    return asActorChanges(value, 'player_changes', warnings)
  }

  const patch: ActorState = {}
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key === 'state' && isPlainObject(fieldValue)) {
      for (const [nestedKey, nestedValue] of Object.entries(fieldValue)) {
        if (typeof nestedValue === 'string' || typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
          patch[nestedKey] = nestedValue
        } else {
          warnings.push(`player_changes.state.${nestedKey} 的值类型不支持，已丢弃`)
        }
      }
    } else if (key === 'state' && typeof fieldValue === 'string') {
      patch.status = fieldValue
    } else if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
      patch[key] = fieldValue
    } else {
      warnings.push(`player_changes.${key} 的值类型不支持，已丢弃`)
    }
  }
  return { [context.actingRoleId]: patch }
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

function asInventoryChanges(
  value: unknown,
  warnings: string[],
): StateChanges['inventory_changes'] {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) {
    warnings.push('字段 inventory_changes 应为按角色 ID 索引的对象，已忽略')
    return undefined
  }
  const out: NonNullable<StateChanges['inventory_changes']> = Object.create(null)
  for (const [roleId, patch] of Object.entries(value)) {
    if (!roleId.trim() || !isPlainObject(patch)) {
      warnings.push(`inventory_changes.${roleId} 应为对象，已忽略`)
      continue
    }
    for (const key of Object.keys(patch)) {
      if (key !== 'added' && key !== 'removed') warnings.push(`inventory_changes.${roleId}.${key} 未知，已忽略`)
    }
    out[roleId] = {
      added: asStringList(patch.added, `inventory_changes.${roleId}.added`, warnings),
      removed: asStringList(patch.removed, `inventory_changes.${roleId}.removed`, warnings),
    }
  }
  return out
}

/** 把未知的 LLM 输出清洗成受控的 StateChanges；未知字段丢弃并记录 warning */
export function sanitizeStateChanges(
  rawInput: unknown,
  context?: PlayerChangeContext,
): { changes: StateChanges; warnings: string[] } {
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
    'location', 'time', 'scene', 'inventory_added', 'inventory_removed', 'inventory_changes',
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
  changes.inventory_changes = asInventoryChanges(raw.inventory_changes, warnings)
  changes.npc_changes = asActorChanges(raw.npc_changes, 'npc_changes', warnings)
  changes.player_changes = asPlayerChanges(raw.player_changes, warnings, context)
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
 * 顶层 inventory_* 作用于行动角色；inventory_changes 用明确 roleId。
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

  const changeInventory = (roleId: string, added: string[], removed: string[]) => {
    const inv = (world.inventory[roleId] ??= [])
    for (const item of added) pushUnique(inv, item)
    for (const item of removed) {
      const norm = normItem(item)
      const idx = inv.findIndex((x) => normItem(x) === norm)
      if (idx >= 0) inv.splice(idx, 1)
      else warnings.push(`物品 "${item}" 不在 ${roleId} 的物品栏中，无法移除`)
    }
  }
  if (world.players[actingRoleId]) {
    changeInventory(actingRoleId, changes.inventory_added ?? [], changes.inventory_removed ?? [])
  } else if ((changes.inventory_added?.length ?? 0) + (changes.inventory_removed?.length ?? 0) > 0) {
    warnings.push('没有明确的行动玩家，顶层 inventory_added/inventory_removed 已忽略；请用 inventory_changes 按角色 ID 指定物品')
  }
  for (const [roleId, patch] of Object.entries(changes.inventory_changes ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(world.players, roleId)) {
      warnings.push(`inventory_changes 中的 "${roleId}" 无法匹配任何玩家，已忽略`)
      continue
    }
    changeInventory(roleId, patch.added ?? [], patch.removed ?? [])
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
