/** UI 层类型（core 类型见 src/core/types.ts） */

export type ConnectionConfig = {
  /** OpenAI 兼容 base URL，如 https://api.example.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  temperature: string
  maxTokens: string
}

export type GameConfig = {
  kp: ConnectionConfig
  validator: ConnectionConfig
}

export function parseTemperature(raw: string): number | undefined {
  const value = Number(raw.trim())
  if (!Number.isFinite(value) || value < 0 || value > 2) return undefined
  return value
}

export function parseMaxTokens(raw: string): number | undefined {
  const value = Number(raw.trim())
  if (!Number.isFinite(value)) return undefined
  const intVal = Math.floor(value)
  if (intVal < 1) return undefined
  return intVal
}
