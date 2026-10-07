<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { CopyDocument, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { ConnectionConfig } from '../types'
import type { useModels } from '../composables/useModels'

/** 设置抽屉里的一段连接配置表单（KP / Validator / LLM 玩家共用） */
const props = defineProps<{
  form: ConnectionConfig
  models: ReturnType<typeof useModels>
  /** 高级折叠区温度输入的占位与提示 */
  temperaturePlaceholder: string
  temperatureHintKey: string
  /** 是否显示「复制 KP 连接」按钮 */
  copyKp?: boolean
}>()

const emit = defineEmits<{
  (e: 'copy-kp'): void
}>()

const { t } = useI18n()

/** API Key 保持隐藏显示，但允许一键复制（会用 Key 的用户知道自己要做什么） */
async function copyApiKey(value: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(t('apiKeyCopied'))
  } catch {
    ElMessage.error(t('copyFailed'))
  }
}
</script>

<template>
  <el-form label-position="top">
    <el-form-item label="Base URL">
      <el-input v-model="form.baseUrl" placeholder="https://api.example.com/v1" />
    </el-form-item>
    <el-form-item label="API Key">
      <el-input v-model="form.apiKey" type="password" show-password>
        <template #append>
          <el-button :icon="CopyDocument" :title="t('copyApiKey')" @click="copyApiKey(form.apiKey)" />
        </template>
      </el-input>
    </el-form-item>
    <el-form-item :label="t('model')">
      <div class="model-row">
        <el-select
          v-model="form.model"
          filterable
          allow-create
          default-first-option
          :placeholder="t('modelPlaceholder')"
          :loading="models.modelsLoading.value"
          style="flex: 1"
        >
          <el-option v-for="m in models.availableModels.value" :key="m" :label="m" :value="m" />
        </el-select>
        <el-button :icon="Refresh" @click="models.fetchModels()" />
      </div>
    </el-form-item>
    <el-collapse class="advanced-collapse">
      <el-collapse-item :title="t('advanced')" name="adv">
        <el-form-item :label="t('temperature')">
          <el-input v-model="form.temperature" :placeholder="temperaturePlaceholder" />
          <div class="form-hint">{{ t(temperatureHintKey) }}</div>
        </el-form-item>
        <el-form-item :label="t('maxTokens')">
          <el-input v-model="form.maxTokens" placeholder="1024" />
          <div class="form-hint">{{ t('maxTokensHint') }}</div>
        </el-form-item>
      </el-collapse-item>
    </el-collapse>
    <el-button v-if="copyKp" size="small" :icon="CopyDocument" @click="emit('copy-kp')">
      {{ t('copyKpConnection') }}
    </el-button>
  </el-form>
</template>
