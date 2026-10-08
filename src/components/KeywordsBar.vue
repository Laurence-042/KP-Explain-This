<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { RoleDef, RoleId, RoundRoll } from '../core/types'

defineProps<{
  roles: RoleDef[]
  keywords: Record<RoleId, string[]>
  rolls: Record<RoleId, RoundRoll | null>
  viewerRoleId: RoleId | null
}>()

const { t } = useI18n()
</script>

<template>
  <div class="keywords-bar">
    <div v-for="role in roles" :key="role.id" class="kw-group" :class="[role.kind === 'kp' ? 'kw-kp' : 'kw-pc', { 'kw-mine': role.id === viewerRoleId }]">
      <div class="kw-role">
        <span class="kw-role-name">{{ role.name }}</span>
        <span class="kw-role-tag">{{ role.kind === 'kp' ? t('kpTag') : t('pcTag') }}</span>
        <span v-if="role.id === viewerRoleId" class="kw-mine-label">{{ t('tabletop.myKeywords') }}</span>
      </div>
      <div class="kw-tags">
        <el-tooltip
          v-for="(keyword, index) in (keywords[role.id] ?? [])"
          :key="keyword + index"
          :disabled="!rolls[role.id]?.picks[index]"
          :content="t('bookmark.dieFace', { n: rolls[role.id]?.picks[index]?.dieValue })"
          placement="top"
        >
          <el-tag
            :type="role.kind === 'kp' ? 'warning' : 'primary'"
            :effect="role.kind === 'kp' ? 'plain' : 'dark'"
            size="large"
            class="kw-tag"
            tabindex="0"
          >{{ keyword }}</el-tag>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>
