<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PageTextHit } from './bookPageText'

/** 主界面与掷骰舞台共用同一套页内偏移切片和命中词渲染。 */
const props = withDefaults(defineProps<{
  text: string
  hits?: PageTextHit[]
  animated?: boolean
}>(), { hits: () => [], animated: false })

const { t } = useI18n()
type Segment = { text: string; hit?: PageTextHit }
const segments = computed<Segment[]>(() => {
  const parts: Segment[] = []
  const hits = props.hits
    .filter((hit) => hit.offset >= 0 && hit.length > 0 && hit.offset + hit.length <= props.text.length)
    .sort((a, b) => a.offset - b.offset)
  let cursor = 0
  for (const hit of hits) {
    if (hit.offset < cursor) continue
    if (hit.offset > cursor) parts.push({ text: props.text.slice(cursor, hit.offset) })
    parts.push({ text: props.text.slice(hit.offset, hit.offset + hit.length), hit })
    cursor = hit.offset + hit.length
  }
  if (cursor < props.text.length) parts.push({ text: props.text.slice(cursor) })
  return parts
})
</script>

<template>
  <div class="page-text-content">
    <template v-for="(segment, index) in segments" :key="index">
      <el-tooltip
        v-if="segment.hit"
        :content="t('bookmark.dieFace', { n: segment.hit.dieValue })"
        placement="top"
        :show-after="100"
      >
        <mark
          class="page-hit"
          :class="{ 'page-hit-animated': animated }"
          :data-land="segment.hit.dieIndex"
          :aria-label="`${segment.text}，${t('bookmark.dieFace', { n: segment.hit.dieValue })}`"
          :style="animated ? { animationDelay: 0.5 + segment.hit.dieIndex * 0.16 + 's' } : undefined"
          tabindex="0"
        >{{ segment.text }}</mark>
      </el-tooltip>
      <template v-else>{{ segment.text }}</template>
    </template>
  </div>
</template>
