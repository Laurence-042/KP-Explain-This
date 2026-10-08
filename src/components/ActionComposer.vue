<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { MagicStick, Promotion, RefreshRight, VideoPause } from '@element-plus/icons-vue'

const props = defineProps<{
  /** 是否可以提交行动（await-action 阶段且无 LLM PC 在生成） */
  canSubmit: boolean
  /** 引擎忙碌（KP/Validator 运行中） */
  running: boolean
  /** 可以发起重骰（等待行动或生成中断时） */
  canReroll: boolean
  /** 生成被中断，等待重试/重骰决定 */
  interrupted: boolean
  /** 正在生成行动的 LLM PC 名字（空 = 无） */
  pcActing: string
  /** 「LLM 代写」进行中 */
  assisting: boolean
  /** 代写草稿注入（seq 变化时合并进输入框） */
  assistInsert: { seq: number; text: string } | null
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'reroll'): void
  (e: 'retry'): void
  (e: 'abort'): void
  (e: 'assist'): void
}>()

const { t } = useI18n()
const draft = ref('')
const isComposing = ref(false)
const textareaRef = ref<{ focus: () => void } | null>(null)

// 代写草稿填入输入框（覆盖旧草稿），玩家可继续编辑后手动提交
watch(
  () => props.assistInsert?.seq,
  () => {
    const insert = props.assistInsert
    if (!insert?.text) return
    draft.value = insert.text
    void nextTick(() => textareaRef.value?.focus())
  },
)

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
    <div v-if="pcActing" class="pc-acting-chip">
      <span class="typing-dots"><i></i><i></i><i></i></span>
      {{ t('pcActingChip', { name: pcActing }) }}
    </div>
    <el-input
      ref="textareaRef"
      v-model="draft"
      type="textarea"
      :aria-label="t('actionLabel')"
      :autosize="{ minRows: 2, maxRows: 6 }"
      :placeholder="t('actionPlaceholder')"
      :disabled="running || interrupted || Boolean(pcActing)"
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
        <el-tooltip :content="t('assistHint')" placement="top" :show-after="300">
          <el-button
            :icon="MagicStick"
            :loading="assisting"
            :disabled="!canSubmit || assisting"
            @click="$emit('assist')"
          >
            {{ t('assistDraft') }}
          </el-button>
        </el-tooltip>
        <el-tooltip :content="t('actionKeys')" placement="top" :show-after="300">
          <el-button type="success" size="large" :icon="Promotion" :disabled="!canSubmit" @click="send">
            {{ t('submitAction') }}
          </el-button>
        </el-tooltip>
      </template>
    </div>
  </div>
</template>
