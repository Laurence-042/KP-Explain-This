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
import { QuestionFilled } from '@element-plus/icons-vue'
import type { RoleDef } from './core/types'

const { t } = useI18n()
const config = useConfig()
const game = useGame(config)

const settingsOpen = ref(false)
const worldOpen = ref(false)
/** 选中的书仅是视图，不改变当前客户端代表的角色。 */
const activeBookRole = ref('')

const configReady = computed(
  () => config.connectionReady(config.form.kp) && config.connectionReady(config.form.validator),
)

const inGame = computed(() => game.view.value === 'game')

const bookRoles = computed<RoleDef[]>(() =>
  game.roles.value.filter((r) => r.bookId),
)
const activeBook = computed(() => bookRoles.value.find((r) => r.id === activeBookRole.value))

watch(() => game.viewerRoleId.value, (id) => {
  if (id && bookRoles.value.some((r) => r.id === id)) activeBookRole.value = id
})
watch(bookRoles, (roles) => {
  if (roles.some((r) => r.id === activeBookRole.value)) return
  activeBookRole.value = roles.find((r) => r.id === game.viewerRoleId.value)?.id ?? roles[0]?.id ?? ''
})

async function onStart(setup: StartSetup) {
  await game.startGame(setup)
}

async function onSend(text: string) {
  // 拒绝/通过的信息由 Validator 卡片在聊天流中展示
  await game.submitAction(text)
}

function newGame() {
  game.newGame()
  ElMessage.info(t('backToSetup'))
}

onMounted(() => {
  config.load()
  game.checkLocalSave()
  void game.books.refresh()
})
</script>

<template>
  <div class="page" :class="{ 'page-game': inGame }">
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
      <div v-else class="game-layout tabletop">
        <div class="tabletop-heading">
          <span>{{ t('tabletop.books') }}</span>
        </div>
        <div class="tabletop-library">
          <div class="focused-book">
            <BookView
              v-if="activeBook"
              :key="activeBook.id"
              :role="activeBook"
              :doc="game.bookDocOf(activeBook)"
              :page-index="game.pages.value[activeBook.id] ?? 0"
              :picks="game.rolls.value[activeBook.id]?.picks ?? []"
              :roll="game.rolls.value[activeBook.id] ?? null"
              :show-bookmark="!['init-roll', 'rolling', 'scene-end', 'reroll'].includes(game.phase.value)"
              :flip-tick="game.flipTick.value[activeBook.id] ?? 0"
            />
          </div>
          <nav class="book-switcher" :aria-label="t('tabletop.switchBook')">
            <span class="tabletop-kicker">{{ t('tabletop.switchBook') }}</span>
            <button
              v-for="role in bookRoles"
              :key="role.id"
              type="button"
              class="book-switch"
              :title="game.bookDocOf(role)?.name ?? ''"
              :class="{ selected: role.id === activeBookRole }"
              :aria-pressed="role.id === activeBookRole"
              @click="activeBookRole = role.id"
            >
              <span class="switch-owner">
                {{ role.name }}
                <span v-if="role.id === game.viewerRoleId.value" class="switch-mine">{{ t('tabletop.mine') }}</span>
              </span>
              <span class="switch-title">{{ game.bookDocOf(role)?.name ?? '—' }}</span>
              <span class="switch-page">{{ t('pageOf', { current: (game.pages.value[role.id] ?? 0) + 1, total: game.bookDocOf(role)?.pages.length ?? 0 }) }}</span>
            </button>
          </nav>
        </div>

        <section class="tabletop-notebook" :aria-label="t('tabletop.notebook')">
          <div class="notebook-binding" aria-hidden="true" />
          <div class="notebook-content">
            <div class="notebook-heading">
              <h2>{{ t('tabletop.notebook') }}</h2>
              <el-tooltip :content="t('tabletop.keywordGuide')" placement="top" :show-after="150">
                <button type="button" class="notebook-help" :aria-label="t('tabletop.keywordGuide')">
                  <el-icon><QuestionFilled /></el-icon>
                  <span>{{ t('tabletop.rules') }}</span>
                </button>
              </el-tooltip>
            </div>
            <KeywordsBar
              :roles="game.roles.value"
              :keywords="game.keywords.value"
              :rolls="game.rolls.value"
              :viewer-role-id="game.viewerRoleId.value"
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
        </section>
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
