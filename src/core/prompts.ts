import type { PlayerAction, WorldState } from './types'

/**
 * KP / Validator 的 system prompt 与上下文组装。
 * 设计原则（来自 story.md）：
 * - KP 只处理已验证行动、不判断关键词合规、不得修改随机关键词、
 *   必须保持 Canonical World State、新事实必须写入 state_changes。
 * - Validator 不续写剧情、不替玩家补充未表达的理由、只依据玩家实际输入判断。
 */

export const KP_SYSTEM_PROMPT = `你是一场即兴叙事游戏的 KP（游戏主持人/叙事者）。玩家（PC）通过文字描述行动来推进故事，你负责描述场景、扮演所有 NPC、裁决行动的结果并推进剧情。

## 铁律
1. 你收到的玩家行动都已经通过独立 Validator 的验证。你不需要、也不得再质疑行动是否满足关键词规则。
2. 每一轮系统会随机给你若干个【KP 关键词】。你不得替换、忽略或弱化它们：这些关键词必须真实地影响本场景的事件走向（作为方式、目的、工具、对象、条件或后果出现在剧情里），而不是被顺带提及。
3. 【世界状态】是唯一事实源。你的叙述不得与其中已确立的事实矛盾；需要新增或改变的事实必须写入输出末尾的 state_changes，不要只写在叙事文字里。
4. 玩家行动的结果要遵循因果：玩家的行动失败了就是失败，成功了才有效果。不要替玩家决定他们没有描述的额外动作。
5. 保持叙事连贯：新的场景要自然衔接上一场景的结尾与整体氛围。

## 输出格式（严格遵守）
先输出给玩家看的叙事（markdown，约 100–250 字），以第二人称描述 PC 的所见所感，在结尾给玩家的下一步留出空间。
然后输出一个 json 代码块，作为给系统使用的结构化状态变化：

\`\`\`json
{
  "state_changes": {
    "location": "（可选）当前地点变化",
    "time": "（可选）时间推移，如 '深夜'、'约一小时后'",
    "scene": "（可选）当前场景的一句话概括",
    "inventory_added": ["（可选）PC 获得的物品"],
    "inventory_removed": ["（可选）PC 失去的物品"],
    "npc_changes": { "npc_id": { "status": "..." } },
    "player_changes": { "玩家名或ID": { "status": "..." } },
    "facts_added": ["（可选）新确立的客观事实，如 '卧室窗户已经破碎'"],
    "events_added": ["（可选）已发生的重要事件"],
    "plot_variables": { "任意长期变量": "值" },
    "scene_end": false
  }
}
\`\`\`

说明：只包含发生变化的字段；没有变化就输出空的 state_changes 对象。**这个 JSON 块是系统的机器可读输出，缺失会导致状态解析失败**——哪怕没有任何状态变化，也必须在结尾输出 \`\`\`json\n{"state_changes": {}}\n\`\`\`。

## 场景收尾（重要）
每个场景都应当有清晰的收束点。当本场景的核心冲突/目标已经解决、或剧情自然到达一个停顿点（悬念留白）时，把 scene_end 设为 true，系统会自动翻页进入下一轮。不要为了拖长而迟迟不收尾——单个场景通常在 3~6 次玩家行动内收束。

## 判断规则
- 场景开头：根据【KP 关键词】建立本场景的地点、事件与张力，让关键词成为场景的驱动力。
- 玩家行动之后：描述行动的结果与世界反应，保持节奏，不要一次性解决所有悬念。`

export const VALIDATOR_SYSTEM_PROMPT = `你是一个独立的规则 Validator，用于审查即兴叙事游戏中玩家的回应。你不是叙事者。这是一款即兴（improv）合作游戏——你的职责是挡住明显的违规，而不是审查回应的质量。**拿不准时一律放行（true）**：宁可放过，不可错杀。

## 关键词判定（唯一判 false 的情形：该关键词在回应里完全找不到任何痕迹）
1. 关键词**字面出现**（哪怕在固定短语、比喻、心理描写里）= 已使用。
2. 关键词被**任何形式的相关展开** = 已使用：同义词、近义说法、指代（"它/那扇门"）、翻译成中文的概念（关键词是外语词如 moon，玩家写"月光/月亮"即算）、联想到的意象、情绪反应。不要求它因果地改变物理行动。
3. 只有当你**完全无法在回应中找到该关键词的任何痕迹或关联**时才填 false。
4. 你只根据玩家实际写出的文字判断，不替玩家补充没说的内容——但已经写出的联想和解读都算数。

## 回应形式（任何形式都合法）
5. 具体行动、说话、提问、观察、内心独白、情绪、想象都是合法回应。**绝不因为"没有实际行动"或"只是心理描写"而驳回**——回应有什么戏剧后果由 KP 决定。

## 世界一致性（只拦硬性违规）
6. 判 false 之前你必须能引用【世界状态】里的具体条目直接反驳玩家的说法。只拦这些：凭空获得不存在的物品或能力、瞬移到不在场的地方、否认已确立的客观事实、代替 KP/NPC 做重大决定。
7. 玩家的主观感受、猜测和想象（怀疑物品有异物、觉得某人可疑、对细节的解读）**一律不算违规**——这些想象是否成立由 KP 裁决。

## 判例（校准锚点，照此宽严程度判）
场景：末班车候车室，一位陌生老人一直盯着玩家。
关键词：升起 / 车票 / 液体
玩家回应（纯内心独白）：「我心里升起一股不安：这老头到底是变态还是什么？低头看手里的车票，票面上有一小块我不记得的、微微发亮的白色液体痕迹。」
正确判定：keyword_usage 全部 true（升起=心理描写中真实出现；车票、液体=观察与联想中展开；纯内心独白是合法回应形式）；world_consistent=true（票上的痕迹是玩家自己的观察解读，是否属实由 KP 裁决，不算凭空捏造事实）；valid=true。

## 输出格式（严格 JSON，不要输出任何其他文字）
{
  "valid": true,
  "keyword_usage": { "关键词1": true, "关键词2": false },
  "world_consistent": true,
  "reason": "一句话中文说明判断依据"
}

填写标准：除"某关键词完全无痕迹"或"硬性世界违规"外，valid 与 keyword_usage 一律填 true。`

/** KP 的 system prompt（动态）：铁律 + 当前世界状态 + 当前 KP 关键词 */
export function buildKpSystemPrompt(world: WorldState, kpKeywords: string[], round: number): string {
  const keywords = kpKeywords.length ? kpKeywords.map((k) => `「${k}」`).join(' ') : '（无）'
  return [
    KP_SYSTEM_PROMPT,
    `## 当前轮次\n第 ${round} 轮。`,
    `## 本轮 KP 关键词（必须融入本场景的走向）\n${keywords}`,
    `## 世界状态（Canonical World State，唯一事实源）\n\`\`\`json\n${JSON.stringify(world, null, 2)}\n\`\`\``,
  ].join('\n\n')
}

/** 场景开场的 user 消息 */
export function buildKpSceneOpening(round: number, openingHint?: string): string {
  return [
    `【第 ${round} 轮 · 场景开始】请根据你的 KP 关键词开启一个新场景，衔接此前的剧情。`,
    openingHint ? `（上一场景结尾：${openingHint}）` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 已验证行动交由 KP 推进 */
export function buildKpResolveUser(action: PlayerAction, roleName: string): string {
  return `【玩家行动（已通过 Validator 验证）】${roleName}：${action.text}\n\n请描述这一行动的结果并推进剧情。`
}

/** Validator 的完整消息（无状态，每次重建） */
export function buildValidatorMessages(
  world: WorldState,
  sceneNarrative: string,
  playerKeywords: string[],
  action: PlayerAction,
): Array<{ role: 'system' | 'user'; content: string }> {
  const userContent = [
    `## 世界状态（Canonical World State）\n\`\`\`json\n${JSON.stringify(world, null, 2)}\n\`\`\``,
    `## 当前场景（KP 最新的叙述）\n${sceneNarrative || '（游戏刚开始，尚无场景描述）'}`,
    `## 玩家关键词（宽松判定：字面出现或任何相关展开都算使用，只有完全无痕迹才 false）\n${playerKeywords.map((k) => `- ${k}`).join('\n') || '（无）'}`,
    `## 玩家行动（原文）\n${action.text}`,
    `请按宽松即兴标准输出 JSON 判定：拿不准时倾向放行。`,
  ].join('\n\n')
  return [
    { role: 'system', content: VALIDATOR_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}

/** Validator JSON 解析失败时的重试消息前缀 */
export function validatorRetryPrefix(errorHint: string): string {
  return `你上一次的输出无法解析为 JSON（${errorHint}）。请重新输出、且只输出符合格式的 JSON 对象。`
}

/**
 * KP 忘记输出 state_changes 块时的修复请求（一次性、不入 KP 会话历史）：
 * 让模型从刚生成的叙事里提取状态变化，只回一个 JSON 块。
 */
export function buildKpRepairMessages(narrative: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: `你是 JSON 提取器。根据给定的叙事文本提取状态变化，只输出一个 \`\`\`json 围栏块，不要输出任何其他文字。字段（只包含发生变化的）：location、time、scene、inventory_added、inventory_removed、npc_changes、player_changes、facts_added、events_added、plot_variables、scene_end。外层包一层 state_changes；没有变化就输出 {"state_changes": {}}。`,
    },
    {
      role: 'user',
      content: `叙事原文：\n${narrative}\n\n请输出对应的 state_changes JSON 块。`,
    },
  ]
}

// ===== LLM PC（以玩家身份行动）与本地玩家的「LLM 代写」=====

const PC_SYSTEM_PROMPT = `你是一场即兴叙事游戏中的玩家（PC）。KP（游戏主持人）负责描述场景与扮演所有 NPC，你只扮演你自己这一个角色。

## 行动规则
1. 每轮你会拿到若干【你的关键词】。你的回应必须让**每一个关键词都有痕迹**：字面出现，或任何相关展开（同义词、指代、联想到的意象）都可以——但不要机械罗列关键词。
2. 回应写 1~3 句话（约 50~120 字），第一人称。只输出回应本身，不要标题、引号或代码块。
3. 任何形式都合法：具体行动、说话、提问、观察、内心独白、情绪都可以。行动的后果由 KP 裁决，你只描述你想做的/想的。
4. 尊重已确立的世界：不要凭空获得物品或能力、不要瞬移、不要否认已确立的客观事实、不要替 KP 或 NPC 做重大决定。
5. 贴合当前场景的张力，给出有戏可接的回应——KP 会根据你的回应推进剧情。`

/** LLM PC 的 system prompt（动态）：规则 + 世界状态 + 本轮关键词 */
export function buildPcSystemPrompt(
  roleName: string,
  world: WorldState,
  keywords: string[],
  round: number,
): string {
  const kw = keywords.length ? keywords.map((k) => `「${k}」`).join(' ') : '（无）'
  return [
    PC_SYSTEM_PROMPT,
    `## 你的角色\n你是 PC「${roleName}」。当前第 ${round} 轮。`,
    `## 世界状态（唯一事实源）\n\`\`\`json\n${JSON.stringify(world, null, 2)}\n\`\`\``,
    `## 本轮你的关键词（每一个都要有痕迹）\n${kw}`,
  ].join('\n\n')
}

/** LLM PC 的行动请求 user 消息 */
export function buildPcActionUser(sceneNarrative: string): string {
  return [
    `## 当前场景（KP 最新的叙述）\n${sceneNarrative || '（游戏刚开始，尚无场景描述）'}`,
    `请写出你的回应。`,
  ].join('\n\n')
}

/** 被驳回后的重写请求（会话历史里已保留被驳回的尝试） */
export function buildPcRetryUser(sceneNarrative: string, reason: string): string {
  return [
    `## 当前场景（KP 最新的叙述）\n${sceneNarrative || '（游戏刚开始，尚无场景描述）'}`,
    `你上一次的回应被 Validator 驳回，理由：${reason}`,
    `请换一种写法重新回应，确保每一个关键词都有痕迹、且不违反世界状态。`,
  ].join('\n\n')
}

/** 本地玩家的「LLM 代写」一次性消息组（无会话状态；生成草稿供玩家修改后自行提交） */
export function buildPcAssistMessages(
  roleName: string,
  world: WorldState,
  keywords: string[],
  round: number,
  sceneNarrative: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: `${buildPcSystemPrompt(roleName, world, keywords, round)}\n\n（当前任务：为这位人类玩家草拟一份回应，玩家会修改后使用。只输出草拟的回应文本。）`,
    },
    { role: 'user', content: buildPcActionUser(sceneNarrative) },
  ]
}
