import { describe, expect, it } from 'vitest'
import { asVerdict, verdictPass } from './validator'

const kws = ['knife', 'winter', 'debt']

describe('asVerdict', () => {
  it('完整合法输入', () => {
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

  it('keyword_usage 大小写不敏感匹配，缺失的关键词补 false', () => {
    const v = asVerdict(
      { valid: false, keyword_usage: { Knife: true }, world_consistent: true },
      kws,
    )!
    expect(v.keyword_usage).toEqual({ knife: true, winter: false, debt: false })
  })

  it('valid 缺失或类型错误返回 null', () => {
    expect(asVerdict({ keyword_usage: {} }, kws)).toBeNull()
    expect(asVerdict({ valid: 'yes' }, kws)).toBeNull()
    expect(asVerdict('junk', kws)).toBeNull()
  })

  it('reason 缺省时给出兜底文案', () => {
    const v = asVerdict({ valid: true, keyword_usage: {} }, kws)!
    expect(v.reason).toContain('未给出理由')
  })
})

describe('verdictPass', () => {
  const base = { valid: true, world_consistent: true, reason: '' }

  it('全部关键词使用且世界一致才通过', () => {
    expect(
      verdictPass({ ...base, keyword_usage: { knife: true, winter: true, debt: true } }),
    ).toBe(true)
  })

  it('任一关键词未使用则拒绝', () => {
    expect(
      verdictPass({ ...base, keyword_usage: { knife: true, winter: false, debt: true } }),
    ).toBe(false)
  })

  it('世界不一致或 valid=false 拒绝', () => {
    expect(
      verdictPass({
        valid: true,
        world_consistent: false,
        reason: '',
        keyword_usage: { knife: true, winter: true, debt: true },
      }),
    ).toBe(false)
    expect(
      verdictPass({
        valid: false,
        world_consistent: true,
        reason: '',
        keyword_usage: { knife: true, winter: true, debt: true },
      }),
    ).toBe(false)
  })
})
