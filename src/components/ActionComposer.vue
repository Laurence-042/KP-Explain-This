<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Promotion, RefreshRight, VideoPause } from '@element-plus/icons-vue'

const props = defineProps<{
  /** 是否可以提交行动（await-action 阶段） */
  canSubmit: boolean
  /** 引擎忙碌（KP/Validator 运行中） */
  running: boolean
  /** 可以发起重骰（等待行动或生成中断时） */
  canReroll: boolean
  /** 生成被中断，等待重试/重骰决定 */
  interrupted: boolean
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'reroll'): void
  (e: 'retry'): void
  (e: 'abort'): void
}>()

const { t } = useI18n()
const draft = ref('')
const isComposing = ref(false)

function send() {
  if (!props.canSubmit) return
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (event.shiftKey) return
  if (isComposing.value || event.isComposing) return
  event.preventDefault()
  send()
}
</script>

<template>
  <div class="action-composer">
    <el-input
      v-model="draft"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 6 }"
      :placeholder="t('actionPlaceholder')"
      :disabled="running || interrupted"
      resize="none"
      @keydown="onKeydown"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false"
    />
    <div class="composer-buttons">
      <template v-if="interrupted">
        <el-button type="warning" :icon="RefreshRight" @click="$emit('retry')">
          {{ t('retryInterrupted') }}
        </el-button>
        <el-button type="danger" plain :icon="RefreshRight" @click="$emit('reroll')">
          {{ t('rerollScene') }}
        </el-button>
      </template>
      <template v-else>
        <el-tooltip v-if="running" :content="t('abortHint')" placement="top">
          <el-button type="danger" plain :icon="VideoPause" @click="$emit('abort')">
            {{ t('abort') }}
          </el-button>
        </el-tooltip>
        <el-tooltip
          v-if="canReroll && !running"
          :content="t('rerollHint')"
          placement="top"
          :show-after="300"
        >
          <el-button :icon="RefreshRight" @click="$emit('reroll')">
            {{ t('rerollScene') }}
          </el-button>
        </el-tooltip>
        <el-button type="success" size="large" :icon="Promotion" :disabled="!canSubmit" @click="send">
          {{ t('submitAction') }}
        </el-button>
      </template>
    </div>
  </div>
</template>
