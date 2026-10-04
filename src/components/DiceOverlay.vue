<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DiceOverlayState } from '../composables/useGame'

defineProps<{
  state: DiceOverlayState
}>()

defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()

/** 骰面 1-10 的 3D 立方体各面点数装饰（正面即结果） */
const FACES = [1, 6, 3, 4, 5, 2]
</script>

<template>
  <Teleport to="body">
    <Transition name="dice-fade">
      <div v-if="state.visible" class="dice-overlay" @click="$emit('close')">
        <div class="dice-overlay-card" @click.stop="$emit('close')">
          <div class="dice-overlay-title">{{ t('diceOverlay.title') }}</div>
          <div v-for="(entry, ei) in state.entries" :key="entry.roleId" class="dice-entry" :style="{ animationDelay: `${ei * 0.18}s` }">
            <div class="dice-entry-head">
              <el-tag :type="entry.isKp ? 'warning' : 'primary'" effect="dark" size="large">
                {{ entry.roleName }}
              </el-tag>
              <span v-if="entry.init" class="dice-entry-note">{{ t('diceOverlay.initialRoll') }}</span>
            </div>
            <div class="dice-cubes">
              <div
                v-for="(d, i) in entry.dice"
                :key="i"
                class="die3d"
                :style="{ animationDelay: `${i * 0.12}s` }"
              >
                <span
                  v-for="(f, fi) in FACES"
                  :key="fi"
                  class="die3d-face"
                  :data-face="fi"
                >{{ fi === 0 ? d : f }}</span>
              </div>
            </div>
            <div v-if="entry.keywords.length" class="dice-keywords">
              <el-tag
                v-for="(kw, i) in entry.keywords"
                :key="kw + i"
                :type="entry.isKp ? 'warning' : 'primary'"
                effect="light"
                size="large"
                class="dice-kw"
                :style="{ animationDelay: `${0.5 + i * 0.15}s` }"
              >{{ kw }}</el-tag>
            </div>
            <div class="dice-next">
              {{ t('diceOverlay.flipTo', { n: entry.nextPage + 1, total: entry.totalPages }) }}
            </div>
          </div>
          <div class="dice-overlay-hint">{{ t('diceOverlay.hint') }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
