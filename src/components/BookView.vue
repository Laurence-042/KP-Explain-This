<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookDocument, KeywordPick, RoleDef } from '../core/types'
import { pageCount } from '../core/book'

const props = defineProps<{
  role: RoleDef
  doc: BookDocument | undefined
  pageIndex: number
  /** 本轮骰子命中的词（offset/length 相对命中页页文本） */
  picks: KeywordPick[]
  /** 翻页动画触发计数 */
  flipTick: number
  /** KP 书页是否遮蔽 */
  blurred: boolean
}>()

const { t } = useI18n()
const flipping = ref(false)
let flipTimer: ReturnType<typeof setTimeout> | null = null

// 翻页动画不依赖 requestAnimationFrame（部分嵌入 webview 不触发 rAF）：
// :key 重挂载自动重放 CSS 动画，flipping 只负责 950ms 后移除覆盖层
watch(
  () => props.flipTick,
  (tick) => {
    if (!tick) return
    flipping.value = true
    if (flipTimer) clearTimeout(flipTimer)
    flipTimer = setTimeout(() => (flipping.value = false), 950)
  },
)

type Segment = { text: string; pick?: KeywordPick }

/** 当前页文本 + 关键词高亮分段（pick 直接携带页内偏移） */
const segments = computed<{ parts: Segment[]; pageText: string }>(() => {
  const doc = props.doc
  const index = props.pageIndex
  const text = doc?.pages[index]?.text ?? ''
  if (!text) return { parts: [], pageText: '' }

  const onPage = props.picks
    .filter((p) => p.pageIndex === index && p.offset >= 0 && p.offset + p.length <= text.length)
    .sort((a, b) => a.offset - b.offset)

  const parts: Segment[] = []
  let cursor = 0
  for (const hit of onPage) {
    if (hit.offset > cursor) parts.push({ text: text.slice(cursor, hit.offset) })
    parts.push({ text: text.slice(hit.offset, hit.offset + hit.length), pick: hit })
    cursor = hit.offset + hit.length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return { parts, pageText: text }
})

const totalPages = computed(() => (props.doc ? pageCount(props.doc) : 0))
</script>

<template>
  <div class="book-view">
    <div class="book-head">
      <span class="book-name">{{ doc?.name ?? '—' }}</span>
      <span class="book-owner">{{ role.name }} · {{ t('bookLabel') }}</span>
      <span class="book-page">
        {{ t('pageOf', { current: pageIndex + 1, total: totalPages }) }}
      </span>
    </div>
    <div class="book-page-body" :class="{ blurred: blurred }">
      <div v-if="doc && segments.pageText" class="book-text">
        <template v-for="(seg, i) in segments.parts" :key="i">
          <mark v-if="seg.pick" class="book-hit" :data-die="seg.pick.dieIndex + 1">
            <sup class="hit-die">{{ seg.pick.dieIndex + 1 }}</sup>{{ seg.text }}
          </mark>
          <template v-else>{{ seg.text }}</template>
        </template>
      </div>
      <div v-else class="book-empty">{{ t('bookEmpty') }}</div>
      <!-- 翻页动画：一张"纸"从右向左翻过 -->
      <div v-if="flipping" class="page-flip-sheet" :key="flipTick">
        <div class="page-flip-inner">{{ t('flippingText') }}</div>
      </div>
      <div v-if="blurred" class="book-blur-hint">{{ t('kpBookHidden') }}</div>
    </div>
  </div>
</template>
