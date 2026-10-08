<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookDocument, KeywordPick, RoleDef, RoundRoll } from '../core/types'
import { pageCount } from '../core/book'
import { diceInPageOrder, diceToNumber } from '../core/randomizer'
import BookPageText from './BookPageText.vue'
import type { PageTextHit } from './bookPageText'

const props = defineProps<{
  role: RoleDef
  doc: BookDocument | undefined
  pageIndex: number
  /** 本轮骰子命中的词（offset/length 相对命中页页文本） */
  picks: KeywordPick[]
  /** 本轮掷骰同时夹下的下一页书签 */
  roll: RoundRoll | null
  showBookmark: boolean
  /** 翻页动画触发计数 */
  flipTick: number
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
onBeforeUnmount(() => {
  if (flipTimer) clearTimeout(flipTimer)
})

const currentText = computed(() => props.doc?.pages[props.pageIndex]?.text ?? '')
const pageHits = computed<PageTextHit[]>(() => props.picks
  .filter((pick) => pick.pageIndex === props.pageIndex)
  .map((pick) => ({
    dieIndex: pick.dieIndex,
    dieValue: pick.dieValue,
    offset: pick.offset,
    length: pick.length,
  })))
const totalPages = computed(() => (props.doc ? pageCount(props.doc) : 0))
const facingText = computed(() => props.doc?.pages[props.pageIndex - 1]?.text ?? '')
const bookmark = computed(() => {
  if (!props.roll || totalPages.value === 0) return null
  const orderedDice = diceInPageOrder(props.roll.dice, props.roll.picks)
  const number = diceToNumber(orderedDice)
  return {
    dice: orderedDice,
    digits: orderedDice.map((d) => d % 10).join(''),
    number,
    modPage: number % totalPages.value,
    nextPage: props.roll.nextPageIndex,
  }
})
</script>

<template>
  <div class="book-station">
    <div class="book-view">
      <div class="book-head">
        <span class="book-owner">{{ t('bookOwner', { name: role.name }) }}</span>
        <span class="book-page">
          {{ t('pageOf', { current: pageIndex + 1, total: totalPages }) }}
        </span>
      </div>
      <div class="book-spread">
        <div class="book-facing-page" aria-hidden="true">
          <BookPageText class="book-text" :text="facingText" />
        </div>
        <div class="book-page-body">
          <BookPageText v-if="currentText" class="book-text" :text="currentText" :hits="pageHits" />
          <div v-else class="book-empty">{{ t('bookEmpty') }}</div>
        </div>
        <!-- 翻页纸张在双页展开层上旋转 -->
        <div v-if="flipping" class="page-flip-sheet" :key="flipTick">
          <div class="page-flip-front">{{ t('flippingText') }}</div>
          <div class="page-flip-back" />
        </div>
      </div>
      <div class="book-foot">{{ doc?.name ?? '—' }}</div>
      <div v-if="showBookmark && bookmark" class="book-bookmark" role="group" tabindex="0" :aria-label="t('bookmark.how')">
        <div class="bookmark-tab">
          <span>{{ t('bookmark.afterScene') }}</span>
          <strong>{{ t('bookmark.page', { n: bookmark.nextPage + 1 }) }}</strong>
        </div>
        <div class="bookmark-explain">
          <strong>{{ t('bookmark.how') }}</strong>
          <div>{{ t('bookmark.faces', { faces: bookmark.dice.join(' · ') }) }}</div>
          <div>{{ t('bookmark.digits', { digits: bookmark.digits, number: bookmark.number }) }}</div>
          <div>{{ t('diceOverlay.modFormula', { num: bookmark.number, total: totalPages, remainder: bookmark.modPage, page: bookmark.modPage + 1 }) }}</div>
          <div v-if="bookmark.modPage !== bookmark.nextPage">
            {{ t('diceOverlay.mappedNote', { from: bookmark.modPage + 1, to: bookmark.nextPage + 1 }) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
