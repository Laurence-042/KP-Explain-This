import { describe, expect, it } from 'vitest'
import { asVerdict, verdictPass } from './validator'

const kws = ['knife', 'winter', 'debt']

describe('asVerdict（宽松即兴标准）', () => {
  it('完整合法输入', () => {
    const v = asVerdict(
      {
        valid: true,
        keyword_usage: { knife: true, winter: true, debt: true },
        world_consistent: true,
        reason: 'ok',
      },
      kws,
      '我握着刀走过冬夜。',
    )
    expect(v).toEqual({
      valid: true,
      keyword_usage: { knife: true, winter: true, debt: true },
      world_consistent: true,
      reason: 'ok',
    })
  })

  it('关键词字面出现在行动里 ⇒ 强制算使用（模型判 false 也不算数）', () => {
    const v = asVerdict(
      {
        valid: false,
        keyword_usage: { knife: false, winter: false },
        world_consistent: true,
        reason: '模型觉得固定短语不算',
      },
      kws,
      '我攥紧手里的 knife，在 winter 的寒风里发抖。',
    )!
    // knife/winter：字面出现压过模型的 false；debt：模型没判定 → 视为使用
    expect(v.keyword_usage).toEqual({ knife: true, winter: true, debt: true })
  })

  it('字面匹配大小写不敏感', () => {
    const v = asVerdict(
      { valid: true, keyword_usage: { knife: false }, world_consistent: true },
      kws,
      '那把 KNIFE 就在桌上。',
    )!
    expect(v.keyword_usage.knife).toBe(true)
  })

  it('模型未判定的关键词视为已使用（缺席 ≠ 驳回）', () => {
    const v = asVerdict(
      { valid: false, keyword_usage: { Knife: true }, world_consistent: true },
      kws,
      '我往前走。',
    )!
    expect(v.keyword_usage).toEqual({ knife: true, winter: true, debt: true })
  })

  it('world_consistent 缺省视为一致，只有明确 false 才算不一致', () => {
    const v = asVerdict({ valid: true, keyword_usage: {} }, kws, '行动')!
    expect(v.world_consistent).toBe(true)
    const v2 = asVerdict(
      { valid: true, keyword_usage: {}, world_consistent: false },
      kws,
      '行动',
    )!
    expect(v2.world_consistent).toBe(false)
  })

  it('valid 缺失或类型错误返回 null', () => {
    expect(asVerdict({ keyword_usage: {} }, kws, 'x')).toBeNull()
    expect(asVerdict({ valid: 'yes' }, kws, 'x')).toBeNull()
    expect(asVerdict('junk', kws, 'x')).toBeNull()
  })

  it('reason 缺省时给出兜底文案', () => {
    const v = asVerdict({ valid: true, keyword_usage: {} }, kws, '行动')!
    expect(v.reason).toContain('未给出理由')
  })
})

describe('verdictPass（不参考 valid 聚合字段，以明细为准）', () => {
  const base = { valid: true, world_consistent: true, reason: '' }

  it('全部关键词使用且世界一致则通过', () => {
    expect(
      verdictPass({ ...base, keyword_usage: { knife: true, winter: true, debt: true } }),
    ).toBe(true)
  })

  it('任一关键词明确未使用且未字面出现则拒绝', () => {
    expect(
      verdictPass({ ...base, keyword_usage: { knife: true, winter: false, debt: true } }),
    ).toBe(false)
  })

  it('世界不一致拒绝', () => {
    expect(
      verdictPass({
        valid: true,
        world_consistent: false,
        reason: '',
        keyword_usage: { knife: true, winter: true, debt: true },
      }),
    ).toBe(false)
  })

  it('valid=false 但关键词与世界明细都通过 ⇒ 放行（聚合字段常被模型填得过严）', () => {
    expect(
      verdictPass({
        valid: false,
        world_consistent: true,
        reason: '',
        keyword_usage: { knife: true, winter: true, debt: true },
      }),
    ).toBe(true)
  })
})
