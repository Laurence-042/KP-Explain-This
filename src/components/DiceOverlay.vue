<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiceOverlayEntry, DiceOverlayState } from '../composables/useGame'

/**
 * 掷骰演出：真渲染一本带封皮/书脊/内页的实体书，骰子从空中翻滚落下、
 * 停在命中的单词上（词位在渲染后用 getBoundingClientRect 实测，
 * 全程不依赖 rAF，动画均为 CSS keyframes）。
 * 多个角色按 ~3.6s 依次演出，点击任意处跳过/关闭。
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
  const marks = [...book.querySelectorAll<HTMLElement>('[data-land]')]
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

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
    // 落词不在本页（跨页兜底）或合书初掷：沿底部/封皮散开
    return {
      left: clamp(60 + i * 150, 20, bookRect.width - 60) + 'px',
      top: e.init ? Math.round(bookRect.height * 0.42) + 'px' : bookRect.height - 86 + 'px',
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

/** 页文本按落词 offset 切片，命中词渲染为带 data-land 的高亮 span */
const segments = computed<Array<{ text: string; land?: number }>>(() => {
  const e = entry.value
  if (!e || !e.pageText) return []
  const onPage = e.lands.filter((l) => l.onPage).sort((a, b) => a.offset - b.offset)
  const parts: Array<{ text: string; land?: number }> = []
  let cursor = 0
  for (const land of onPage) {
    if (land.offset > cursor) parts.push({ text: e.pageText.slice(cursor, land.offset) })
    parts.push({ text: e.pageText.slice(land.offset, land.offset + land.length), land: land.dieIndex })
    cursor = land.offset + land.length
  }
  if (cursor < e.pageText.length) parts.push({ text: e.pageText.slice(cursor) })
  return parts
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
            <div v-if="!entry.init" class="stage-page">
              <template v-for="(seg, i) in segments" :key="i">
                <span
                  v-if="seg.land !== undefined"
                  class="stage-hit"
                  :data-land="seg.land"
                  :style="{ animationDelay: 0.5 + seg.land * 0.16 + 's' }"
                >{{ seg.text }}</span>
                <template v-else>{{ seg.text }}</template>
              </template>
            </div>
            <!-- 合书初掷：封皮 -->
            <div v-else class="stage-cover">
              <div class="stage-cover-frame">
                <div class="stage-cover-title">{{ entry.bookName }}</div>
                <div class="stage-cover-dice-note">1d10 × {{ entry.dice.length }}</div>
              </div>
            </div>

            <!-- 骰子：落在词上 -->
            <div
              v-for="(d, i) in diceSpots"
              :key="activeIndex + '-' + i"
              class="die3d stage-die"
              :style="{ left: d.left, top: d.top, animationDelay: d.delay }"
            >
              <span
                v-for="(f, fi) in FACES"
                :key="fi"
                class="die3d-face"
                :data-face="fi"
              >{{ fi === 0 ? d.value : f }}</span>
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
            <div class="stage-next" :style="{ animationDelay: '1.5s' }">
              {{ t('diceOverlay.flipTo', { n: entry.nextPage + 1, total: entry.totalPages }) }}
            </div>
            <div class="dice-overlay-hint">{{ t('diceOverlay.hint') }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
