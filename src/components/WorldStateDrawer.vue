<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorldState } from '../core/types'

const props = defineProps<{
  modelValue: boolean
  world: WorldState | null
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const { t } = useI18n()
const showRaw = ref(false)

const playerEntries = computed(() =>
  props.world ? Object.entries(props.world.players) : [],
)
const npcEntries = computed(() => (props.world ? Object.entries(props.world.npcs) : []))

function actorFields(fields: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(fields)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)])
}

const worldJson = computed(() =>
  props.world ? JSON.stringify(props.world, null, 2) : '',
)
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="t('worldStateTitle')"
    size="420px"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="world" class="world-state">
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item :label="t('world.round')">{{ world.round }}</el-descriptions-item>
        <el-descriptions-item :label="t('world.location')">{{ world.location || t('world.undecided') }}</el-descriptions-item>
        <el-descriptions-item :label="t('world.time')">{{ world.time || t('world.undecided') }}</el-descriptions-item>
        <el-descriptions-item :label="t('world.scene')">{{ world.scene || t('world.undecided') }}</el-descriptions-item>
      </el-descriptions>

      <h4 class="ws-section">{{ t('world.players') }}</h4>
      <div v-for="[id, st] in playerEntries" :key="id" class="ws-actor">
        <div class="ws-actor-name">{{ st.name || id }}</div>
        <div class="ws-actor-fields">
          <el-tag v-for="[k, v] in actorFields(st as Record<string, unknown>)" :key="k" size="small" class="ws-field">
            {{ k }}: {{ v }}
          </el-tag>
          <el-tag
            v-for="item in world.inventory[id] ?? []"
            :key="item"
            size="small"
            type="info"
            class="ws-field"
          >
            🎒 {{ item }}
          </el-tag>
        </div>
      </div>

      <h4 class="ws-section">{{ t('world.npcs') }}</h4>
      <div v-if="npcEntries.length === 0" class="ws-empty">{{ t('world.none') }}</div>
      <div v-for="[id, st] in npcEntries" :key="id" class="ws-actor">
        <div class="ws-actor-name">{{ st.name || id }}</div>
        <div class="ws-actor-fields">
          <el-tag v-for="[k, v] in actorFields(st as Record<string, unknown>)" :key="k" size="small" type="warning" class="ws-field">
            {{ k }}: {{ v }}
          </el-tag>
        </div>
      </div>

      <h4 class="ws-section">{{ t('world.facts') }}</h4>
      <ul v-if="world.facts.length" class="ws-list">
        <li v-for="f in world.facts" :key="f">{{ f }}</li>
      </ul>
      <div v-else class="ws-empty">{{ t('world.none') }}</div>

      <h4 class="ws-section">{{ t('world.events') }}</h4>
      <ul v-if="world.events.length" class="ws-list">
        <li v-for="e in world.events" :key="e">{{ e }}</li>
      </ul>
      <div v-else class="ws-empty">{{ t('world.none') }}</div>

      <template v-if="Object.keys(world.plotVariables).length">
        <h4 class="ws-section">{{ t('world.plotVariables') }}</h4>
        <div class="ws-actor-fields">
          <el-tag v-for="(v, k) in world.plotVariables" :key="k" size="small" class="ws-field">
            {{ k }} = {{ v }}
          </el-tag>
        </div>
      </template>

      <div class="ws-raw">
        <el-button link size="small" @click="showRaw = !showRaw">
          {{ showRaw ? t('world.hideRaw') : t('world.showRaw') }}
        </el-button>
        <pre v-if="showRaw" class="diagnostics-block">{{ worldJson }}</pre>
      </div>
    </div>
    <div v-else class="ws-empty">{{ t('world.noGame') }}</div>
  </el-drawer>
</template>
