import { describe, expect, it } from 'vitest'
import { buildSave, decodeSaveFile, encodeSaveFile, isValidSave } from './save'
import { createInitialWorld } from './world'

function minimalSave() {
  return buildSave(
    '测试局',
    {
      roles: [{ id: 'kp', name: 'KP', kind: 'kp', controller: 'llm', bookId: 'b1' }],
      diceCount: 3,
      round: 1,
      phase: 'await-action',
      pages: { kp: 0 },
      pendingNextPages: { kp: 0 },
      rolls: { kp: null },
      keywords: { kp: [] },
      world: createInitialWorld([]),
      log: [],
      currentSceneNarrative: '',
      sceneEndHint: false,
    },
    {
      params: { model: 'kp', temperature: 0.8, maxTokens: undefined, systemPrompt: '', summary: {
        autoSummary: true, summarizeAfter: 20, retainMessages: 8,
      } },
      messages: [],
      summaryText: '',
    },
    {
      params: { model: 'v', temperature: 0.1, maxTokens: undefined, systemPrompt: '', summary: {
        autoSummary: false, summarizeAfter: 20, retainMessages: 8,
      } },
      messages: [],
      summaryText: '',
    },
    [{ id: 'b1', name: '书', source: 'txt', pageWordCount: 300, text: '内容' }],
  )
}

describe('save', () => {
  it('构建 → 编码 → 解码往返', () => {
    const save = minimalSave()
    const decoded = decodeSaveFile(encodeSaveFile(save))
    expect(decoded).not.toBeNull()
    expect(decoded!.name).toBe('测试局')
    expect(decoded!.books[0].text).toBe('内容')
    expect(decoded!.engine.phase).toBe('await-action')
  })

  it('非法输入被拒绝', () => {
    expect(decodeSaveFile('not json')).toBeNull()
    expect(decodeSaveFile('{"app": "other"}')).toBeNull()
    const bad = { ...minimalSave(), version: 99 } as unknown
    expect(isValidSave(bad)).toBe(false)
    const noRoles = { ...minimalSave(), engine: { ...minimalSave().engine, roles: [] } } as unknown
    expect(isValidSave(noRoles)).toBe(false)
    const badSession = { ...minimalSave(), kpSession: { params: {} } } as unknown
    expect(isValidSave(badSession)).toBe(false)
  })
})
