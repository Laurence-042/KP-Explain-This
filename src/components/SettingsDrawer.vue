<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { CopyDocument, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useModels } from '../composables/useModels'
import type { UseConfig } from '../composables/useConfig'

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

function copyKpConnection() {
  props.config.copyKpConnection()
  ElMessage.success(t('kpConnectionCopied'))
  void validatorModels.fetchModels()
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
      <el-form label-position="top">
        <el-form-item label="Base URL">
          <el-input v-model="config.form.kp.baseUrl" placeholder="https://api.example.com/v1" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="config.form.kp.apiKey" type="password" show-password />
        </el-form-item>
        <el-form-item :label="t('model')">
          <div class="model-row">
            <el-select
              v-model="config.form.kp.model"
              filterable
              allow-create
              default-first-option
              :placeholder="t('modelPlaceholder')"
              :loading="kpModels.modelsLoading.value"
              style="flex: 1"
            >
              <el-option v-for="m in kpModels.availableModels.value" :key="m" :label="m" :value="m" />
            </el-select>
            <el-button :icon="Refresh" @click="kpModels.fetchModels()" />
          </div>
        </el-form-item>
        <el-collapse class="advanced-collapse">
          <el-collapse-item :title="t('advanced')" name="adv">
            <el-form-item :label="t('temperature')">
              <el-input v-model="config.form.kp.temperature" placeholder="0.8" />
              <div class="form-hint">{{ t('temperatureHint') }}</div>
            </el-form-item>
            <el-form-item :label="t('maxTokens')">
              <el-input v-model="config.form.kp.maxTokens" placeholder="1024" />
              <div class="form-hint">{{ t('maxTokensHint') }}</div>
            </el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>

      <el-divider />

      <!-- Validator -->
      <div class="settings-section-head">
        <h4 class="settings-section-title">{{ t('validatorModelSection') }}</h4>
        <el-button size="small" :icon="CopyDocument" @click="copyKpConnection">
          {{ t('copyKpConnection') }}
        </el-button>
      </div>
      <p class="form-hint">{{ t('validatorModelHint') }}</p>
      <el-form label-position="top">
        <el-form-item label="Base URL">
          <el-input v-model="config.form.validator.baseUrl" placeholder="https://api.example.com/v1" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="config.form.validator.apiKey" type="password" show-password />
        </el-form-item>
        <el-form-item :label="t('model')">
          <div class="model-row">
            <el-select
              v-model="config.form.validator.model"
              filterable
              allow-create
              default-first-option
              :placeholder="t('modelPlaceholder')"
              :loading="validatorModels.modelsLoading.value"
              style="flex: 1"
            >
              <el-option v-for="m in validatorModels.availableModels.value" :key="m" :label="m" :value="m" />
            </el-select>
            <el-button :icon="Refresh" @click="validatorModels.fetchModels()" />
          </div>
        </el-form-item>
        <el-collapse class="advanced-collapse">
          <el-collapse-item :title="t('advanced')" name="adv">
            <el-form-item :label="t('temperature')">
              <el-input v-model="config.form.validator.temperature" placeholder="0.1" />
              <div class="form-hint">{{ t('validatorTemperatureHint') }}</div>
            </el-form-item>
            <el-form-item :label="t('maxTokens')">
              <el-input v-model="config.form.validator.maxTokens" placeholder="512" />
              <div class="form-hint">{{ t('maxTokensHint') }}</div>
            </el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
    </div>
  </el-drawer>
</template>
