<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Delete, FolderOpened, Upload, MagicStick } from '@element-plus/icons-vue'
import type { UseGame } from '../composables/useGame'
import type { StoredBook } from '../composables/useBooks'
import { diceReachableMaxPage } from '../core/book'

const props = defineProps<{
  game: UseGame
  /** KP / Validator 连接是否都已就绪 */
  configReady: boolean
}>()

const emit = defineEmits<{
  (e: 'open-settings'): void
  (
    e: 'start',
    setup: { kpBookId: string; pcBookId: string; pcName: string; diceCount: number; pageWords: number },
  ): void
}>()

const { t } = useI18n()
const fileInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

const form = reactive({
  kpBookId: '',
  pcBookId: '',
  pcName: '玩家A',
  diceCount: 3,
  pageWords: 300,
})

const bookOptions = computed(() => props.game.books.books.value)

function findBook(id: string): StoredBook | undefined {
  return bookOptions.value.find((b) => b.id === id)
}

function sourceLabel(book: StoredBook): string {
  return (book.source ?? 'txt').toUpperCase()
}

/** 书的页数：PDF 真实页数；TXT 按当前每页词数估算 */
function bookPageCount(book: StoredBook | undefined): number | null {
  if (!book) return null
  if (book.source === 'pdf') return book.pageTexts?.length ?? null
  if (!book.wordCount) return null
  return Math.max(1, Math.ceil(book.wordCount / form.pageWords))
}

const selectedBooks = computed(() => {
  const ids = [...new Set([form.kpBookId, form.pcBookId])].filter(Boolean)
  return ids.map((id) => findBook(id)).filter((b): b is StoredBook => Boolean(b))
})

/** 所选书中包含 PDF：每页词数不适用 */
const pdfSelected = computed(() => selectedBooks.value.some((b) => b.source === 'pdf'))

/** 骰子覆盖不足警告：位组合上限 10^N < 书页数 → 靠后的页永远摇不到 */
const coverageWarnings = computed(() => {
  const maxPages = diceReachableMaxPage(form.diceCount)
  const warnings: string[] = []
  for (const book of selectedBooks.value) {
    const pages = bookPageCount(book)
    if (pages !== null && pages > maxPages) {
      warnings.push(
        t('setup.diceCoverageWarning', { name: book.name, pages, max: maxPages, n: form.diceCount }),
      )
    }
  }
  return warnings
})

const canStart = computed(
  () =>
    props.configReady &&
    Boolean(form.kpBookId && form.pcBookId) &&
    !props.game.books.importing.value,
)

async function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  for (const file of files) {
    try {
      const book = await props.game.books.importFile(file)
      if (!form.kpBookId) form.kpBookId = book.id
      if (!form.pcBookId) form.pcBookId = book.id
      ElMessage.success(t('bookImported', { name: book.name }))
    } catch {
      ElMessage.error(t('bookImportFailed', { name: file.name }))
    }
  }
  input.value = ''
}

function removeBook(id: string) {
  void props.game.books.removeBook(id)
  if (form.kpBookId === id) form.kpBookId = ''
  if (form.pcBookId === id) form.pcBookId = ''
}

function start() {
  if (!canStart.value) return
  emit('start', { ...form })
}

async function onImportSaveFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const ok = await props.game.importSaveFile(file)
  if (ok) ElMessage.success(t('saveImported'))
}

function formatSize(book: StoredBook): string {
  const chars =
    book.source === 'pdf' ? (book.pageTexts ?? []).join('').length : (book.text ?? '').length
  if (!chars) return ''
  const kb = chars / 1024
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
}

// 自动选中唯一一本书
watch(bookOptions, (list) => {
  if (list.length === 1) {
    form.kpBookId = list[0].id
    form.pcBookId = list[0].id
  }
})
</script>

<template>
  <div class="setup-panel">
    <el-alert
      v-if="!configReady"
      type="info"
      show-icon
      :title="t('setup.needConfig')"
      :closable="false"
      class="setup-alert"
    >
      <el-button type="primary" size="small" :icon="MagicStick" @click="$emit('open-settings')">
        {{ t('setup.openSettings') }}
      </el-button>
    </el-alert>

    <!-- 书库 -->
    <div class="setup-section">
      <div class="setup-section-head">
        <h3>{{ t('setup.library') }}</h3>
        <el-button :icon="Upload" :loading="game.books.importing.value" @click="fileInput?.click()">
          {{ t('setup.importBooks') }}
        </el-button>
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.pdf"
          multiple
          hidden
          @change="onFilesChosen"
        />
      </div>
      <p class="form-hint">{{ t('setup.libraryHint') }}</p>
      <div v-if="bookOptions.length === 0" class="book-shelf-empty">
        <el-icon :size="36" color="#cbd5e1"><FolderOpened /></el-icon>
        <p>{{ t('setup.libraryEmpty') }}</p>
      </div>
      <div v-else class="book-shelf">
        <div v-for="book in bookOptions" :key="book.id" class="book-shelf-item">
          <div class="book-shelf-info">
            <span class="book-shelf-name">{{ book.name }}</span>
            <el-tag size="small" :type="book.source === 'pdf' ? 'danger' : 'info'" effect="plain">
              {{ sourceLabel(book) }}
            </el-tag>
            <span class="book-shelf-size">
              {{ book.source === 'pdf' ? t('setup.bookPages', { n: book.pageTexts?.length ?? 0 }) : t('setup.bookPagesEst', { n: Math.max(1, Math.ceil((book.wordCount || 1) / form.pageWords)) }) }}
              · {{ formatSize(book) }}
            </span>
          </div>
          <el-button :icon="Delete" circle size="small" text type="danger" @click="removeBook(book.id)" />
        </div>
      </div>
    </div>

    <el-divider />

    <!-- 开局配置 -->
    <div class="setup-section">
      <h3>{{ t('setup.roles') }}</h3>
      <el-form label-width="130px" label-position="left">
        <el-form-item :label="t('setup.kpBook')">
          <el-select v-model="form.kpBookId" :placeholder="t('setup.pickBook')" style="width: 100%">
            <el-option v-for="b in bookOptions" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('setup.pcBook')">
          <el-select v-model="form.pcBookId" :placeholder="t('setup.pickBook')" style="width: 100%">
            <el-option v-for="b in bookOptions" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('setup.pcName')">
          <el-input v-model="form.pcName" :placeholder="t('setup.pcNamePlaceholder')" maxlength="12" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="t('setup.diceCount')">
          <el-input-number v-model="form.diceCount" :min="1" :max="10" />
          <span class="form-hint" style="margin-left: 10px">{{ t('setup.diceCountHint') }}</span>
        </el-form-item>
        <el-form-item :label="t('setup.pageWords')">
          <div style="width: 100%">
            <el-input-number v-model="form.pageWords" :min="100" :max="1000" :step="50" :disabled="pdfSelected" />
            <span class="form-hint" style="margin-left: 10px">
              {{ pdfSelected ? t('setup.pdfNoPageWords') : t('setup.pageWordsHint') }}
            </span>
          </div>
        </el-form-item>
      </el-form>

      <el-alert
        v-for="(w, i) in coverageWarnings"
        :key="i"
        type="warning"
        show-icon
        :closable="false"
        :title="w"
        class="setup-alert"
      />
    </div>

    <div class="setup-actions">
      <el-button v-if="game.hasLocalSave.value" @click="game.continueLocalSave()">
        {{ t('setup.continueSave') }}
      </el-button>
      <el-button @click="importInput?.click()">{{ t('setup.importSave') }}</el-button>
      <input ref="importInput" type="file" accept=".json" hidden @change="onImportSaveFile" />
      <el-button type="primary" size="large" :disabled="!canStart" @click="start">
        {{ t('setup.start') }}
      </el-button>
    </div>
  </div>
</template>
