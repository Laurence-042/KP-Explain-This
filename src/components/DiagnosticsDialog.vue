<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LlmDiagnostics } from '../core/llm/client'

defineProps<{
  modelValue: boolean
  diagnostics: LlmDiagnostics | null
  formatDiagnostics: (d: LlmDiagnostics) => string
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'copyDiagnostics'): void
}>()

const { t } = useI18n()
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('diagnosticsTitle')"
    width="min(560px, 92vw)"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="diagnostics-intro">{{ t('requestFailedHint') }}</p>
    <pre v-if="diagnostics" class="diagnostics-block">{{ formatDiagnostics(diagnostics) }}</pre>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ t('close') }}</el-button>
      <el-button type="primary" :disabled="!diagnostics" @click="$emit('copyDiagnostics')">
        {{ t('copyDiagnostics') }}
      </el-button>
    </template>
  </el-dialog>
</template>
