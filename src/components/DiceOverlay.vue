<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiceOverlayEntry, DiceOverlayState } from '../composables/useGame'
import BookPageText from './BookPageText.vue'
import type { PageTextHit } from './bookPageText'

/**
 * 掷骰演出：真渲染一本带封皮/书脊/内页的实体书，骰子从空中翻滚落下、
 * 停在命中的单词上（词位在渲染后用 getBoundingClientRect 实测，
 * 全程不依赖 rAF，动画均为 CSS keyframes）。
 * 只演出当前视角角色；开局依次演出封面初掷与翻开页掷骰。
 */

const props = defineProps<{
  state: DiceOverlayState
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()

const FACES = [1, 6, 3, 4, 5, 2]

const activeIndex = ref(0)
const bookRef = ref<HTMLElement | null>(null)
const diceSpots = ref<Array<{ left: string; top: string; delay: string; value: number }>>([])
let timers: ReturnType<typeof setTimeout>[] = []

const entry = computed<DiceOverlayEntry | undefined>(
  () => props.state.entries[activeIndex.value],
)

function clearTimers(): void {
  timers.forEach((t2) => clearTimeout(t2))
  timers = []
}

/** 渲染后测量落词位置，把骰子绝对定位到词上方 */
async function play(index: number): Promise<void> {
  activeIndex.value = index
  diceSpots.value = []
  await nextTick()
  const e = props.state.entries[index]
  if (e) measureDice(e)
  const total = props.state.entries.length
  timers.push(
    setTimeout(() => {
      if (!props.state.visible) return
      if (index + 1 < total) void play(index + 1)
      else emit('close')
    }, 3600),
  )
}

function measureDice(e: DiceOverlayEntry): void {
  const book = bookRef.value
  if (!book) return
  const bookRect = book.getBoundingClientRect()
  const page = book.querySelector<HTMLElement>('.stage-page')
  const marks = [...book.querySelectorAll<HTMLElement>('[data-land]')]
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

  // 长页也保持在书框内；若命中词能同屏显示，先把它们一同滚入页框。
  if (page && marks.length) {
    const pageRect = page.getBoundingClientRect()
    const positions = marks.map((mark) => {
      const rect = mark.getBoundingClientRect()
      return { top: rect.top - pageRect.top + page.scrollTop, bottom: rect.bottom - pageRect.top + page.scrollTop }
    })
    const first = positions[0].top
    const min = Math.min(...positions.map((p) => p.top))
    const max = Math.max(...positions.map((p) => p.bottom))
    const target = max - min <= page.clientHeight
      ? (min + max - page.clientHeight) / 2
      : first - page.clientHeight / 3
    page.scrollTop = clamp(target, 0, page.scrollHeight - page.clientHeight)
  }

  diceSpots.value = e.dice.map((value, i) => {
    const mark = marks.find((el) => el.dataset.land === String(i))
    if (mark) {
      const r = mark.getBoundingClientRect()
      return {
        left: clamp(r.left - bookRect.left + r.width / 2 - 24, 6, bookRect.width - 54) + 'px',
        top: clamp(r.top - bookRect.top - 42, -8, bookRect.height - 54) + 'px',
        delay: i * 0.16 + 's',
        value,
      }
    }
    if (e.init && e.landings[i]) {
      const landing = e.landings[i]
      return {
        left: Math.round(bookRect.width * (0.15 + landing.x * 0.7) - 24) + 'px',
        top: Math.round(bookRect.height * (0.16 + landing.y * 0.65) - 24) + 'px',
        delay: i * 0.16 + 's',
        value,
      }
    }
    // 落词跨页兜底：沿书页底部排列
    return {
      left: clamp(60 + i * 150, 20, bookRect.width - 60) + 'px',
      top: bookRect.height - 86 + 'px',
      delay: i * 0.16 + 's',
      value,
    }
  })
}

watch(
  () => props.state.entries.length,
  (n, old) => {
    if (!props.state.visible || n === 0) return
    if ((old ?? 0) === 0 && n > 0) void play(0)
  },
)

const pageHits = computed<PageTextHit[]>(() => {
  const e = entry.value
  if (!e) return []
  return e.lands.filter((land) => land.onPage).map((land) => ({
    dieIndex: land.dieIndex,
    dieValue: e.dice[land.dieIndex],
    offset: land.offset,
    length: land.length,
  }))
})

function skip(): void {
  clearTimers()
  emit('close')
}

onBeforeUnmount(clearTimers)
</script>

<template>
  <Teleport to="body">
    <Transition name="dice-fade">
      <div v-if="state.visible && entry" class="dice-overlay" @click="skip">
        <div class="stage-wrap">
          <div class="stage-role">
            <el-tag :type="entry.isKp ? 'warning' : 'primary'" effect="dark" size="large">
              {{ entry.roleName }}
            </el-tag>
            <span v-if="entry.init" class="stage-note">{{ t('diceOverlay.initialRoll') }}</span>
          </div>

          <div
            ref="bookRef"
            :key="entry.roleId + '-' + entry.nextPage + '-' + activeIndex"
            class="stage-book"
            :class="{ closed: entry.init }"
          >
            <!-- 内页：真实页文本 + 命中词高亮 -->
            <div class="stage-page">
              <BookPageText :text="entry.pageText" :hits="pageHits" animated />
            </div>
            <!-- 合书初掷：封皮 -->
            <div v-if="entry.init" class="stage-cover">
              <div class="stage-cover-frame">
                <div class="stage-cover-title">{{ entry.bookName }}</div>
                <div class="stage-cover-dice-note">1d10 × {{ entry.dice.length }}</div>
              </div>
            </div>

            <!-- 骰子落在实测词位；数字推导收进书签的可展开说明 -->
            <div
              v-for="(d, i) in diceSpots"
              :key="activeIndex + '-' + i"
              class="stage-die"
              :style="{ left: d.left, top: d.top }"
            >
              <div class="die3d stage-cube" :style="{ animationDelay: d.delay }">
                <span
                  v-for="(f, fi) in FACES"
                  :key="fi"
                  class="die3d-face"
                  :data-face="fi"
                >{{ fi === 0 ? d.value : f }}</span>
              </div>
            </div>

            <div class="stage-spine" />
            <div class="stage-edge" />
          </div>

          <div class="stage-caption">
            <div v-if="entry.keywords.length" class="stage-kws">
              <el-tag
                v-for="(kw, i) in entry.keywords"
                :key="kw + i"
                :type="entry.isKp ? 'warning' : 'primary'"
                effect="light"
                size="large"
                class="dice-kw"
                :style="{ animationDelay: 1.05 + i * 0.15 + 's' }"
              >{{ kw }}</el-tag>
            </div>
            <div class="stage-bookmark-note" :style="{ animationDelay: '1.35s' }">
              <span class="stage-bookmark-icon" aria-hidden="true">▮</span>
              <span>
                <small>{{ entry.init ? t('bookmark.initialPage') : t('bookmark.rollNote') }}</small>
                <strong>{{ entry.init ? t('diceOverlay.flipTo', { n: entry.nextPage + 1, total: entry.totalPages }) : t('bookmark.page', { n: entry.nextPage + 1 }) }}</strong>
              </span>
            </div>
            <div class="dice-overlay-hint">{{ t('diceOverlay.hint') }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
