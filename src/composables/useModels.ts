import { ref, watch, type Ref } from 'vue'
import type { ConnectionConfig } from '../types'

/** 对任意一个连接配置拉取模型列表（设置抽屉里 KP / Validator 各一份实例） */
export function useModels(config: Ref<ConnectionConfig>) {
  const availableModels = ref<string[]>([])
  const modelsLoading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function fetchModels() {
    const baseUrl = config.value.baseUrl.trim()
    const apiKey = config.value.apiKey.trim()
    if (!baseUrl || !apiKey) {
      availableModels.value = []
      return
    }
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
    modelsLoading.value = true
    try {
      const response = await fetch(`${base}models`, {
        headers: { Authorization: 'Bearer ' + apiKey },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as { data?: Array<{ id?: unknown }> }
      availableModels.value = (data?.data ?? [])
        .map((m) => (typeof m?.id === 'string' ? m.id : ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
      if (!config.value.model && availableModels.value.length > 0) {
        config.value.model = availableModels.value[0]
      }
    } catch {
      availableModels.value = []
    } finally {
      modelsLoading.value = false
    }
  }

  watch(
    () => [config.value.baseUrl, config.value.apiKey] as const,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fetchModels, 600)
    },
  )

  return { availableModels, modelsLoading, fetchModels }
}
