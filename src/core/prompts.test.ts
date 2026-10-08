import { describe, expect, it } from 'vitest'
import { createInitialWorld } from './world'
import { buildKpRepairMessages, buildKpSystemPrompt } from './prompts'

describe('KP 状态变化提示', () => {
  const world = createInitialWorld([
    { id: 'pc-a', name: '玩家A' },
    { id: 'pc-b', name: '玩家B' },
  ])

  it('主提示给出中性结构示例和实际可用角色 ID', () => {
    const prompt = buildKpSystemPrompt(world, ['关键词甲'], 1)
    expect(prompt).toContain('以下只演示 JSON 结构，不提供剧情、道具或状态建议')
    expect(prompt).toContain('"pc-a" = 玩家A')
    expect(prompt).toContain('"pc-b" = 玩家B')
    expect(prompt).toContain('inventory_changes')
  })

  it('修复提示携带角色 ID 与当前行动者，避免凭空猜测归属', () => {
    const opening = buildKpRepairMessages('叙事', world)
    expect(opening[1].content).toContain('当前行动者：（无）')
    expect(opening[1].content).toContain('"pc-b" = 玩家B')

    const response = buildKpRepairMessages('叙事', world, 'pc-b')
    expect(response[1].content).toContain('当前行动者：pc-b')
  })
})
