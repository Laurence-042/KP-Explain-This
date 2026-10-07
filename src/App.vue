<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from './components/AppHeader.vue'
import SetupPanel from './components/SetupPanel.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import GameChat from './components/GameChat.vue'
import ActionComposer from './components/ActionComposer.vue'
import KeywordsBar from './components/KeywordsBar.vue'
import BookView from './components/BookView.vue'
import WorldStateDrawer from './components/WorldStateDrawer.vue'
import DiagnosticsDialog from './components/DiagnosticsDialog.vue'
import DiceOverlay from './components/DiceOverlay.vue'
import { useConfig } from './composables/useConfig'
import { useGame, type StartSetup } from './composables/useGame'
import { ElMessage } from 'element-plus'
import type { RoleDef } from './core/types'

const { t } = useI18n()
const config = useConfig()
const game = useGame(config)

const settingsOpen = ref(false)
const worldOpen = ref(false)
/** 书页查看的角色 tab（默认玩家） */
const activeBookRole = ref('')

const configReady = computed(
  () => config.connectionReady(config.form.kp) && config.connectionReady(config.form.validator),
)

const inGame = computed(() => game.view.value === 'game')

const bookRoles = computed<RoleDef[]>(() =>
  game.roles.value.filter((r) => r.bookId),
)

async function onStart(setup: StartSetup) {
  const ok = await game.startGame(setup)
  if (ok) activeBookRole.value = game.pcRole.value?.id ?? 'kp'
}

async function onSend(text: string) {
  // 拒绝/通过的信息由 Validator 卡片在聊天流中展示
  await game.submitAction(text)
}

function toggleKpHidden() {
  game.kpKeywordsHidden.value = !game.kpKeywordsHidden.value
}

function newGame() {
  game.newGame()
  ElMessage.info(t('backToSetup'))
}

// 进入对局时（新开局或存档恢复）确保书页 tab 有选中项
watch(
  () => game.view.value,
  (view) => {
    if (view !== 'game') return
    const known = new Set(bookRoles.value.map((r) => r.id))
    if (!known.has(activeBookRole.value)) {
      activeBookRole.value = game.pcRole.value?.id ?? game.kpRole.value?.id ?? ''
    }
  },
)

onMounted(() => {
  config.load()
  game.checkLocalSave()
  void game.books.refresh()
})
</script>

<template>
  <div class="page">
    <el-card :class="['main-card', { 'game-card': inGame }]">
      <template #header>
        <AppHeader
          :in-game="inGame"
          :phase-label="game.phaseLabel.value"
          :round="game.round.value"
          :save-name="game.saveName.value"
          :scene-end-hint="game.sceneEndHint.value"
          @open-settings="settingsOpen = true"
          @open-world="worldOpen = true"
          @export-save="game.exportSaveFile()"
          @new-game="newGame"
        />
      </template>

      <!-- ===== 开局设置 ===== -->
      <SetupPanel
        v-if="!inGame"
        :game="game"
        :config-ready="configReady"
        :pc-llm-ready="config.connectionReady(config.form.pcLlm)"
        @open-settings="settingsOpen = true"
        @start="onStart"
      />

      <!-- ===== 游戏主界面 ===== -->
      <div v-else class="game-layout">
        <div class="game-side">
          <el-tabs v-model="activeBookRole" class="book-tabs">
            <el-tab-pane
              v-for="role in bookRoles"
              :key="role.id"
              :name="role.id"
              :label="role.name"
              :lazy="true"
            >
              <BookView
                :role="role"
                :doc="game.bookDocOf(role)"
                :page-index="game.pages.value[role.id] ?? 0"
                :picks="game.rolls.value[role.id]?.picks ?? []"
                :flip-tick="game.flipTick.value[role.id] ?? 0"
                :blurred="role.kind === 'kp' && game.kpKeywordsHidden.value"
              />
            </el-tab-pane>
          </el-tabs>
        </div>

        <div class="game-main">
          <KeywordsBar
            :roles="game.roles.value"
            :keywords="game.keywords.value"
            :rolls="game.rolls.value"
            :last-dice="game.lastDice.value"
            :kp-hidden="game.kpKeywordsHidden.value"
            :round="game.round.value"
            @toggle-kp-hidden="toggleKpHidden"
          />

          <GameChat
            :log="game.log.value"
            :streaming="game.streamingNarrative.value"
            :running="game.running.value"
            :phase="game.phase.value"
          />

          <ActionComposer
            :can-submit="game.canSubmit.value"
            :running="game.running.value"
            :can-reroll="game.canReroll.value"
            :interrupted="game.phase.value === 'interrupted'"
            :pc-acting="game.pcActing.value"
            :assisting="game.assisting.value"
            :assist-insert="game.assistInsert.value"
            @send="onSend"
            @reroll="game.requestReroll()"
            @retry="game.retryInterrupted()"
            @abort="game.abort()"
            @assist="game.requestAssist()"
          />
        </div>
      </div>
    </el-card>

    <DiceOverlay :state="game.diceOverlay.value" @close="game.closeOverlay()" />
    <SettingsDrawer v-model="settingsOpen" :config="config" />
    <WorldStateDrawer v-model="worldOpen" :world="game.world.value" />
    <DiagnosticsDialog
      v-model="game.diagnosticsOpen.value"
      :diagnostics="game.diagnostics.value"
      :format-diagnostics="game.formatDiagnostics"
      @copy-diagnostics="game.copyDiagnostics()"
    />
  </div>
</template>
