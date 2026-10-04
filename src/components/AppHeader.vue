<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Setting, Download, Plus } from '@element-plus/icons-vue'

defineProps<{
  /** 是否在对局中 */
  inGame: boolean
  phaseLabel: string
  round: number
  saveName: string
  sceneEndHint: boolean
}>()

const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'open-world'): void
  (e: 'export-save'): void
  (e: 'new-game'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="header">
    <div class="header-left">
      <span class="app-title">{{ t('appTitle') }}</span>
      <span class="app-subtitle">{{ t('appSubtitle') }}</span>
    </div>
    <div class="header-right">
      <template v-if="inGame">
        <el-tag effect="plain" size="large" round>{{ phaseLabel }}</el-tag>
        <el-tag type="info" effect="plain" size="large" round>
          {{ t('roundBadge', { n: round }) }}
        </el-tag>
        <el-tag v-if="sceneEndHint" type="warning" size="large" round effect="light">
          {{ t('sceneEndSuggested') }}
        </el-tag>
      </template>
      <el-dropdown v-if="inGame" trigger="click">
        <el-button>
          {{ t('saveMenu') }}
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :icon="Download" @click="$emit('export-save')">
              {{ t('exportSave') }}
            </el-dropdown-item>
            <el-dropdown-item :icon="Plus" divided @click="$emit('new-game')">
              {{ t('newGame') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button v-if="inGame" @click="$emit('open-world')">{{ t('worldStateTitle') }}</el-button>
      <el-button :icon="Setting" @click="$emit('open-settings')">{{ t('settings') }}</el-button>
    </div>
  </div>
</template>
