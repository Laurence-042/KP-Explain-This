import { describe, expect, it } from 'vitest'
import { buildSave, decodeSaveFile, encodeSaveFile, isValidSave } from './save'
import { createInitialWorld } from './world'

const fakeSession = (model: string) => ({
  params: {
    model,
    temperature: 0.8,
    maxTokens: undefined,
    systemPrompt: '',
    summary: { autoSummary: true, summarizeAfter: 20, retainMessages: 8 },
  },
  messages: [{ role: 'user' as const, content: 'hi' }],
  summaryText: '',
})

function minimalSave() {
  return buildSave({
    name: '测试局',
    engine: {
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
    kpSession: fakeSession('kp'),
    validatorSession: fakeSession('v'),
    books: [{ id: 'b1', name: '书', source: 'txt', pageWordCount: 300, text: '内容' }],
  })
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

  it('pcSessions（LLM PC 会话）随档保存并往返', () => {
    const save = minimalSave()
    save.pcSessions = { 'pc-llm-1': fakeSession('pc') }
    const decoded = decodeSaveFile(encodeSaveFile(save))
    expect(decoded).not.toBeNull()
    expect(decoded!.pcSessions!['pc-llm-1'].params.model).toBe('pc')
    expect(decoded!.pcSessions!['pc-llm-1'].messages).toHaveLength(1)
  })

  it('旧档没有 pcSessions 字段照常通过（向后兼容）；坏结构被拒绝', () => {
    const noPc = minimalSave()
    expect(noPc.pcSessions).toBeUndefined()
    expect(decodeSaveFile(encodeSaveFile(noPc))).not.toBeNull()
    // vite build 产物不涉及；直接构造旧形态 JSON
    const legacyRaw = JSON.stringify({ ...noPc })
    expect(decodeSaveFile(legacyRaw)).not.toBeNull()

    const badPc = { ...minimalSave(), pcSessions: { 'pc-llm-1': { params: {} } } } as unknown
    expect(isValidSave(badPc)).toBe(false)
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
