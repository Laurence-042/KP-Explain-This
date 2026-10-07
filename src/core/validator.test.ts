import { describe, expect, it } from 'vitest'
import { asVerdict, verdictPass } from './validator'

const kws = ['knife', 'winter', 'debt']

describe('asVerdict（用人不疑：逐字采用模型结论）', () => {
  it('完整合法输入原样通过', () => {
    const v = asVerdict(
      {
        valid: true,
        keyword_usage: { knife: true, winter: true, debt: true },
        world_consistent: true,
        reason: 'ok',
      },
      kws,
    )
    expect(v).toEqual({
      valid: true,
      keyword_usage: { knife: true, winter: true, debt: true },
      world_consistent: true,
      reason: 'ok',
    })
  })

  it('模型判 false 就算 false——即使关键词字面出现在行动里也不改写', () => {
    // 校准只在 prompt 层做；代码不替模型翻案（用户产品决策：用人不疑）
    const v = asVerdict(
      {
        valid: false,
        keyword_usage: { knife: false, winter: false, debt: true },
        world_consistent: true,
        reason: '模型认为未实质使用',
      },
      kws,
    )!
    expect(v.keyword_usage).toEqual({ knife: false, winter: false, debt: true })
  })

  it('keyword_usage 大小写不敏感匹配 key，值原样采用', () => {
    const v = asVerdict(
      { valid: false, keyword_usage: { Knife: false, WINTER: true, debt: true }, world_consistent: true },
      kws,
    )!
    expect(v.keyword_usage).toEqual({ knife: false, winter: true, debt: true })
  })

  it('keyword_usage 缺关键词 → 判定不完整返回 null（不替模型猜）', () => {
    expect(asVerdict({ valid: true, keyword_usage: { knife: true }, world_consistent: true }, kws)).toBeNull()
  })

  it('world_consistent 缺失 → null；valid 缺失或类型错误 → null', () => {
    expect(asVerdict({ valid: true, keyword_usage: { knife: true } }, kws)).toBeNull()
    expect(asVerdict({ keyword_usage: {} }, kws)).toBeNull()
    expect(asVerdict({ valid: 'yes' }, kws)).toBeNull()
    expect(asVerdict('junk', kws)).toBeNull()
  })

  it('reason 缺省时给出兜底文案', () => {
    const v = asVerdict(
      { valid: true, keyword_usage: { knife: true, winter: true, debt: true }, world_consistent: true },
      kws,
    )!
    expect(v.reason).toContain('未给出理由')
  })
})

describe('verdictPass（三个结论字段都是模型给的）', () => {
  const usage = { knife: true, winter: true, debt: true }

  it('valid 且全部关键词使用且世界一致才通过', () => {
    expect(verdictPass({ valid: true, keyword_usage: usage, world_consistent: true, reason: '' })).toBe(true)
  })

  it('valid=false 拒绝', () => {
    expect(verdictPass({ valid: false, keyword_usage: usage, world_consistent: true, reason: '' })).toBe(false)
  })

  it('任一关键词 false 拒绝', () => {
    expect(
      verdictPass({
        valid: true,
        keyword_usage: { knife: true, winter: false, debt: true },
        world_consistent: true,
        reason: '',
      }),
    ).toBe(false)
  })

  it('世界不一致拒绝', () => {
    expect(
      verdictPass({ valid: true, keyword_usage: usage, world_consistent: false, reason: '' }),
    ).toBe(false)
  })
})
