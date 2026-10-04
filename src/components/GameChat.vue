<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { GameLogEntry } from '../core/types'

marked.use({
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : ''
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

function renderMd(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string, {
    ADD_ATTR: ['target', 'rel'],
  })
}

const props = defineProps<{
  log: GameLogEntry[]
  /** 流式叙事（已截掉 JSON 围栏），空串表示非流式状态 */
  streaming: string
  running: boolean
  phase: string
}>()

const { t } = useI18n()
const panelRef = ref<HTMLElement | null>(null)
const isAtBottom = ref(true)
const BOTTOM_THRESHOLD = 28

function isScrolledToBottom(): boolean {
  const el = panelRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
}

function onScroll() {
  isAtBottom.value = isScrolledToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    const el = panelRef.value
    if (!el) return
    el.scrollTop = el.scrollHeight
    isAtBottom.value = true
  })
}

watch(
  () => [props.log, props.streaming, props.running, props.phase] as const,
  () => {
    if (isAtBottom.value) scrollToBottom()
  },
  { deep: true },
)

/** 一条日志的显示标签（场景/行动的作者） */
function actorLabel(entry: GameLogEntry): string {
  if (entry.type === 'scene') return entry.opening ? t('kpSceneOpening') : t('kpNarrative')
  if (entry.type === 'action') return entry.roleName
  return ''
}
</script>

<template>
  <div ref="panelRef" class="chat-panel" @scroll.passive="onScroll">
    <div v-if="log.length === 0 && !streaming && !running" class="empty">{{ t('emptyGame') }}</div>

    <template v-for="entry in log" :key="entry.id">
      <!-- 轮次分隔 -->
      <div v-if="entry.type === 'round'" class="round-divider">
        <span>{{ t('roundLabel', { n: entry.round }) }}</span>
      </div>

      <!-- 系统事件 -->
      <div v-else-if="entry.type === 'system'" class="system-entry">
        <div class="system-chip">{{ entry.text }}</div>
      </div>

      <!-- 警告 -->
      <el-alert
        v-else-if="entry.type === 'warning'"
        class="log-warning"
        type="warning"
        :title="entry.text"
        :closable="false"
        show-icon
      />

      <!-- Validator 判定 -->
      <div v-else-if="entry.type === 'verdict'" class="verdict-entry">
        <div class="verdict-card" :class="entry.ok ? 'passed' : 'rejected'">
          <div class="verdict-title">
            {{ entry.ok ? t('verdictPassed') : t('verdictRejected') }} · {{ t('validatorName') }}
          </div>
          <div>{{ entry.reason }}</div>
          <div v-if="!entry.ok" class="verdict-keywords">
            <el-tag
              v-for="(used, kw) in entry.keywordUsage"
              :key="kw"
              :type="used ? 'success' : 'danger'"
              size="small"
              class="keyword-tag"
            >
              {{ kw }} {{ used ? '✓' : '✗' }}
            </el-tag>
          </div>
          <div v-if="entry.ok && !entry.worldConsistent" class="verdict-note">
            {{ t('worldInconsistentNote') }}
          </div>
        </div>
      </div>

      <!-- 玩家行动 -->
      <div v-else-if="entry.type === 'action'" class="message user">
        <div class="message-content">
          <div class="message-author">{{ entry.roleName }}</div>
          <div class="bubble">{{ entry.text }}</div>
        </div>
      </div>

      <!-- KP 叙事 -->
      <div v-else-if="entry.type === 'scene'" class="message assistant">
        <div class="message-content">
          <div class="message-author">{{ actorLabel(entry) }}</div>
          <div class="bubble md-bubble" v-html="renderMd(entry.narrative)" />
        </div>
      </div>
    </template>

    <!-- Validator 判定中 -->
    <div v-if="phase === 'validating'" class="system-entry">
      <div class="system-chip validating-chip">
        <span class="typing-dots"><i></i><i></i><i></i></span>
        {{ t('validating') }}
      </div>
    </div>

    <!-- KP 流式 / 等待 -->
    <div v-if="phase === 'kp-scene' || phase === 'kp-resolve'" class="message assistant">
      <div class="message-content">
        <div class="message-author">{{ phase === 'kp-scene' ? t('kpSceneOpening') : t('kpNarrative') }}</div>
        <div v-if="streaming" class="bubble md-bubble" v-html="renderMd(streaming)" />
        <div v-else class="bubble typing-bubble">
          <span class="typing-dots"><i></i><i></i><i></i></span>
        </div>
      </div>
    </div>
  </div>
</template>
