<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Hide, View } from '@element-plus/icons-vue'
import type { RoleDef, RoleId, RoundRoll } from '../core/types'

const props = defineProps<{
  roles: RoleDef[]
  keywords: Record<RoleId, string[]>
  rolls: Record<RoleId, RoundRoll | null>
  /** 最近一次骰面 */
  lastDice: Record<RoleId, number[]>
  kpHidden: boolean
  round: number
}>()

defineEmits<{
  (e: 'toggle-kp-hidden'): void
}>()

const { t } = useI18n()

const pcRoles = computed(() => props.roles.filter((r) => r.kind === 'pc'))
const kpRole = computed(() => props.roles.find((r) => r.kind === 'kp'))
</script>

<template>
  <div class="keywords-bar">
    <!-- PC 关键词：始终可见 -->
    <div v-for="role in pcRoles" :key="role.id" class="kw-group kw-pc">
      <div class="kw-role">
        <span class="kw-role-name">{{ role.name }}</span>
        <span class="kw-role-tag">{{ t('pcTag') }}</span>
      </div>
      <div class="kw-body">
        <span class="dice-row">
          <span v-for="(d, i) in lastDice[role.id] ?? []" :key="i" class="die">{{ d }}</span>
        </span>
        <span class="kw-tags">
          <el-tag
            v-for="(kw, i) in keywords[role.id] ?? []"
            :key="kw + i"
            type="primary"
            effect="dark"
            size="large"
            class="kw-tag"
          >{{ kw }}</el-tag>
        </span>
      </div>
    </div>

    <!-- KP 关键词：可隐藏 -->
    <div v-if="kpRole" class="kw-group kw-kp" :class="{ hidden: kpHidden }">
      <div class="kw-role">
        <span class="kw-role-name">{{ t('kpName') }}</span>
        <span class="kw-role-tag">{{ t('kpTag') }}</span>
        <el-button
          link
          size="small"
          :icon="kpHidden ? View : Hide"
          class="kw-toggle"
          @click="$emit('toggle-kp-hidden')"
        >
          {{ kpHidden ? t('showKpKeywords') : t('hideKpKeywords') }}
        </el-button>
      </div>
      <div class="kw-body">
        <span class="dice-row">
          <span v-for="(d, i) in lastDice[kpRole.id] ?? []" :key="i" class="die">{{ d }}</span>
        </span>
        <span v-if="kpHidden" class="kw-tags">
          <el-tag v-for="i in (keywords[kpRole.id] ?? []).length" :key="i" size="large" class="kw-tag kw-mask">？</el-tag>
        </span>
        <span v-else class="kw-tags">
          <el-tag
            v-for="(kw, i) in keywords[kpRole.id] ?? []"
            :key="kw + i"
            type="warning"
            effect="plain"
            size="large"
            class="kw-tag"
          >{{ kw }}</el-tag>
        </span>
      </div>
    </div>
  </div>
</template>
