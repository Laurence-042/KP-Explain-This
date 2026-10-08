import { describe, expect, it } from 'vitest'
import { createInitialWorld } from './world'
import { buildKpRepairMessages, buildKpSceneOpening, buildKpSystemPrompt, buildPcActionUser, buildValidatorMessages } from './prompts'

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

  it('后行动玩家与下一轮 KP 都看到前序行动，但不预设结果', () => {
    const actions = [{ roleId: 'pc-a', roleName: '玩家A', text: '我试着推开门。' }]
    const pcPrompt = buildPcActionUser('门外有脚步声。', actions)
    const validatorPrompt = buildValidatorMessages(world, '门外有脚步声。', ['钥匙'], { roleId: 'pc-b', text: '我听着脚步声。' }, actions)[1].content
    const kpPrompt = buildKpSceneOpening(2, '门外有脚步声。', actions)
    for (const prompt of [pcPrompt, validatorPrompt, kpPrompt]) {
      expect(prompt).toContain('玩家A（角色 ID：pc-a）：我试着推开门。')
      expect(prompt).toContain('不代表已经成功')
    }
  })
})
