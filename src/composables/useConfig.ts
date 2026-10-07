import { reactive, watch } from 'vue'
import type { ConnectionConfig, GameConfig } from '../types'

const LS_CONFIG_KEY = 'kpet-config'

function defaultConnection(temperature: string): ConnectionConfig {
  return {
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature,
    maxTokens: '',
  }
}

function loadConnection(saved: unknown, fallback: ConnectionConfig): ConnectionConfig {
  const out = { ...fallback }
  if (typeof saved !== 'object' || saved === null) return out
  const s = saved as Partial<ConnectionConfig>
  if (typeof s.baseUrl === 'string') out.baseUrl = s.baseUrl
  if (typeof s.apiKey === 'string') out.apiKey = s.apiKey
  if (typeof s.model === 'string') out.model = s.model
  if (typeof s.temperature === 'string') out.temperature = s.temperature
  if (typeof s.maxTokens === 'string') out.maxTokens = s.maxTokens
  return out
}

/**
 * KP / Validator / LLM 玩家 三连接配置。
 * 各连接可以使用不同的 endpoint、key、模型与温度；Validator 与 LLM 玩家可一键复制 KP 连接。
 */
export function useConfig() {
  const form = reactive<GameConfig>({
    kp: defaultConnection('0.8'),
    validator: defaultConnection('0.1'),
    pcLlm: defaultConnection('0.8'),
  })

  function save() {
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ ...form }))
  }

  function load(): boolean {
    try {
      const raw = localStorage.getItem(LS_CONFIG_KEY)
      if (!raw) return false
      const saved = JSON.parse(raw) as Partial<GameConfig>
      form.kp = loadConnection(saved.kp, form.kp)
      form.validator = loadConnection(saved.validator, form.validator)
      // 旧配置没有 pcLlm 字段：保持默认（读取边界归一化）
      form.pcLlm = loadConnection(saved.pcLlm, form.pcLlm)
      return true
    } catch {
      return false
    }
  }

  /** 目标连接直接复用 KP 的 endpoint/key（模型与温度保持独立） */
  function copyKpConnection(target: 'validator' | 'pcLlm' = 'validator') {
    const dst = form[target]
    dst.baseUrl = form.kp.baseUrl
    dst.apiKey = form.kp.apiKey
    if (!dst.model) dst.model = form.kp.model
  }

  function connectionReady(c: ConnectionConfig): boolean {
    return Boolean(c.baseUrl.trim() && c.apiKey.trim() && c.model.trim())
  }

  watch(form, save, { deep: true })

  return { form, load, copyKpConnection, connectionReady }
}

export type UseConfig = ReturnType<typeof useConfig>
