<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useModels } from '../composables/useModels'
import type { UseConfig } from '../composables/useConfig'
import ConnectionSection from './ConnectionSection.vue'

const props = defineProps<{
  modelValue: boolean
  config: UseConfig
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const { t } = useI18n()
const kpModels = useModels(toRef(props.config.form, 'kp'))
const validatorModels = useModels(toRef(props.config.form, 'validator'))
const pcLlmModels = useModels(toRef(props.config.form, 'pcLlm'))

function copyKpTo(target: 'validator' | 'pcLlm') {
  props.config.copyKpConnection(target)
  ElMessage.success(t('kpConnectionCopied'))
  void (target === 'validator' ? validatorModels : pcLlmModels).fetchModels()
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="t('settings')"
    size="440px"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="settings-body">
      <!-- KP -->
      <h4 class="settings-section-title">{{ t('kpModelSection') }}</h4>
      <p class="form-hint">{{ t('kpModelHint') }}</p>
      <ConnectionSection
        :form="config.form.kp"
        :models="kpModels"
        temperature-placeholder="0.8"
        temperature-hint-key="temperatureHint"
      />

      <el-divider />

      <!-- Validator -->
      <h4 class="settings-section-title">{{ t('validatorModelSection') }}</h4>
      <p class="form-hint">{{ t('validatorModelHint') }}</p>
      <ConnectionSection
        :form="config.form.validator"
        :models="validatorModels"
        temperature-placeholder="0.1"
        temperature-hint-key="validatorTemperatureHint"
        copy-kp
        @copy-kp="copyKpTo('validator')"
      />

      <el-divider />

      <!-- LLM 玩家（独立 LLM PC 与「LLM 代写」共用） -->
      <h4 class="settings-section-title">{{ t('pcLlmSection') }}</h4>
      <p class="form-hint">{{ t('pcLlmHint') }}</p>
      <ConnectionSection
        :form="config.form.pcLlm"
        :models="pcLlmModels"
        temperature-placeholder="0.8"
        temperature-hint-key="temperatureHint"
        copy-kp
        @copy-kp="copyKpTo('pcLlm')"
      />
    </div>
  </el-drawer>
</template>
