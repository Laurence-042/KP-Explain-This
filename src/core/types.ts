/**
 * 核心域类型。本目录（src/core）不得 import vue 或任何浏览器/框架专属 API，
 * 保证可以用 vitest 在 node 环境直接测试，并整体序列化保存/恢复。
 */

export type RoleId = string
export type RoleKind = 'kp' | 'pc'
export type ControllerKind = 'human' | 'llm'

/** 角色定义（可序列化）。MVP 固定为 1 个 KP(llm) + 1 个 PC(human)，但引擎按数组处理。 */
export type RoleDef = {
  id: RoleId
  name: string
  kind: RoleKind
  controller: ControllerKind
  /** 分配给该角色的书籍 id */
  bookId: string
}

/** 书中的一个词：offset 相对所在页的页文本（高亮直接在页文本上定位） */
export type BookWord = {
  word: string
  offset: number
}

/** 一页：页文本 + 页内词及有效性。TXT 虚拟分页与 PDF 真实页统一为此结构 */
export type BookPage = {
  text: string
  words: BookWord[]
  /** 与 words 同长，标记该词是否可作为关键词 */
  valid: boolean[]
}

export type BookSource = 'txt' | 'pdf'

/** 解析后的书籍文档（内存态索引；原始内容随存档/书库另存） */
export type BookDocument = {
  id: string
  name: string
  source: BookSource
  /** TXT 虚拟分页的每页词数；PDF 恒为 0（真实页） */
  pageWordCount: number
  pages: BookPage[]
}

/** 骰子命中的一个关键词（offset/length 相对命中页的页文本） */
export type KeywordPick = {
  /** 命中的骰子序号（0-based） */
  dieIndex: number
  dieValue: number
  /** 命中页（可能与掷骰页不同：跨页取词兜底时） */
  pageIndex: number
  /** 页文本内偏移与长度（高亮用） */
  offset: number
  length: number
  keyword: string
}

/** 一次掷骰结果：骰面、命中的关键词、以及本轮结束后要翻到的目标页 */
export type RollResult = {
  dice: number[]
  picks: KeywordPick[]
  /** 落点阅读顺序组成的数字 mod 总页数（已取最近有效页） */
  nextPageIndex: number
}

export type DieLanding = { x: number; y: number }

/** 合书初掷：只定初始页，不取词 */
export type InitRollResult = {
  dice: number[]
  /** 封面内归一化落点，与 dice 按原始骰子序号对应 */
  landings: DieLanding[]
  pageIndex: number
}

// ===== World State =====

/** 角色/NPC 的状态块；除常用字段外允许 KP 写入少量扩展字段 */
export type ActorState = {
  name?: string
  status?: string
  [key: string]: unknown
}

export type WorldState = {
  location: string
  time: string
  /** 当前场景简述 */
  scene: string
  /** 玩家角色状态，key = roleId */
  players: Record<RoleId, ActorState>
  /** NPC 状态，key 由 KP 命名（建议英文 snake_case id） */
  npcs: Record<string, ActorState>
  /** 各角色物品栏 */
  inventory: Record<RoleId, string[]>
  /** 已确立的事实 */
  facts: string[]
  /** 已发生的事件 */
  events: string[]
  /** 长期剧情变量 */
  plotVariables: Record<string, string | number | boolean>
  round: number
}

/** KP 输出的结构化状态变化（schema 写入 KP prompt，解析后经清洗合并） */
export type StateChanges = {
  location?: string
  time?: string
  scene?: string
  /** 追加到行动角色的物品栏 */
  inventory_added?: string[]
  inventory_removed?: string[]
  /** 无行动者或涉及其他角色时，按 roleId 指定物品变化 */
  inventory_changes?: Record<RoleId, { added?: string[]; removed?: string[] }>
  npc_changes?: Record<string, ActorState>
  player_changes?: Record<string, ActorState>
  facts_added?: string[]
  events_added?: string[]
  plot_variables?: Record<string, string | number | boolean>
  scene_end?: boolean
}

export type ApplyResult = {
  /** KP 在 state_changes 中给出的"建议结束场景"提示 */
  sceneEnd: boolean
  /** 清洗过程中被丢弃/修正的字段说明 */
  warnings: string[]
}

// ===== Validator =====

export type Verdict = {
  valid: boolean
  /** 每个关键词是否被真正使用 */
  keyword_usage: Record<string, boolean>
  world_consistent: boolean
  reason: string
}

// ===== 引擎 =====

export type GamePhase =
  | 'setup'
  | 'init-roll'
  | 'rolling'
  | 'kp-scene'
  | 'await-action'
  | 'validating'
  | 'kp-resolve'
  | 'scene-end'
  /** 生成被中止/失败，等待重试或重骰决定 */
  | 'interrupted'
  /** 全体同意重骰，正在回滚重掷 */
  | 'reroll'

export type PlayerAction = {
  roleId: RoleId
  text: string
}

/** UI 游戏日志条目（聊天流渲染依据，随存档保存） */
export type GameLogEntry =
  | { id: string; type: 'round'; round: number }
  | { id: string; type: 'scene'; round: number; opening: boolean; narrative: string }
  | { id: string; type: 'action'; round: number; roleId: RoleId; roleName: string; text: string }
  | {
      id: string
      type: 'verdict'
      round: number
      ok: boolean
      reason: string
      keywordUsage: Record<string, boolean>
      worldConsistent: boolean
    }
  | { id: string; type: 'system'; round: number; text: string }
  | { id: string; type: 'warning'; round: number; text: string }

/** 一轮的掷骰与关键词快照（按角色） */
export type RoundRoll = {
  dice: number[]
  picks: KeywordPick[]
  /** 本轮结束后翻到的页（翻开后成为下一轮的当前页） */
  nextPageIndex: number
}
