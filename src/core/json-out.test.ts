import { describe, expect, it } from 'vitest'
import {
  findLastTopLevelObject,
  narrativeViewForStream,
  parseKpOutput,
  parseVerdictJson,
} from './json-out'

describe('findLastTopLevelObject', () => {
  it('找到嵌套对象的最外层区间', () => {
    const text = '前置说明 {"a": {"b": 1}} 后缀'
    const span = findLastTopLevelObject(text)!
    expect(text.slice(span.start, span.end)).toBe('{"a": {"b": 1}}')
  })

  it('字符串中的大括号不算边界', () => {
    const text = '{"a": "包含 } 和 { 的文本"}'
    const span = findLastTopLevelObject(text)!
    expect(text.slice(span.start, span.end)).toBe(text)
  })

  it('取最后一个完整对象', () => {
    const text = '{"a":1} 中间文字 {"b":2}'
    const span = findLastTopLevelObject(text)!
    expect(text.slice(span.start, span.end)).toBe('{"b":2}')
  })

  it('没有对象时返回 null', () => {
    expect(findLastTopLevelObject('纯文本没有大括号')).toBeNull()
  })
})

describe('parseKpOutput', () => {
  it('标准形态：叙事 + ```json 围栏', () => {
    const raw =
      '你撬开冻住的窗框逃进小巷。\n\n```json\n{"location": "back alley", "facts_added": ["窗户已碎"]}\n```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('你撬开冻住的窗框逃进小巷。')
    expect(out.stateChangesRaw).toEqual({ location: 'back alley', facts_added: ['窗户已碎'] })
    expect(out.warnings).toEqual([])
  })

  it('无 json 标签的围栏也能识别', () => {
    const raw = '叙事文本。\n\n```\n{"scene_end": true}\n```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('叙事文本。')
    expect(out.stateChangesRaw).toEqual({ scene_end: true })
  })

  it('大写 ```JSON 标签能识别', () => {
    const raw = '雪夜开场。\n\n```JSON\n{"location": "小巷"}\n```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('雪夜开场。')
    expect(out.stateChangesRaw).toEqual({ location: '小巷' })
  })

  it('标签与内容同行（```json{...}）能识别', () => {
    const raw = '叙事。```json{"scene": "逃跑"}```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('叙事。')
    expect(out.stateChangesRaw).toEqual({ scene: '逃跑' })
  })

  it('围栏内夹带说明文字再接 JSON 对象也能识别', () => {
    const raw = '叙事。\n\n```json\n状态变化如下：\n{"facts_added": ["窗碎了"]}\n```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('叙事。')
    expect(out.stateChangesRaw).toEqual({ facts_added: ['窗碎了'] })
  })

  it('叙事中的普通代码块（非 JSON 对象）不影响解析', () => {
    const raw = '他画了示意图：\n```\n+---+\n| x |\n+---+\n```\n结尾。\n\n```json\n{"scene_end": true}\n```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toContain('示意图')
    expect(out.narrative).toContain('结尾。')
    expect(out.stateChangesRaw).toEqual({ scene_end: true })
  })

  it('尾逗号 JSON 被修复', () => {
    const raw = '叙事。\n```json\n{"facts_added": ["a",],}\n```'
    const out = parseKpOutput(raw)
    expect(out.stateChangesRaw).toEqual({ facts_added: ['a'] })
  })

  it('无围栏但结尾是裸 JSON 对象（含已知键）', () => {
    const raw = ' KP 叙事一段。\n\n{"location": "仓库", "scene_end": false}'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('KP 叙事一段。')
    expect(out.stateChangesRaw).toEqual({ location: '仓库', scene_end: false })
  })

  it('叙事中普通大括号不会被误判为 JSON', () => {
    const raw = '他低声说 {什么也没说} 然后离开。'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe(raw)
    expect(out.stateChangesRaw).toBeNull()
    expect(out.warnings.some((w) => w.includes('没有找到'))).toBe(true)
  })

  it('围栏 JSON 损坏时给出 warning，叙事保留', () => {
    const raw = '叙事完好。\n```json\n{broken json!!\n```'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('叙事完好。')
    expect(out.stateChangesRaw).toBeNull()
    expect(out.warnings.some((w) => w.includes('解析'))).toBe(true)
  })

  it('流式截断的未闭合围栏', () => {
    const raw = '叙事开头。\n```json\n{"location": "小巷"'
    const out = parseKpOutput(raw)
    expect(out.narrative).toBe('叙事开头。')
    expect(out.stateChangesRaw).toEqual({ location: '小巷' })
  })

  it('空输出', () => {
    const out = parseKpOutput('   ')
    expect(out.narrative).toBe('')
    expect(out.stateChangesRaw).toBeNull()
    expect(out.warnings.length).toBeGreaterThan(0)
  })
})

describe('parseVerdictJson', () => {
  it('裸 JSON', () => {
    expect(parseVerdictJson('{"valid": true, "reason": "ok"}')).toEqual({
      valid: true,
      reason: 'ok',
    })
  })

  it('带前后缀说明文字 + 围栏', () => {
    const raw = '判定结果：\n```json\n{"valid": false}\n```'
    expect(parseVerdictJson(raw)).toEqual({ valid: false })
  })

  it('前缀说明 + 裸 JSON', () => {
    expect(parseVerdictJson('结果如下 {"valid": true}')).toEqual({ valid: true })
  })

  it('完全无法解析返回 null', () => {
    expect(parseVerdictJson('这不是 JSON')).toBeNull()
  })
})

describe('narrativeViewForStream', () => {
  it('围栏出现后截掉 JSON 部分', () => {
    const raw = '叙事继续。\n```json\n{"location": "小'
    expect(narrativeViewForStream(raw)).toBe('叙事继续。\n')
  })

  it('没有围栏时原样返回', () => {
    expect(narrativeViewForStream('普通叙事 {不是json}')).toBe('普通叙事 {不是json}')
  })
})
