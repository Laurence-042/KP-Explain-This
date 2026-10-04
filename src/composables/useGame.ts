import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { GameEngine, type EngineEvent } from '../core/engine'
import { HumanController, LlmKpController, type RoleController } from '../core/controller'
import { LLMClient, type LlmDiagnostics } from '../core/llm/client'
import { LLMSession } from '../core/llm/session'
import type {
  BookDocument,
  GameLogEntry,
  GamePhase,
  RoleDef,
  RoleId,
  RoundRoll,
  WorldState,
} from '../core/types'
import { parsePdfPages, parseTxt } from '../core/book'
import { diceToNumber } from '../core/randomizer'
import { narrativeViewForStream } from '../core/json-out'
import {
  buildSave,
  decodeSaveFile,
  encodeSaveFile,
  type BookMeta,
  type SaveFileV1,
} from '../core/save'
import { useBooks, type StoredBook } from './useBooks'
import type { UseConfig } from './useConfig'
import { parseMaxTokens, parseTemperature, type ConnectionConfig } from '../types'

const LS_SAVE_KEY = 'kpet-save'

export type StartSetup = {
  kpBookId: string
  pcBookId: string
  pcName: string
  diceCount: number
  /** 每页词数：仅对 TXT 生效 */
  pageWords: number
}

export type DiceLandPick = {
  dieIndex: number
  keyword: string
  /** 命中词在页文本内的偏移（跨页兜底命中时 offset 无效，由组件放底部） */
  onPage: boolean
  offset: number
  length: number
}

export type DiceOverlayEntry = {
  roleId: RoleId
  roleName: string
  isKp: boolean
  bookName: string
  dice: number[]
  /** 骰面按位组合出的数（8·10·4 → 804），演出时展示推导算式 */
  diceNumber: number
  /** 取模算式直接得到的页索引（未经 nearestValidPage 映射） */
  modPage: number
  keywords: string[]
  /** 骰子落下的当前页文本（初掷为空：骰子落在封皮上） */
  pageText: string
  /** 每个骰子的落词信息 */
  lands: DiceLandPick[]
  nextPage: number
  totalPages: number
  /** 合书初掷：骰子落在封皮上，只有目标页 */
  init: boolean
}

export type DiceOverlayState = {
  visible: boolean
  entries: DiceOverlayEntry[]
}

/**
 * GameEngine ↔ Vue 的桥：
 * - 构造控制器（LlmKpController / HumanController），把引擎事件同步为响应式状态
 * - 提供行动提交、重骰确认、中断重试、中止
 * - localStorage 自动存档 + 自包含 JSON 导入导出（书正文走 IndexedDB）
 */
export function useGame(config: UseConfig) {
  const { t } = useI18n()
  const books = useBooks()

  // ── 响应式状态 ──
  const view = ref<'setup' | 'game'>('setup')
  const phase = ref<GamePhase>('setup')
  const round = ref(0)
  const roles = ref<RoleDef[]>([])
  const keywords = ref<Record<RoleId, string[]>>({})
  const pages = ref<Record<RoleId, number>>({})
  const rolls = ref<Record<RoleId, RoundRoll | null>>({})
  const log = ref<GameLogEntry[]>([])
  const world = ref<WorldState | null>(null)
  const sceneEndHint = ref(false)
  const streamingRaw = ref('')
  const streamingNarrative = computed(() => narrativeViewForStream(streamingRaw.value))
  const summarizing = ref(false)
  const flipTick = ref<Record<RoleId, number>>({})
  const lastDice = ref<Record<RoleId, number[]>>({})
  const kpKeywordsHidden = ref(false)
  const saveName = ref('')
  const hasLocalSave = ref(false)
  const awaitingAction = ref(false)

  const diceOverlay = ref<DiceOverlayState>({ visible: false, entries: [] })
  let overlaySettleTimer: ReturnType<typeof setTimeout> | null = null
  let overlayCloseTimer: ReturnType<typeof setTimeout> | null = null

  const diagnostics = ref<LlmDiagnostics | null>(null)
  const diagnosticsOpen = ref(false)

  // ── 非响应式内部 ──
  let engine: GameEngine | null = null
  let kpSession: LLMSession | null = null
  let validatorSession: LLMSession | null = null
  let humanController: HumanController | null = null
  let bookDocs: Record<string, BookDocument> = {}
  /** 导出存档时内嵌的原始内容（BookDocument 不再携带全文） */
  let bookTexts: Record<string, string> = {}
  let bookPageTexts: Record<string, string[]> = {}
  let bookMetas: BookMeta[] = []
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const kpRole = computed(() => roles.value.find((r) => r.kind === 'kp'))
  const pcRole = computed(() => roles.value.find((r) => r.kind === 'pc' && r.controller === 'human'))
  const running = computed(() =>
    ['kp-scene', 'kp-resolve', 'validating', 'rolling', 'init-roll', 'reroll'].includes(phase.value),
  )
  const canSubmit = computed(() => phase.value === 'await-action')
  const canReroll = computed(
    () => phase.value === 'await-action' || phase.value === 'interrupted',
  )
  const phaseLabel = computed(() => t(`phase.${phase.value}`))

  function bump(tick: typeof flipTick, roleId: RoleId) {
    tick.value = { ...tick.value, [roleId]: (tick.value[roleId] ?? 0) + 1 }
  }

  function syncAll(): void {
    if (!engine || !kpSession) return
    round.value = engine.round
    roles.value = engine.snapshot().roles
    keywords.value = { ...engine.keywords }
    pages.value = { ...engine.pages }
    rolls.value = JSON.parse(JSON.stringify(engine.rolls))
    log.value = [...engine.log]
    world.value = JSON.parse(JSON.stringify(engine.world))
    sceneEndHint.value = engine.sceneEndHint
    summarizing.value = kpSession.summarizing
  }

  function showError(stage: string): void {
    const client =
      stage === 'validator' || stage === 'validator-retry'
        ? validatorSession?.client
        : kpSession?.client
    diagnostics.value = client?.diagnostics ?? null
    diagnosticsOpen.value = true
    ElMessage.error(t('requestFailed'))
  }

  // ── 骰子 overlay：roll 事件进入；600ms 无新骰即视为本轮掷完，
  //    组件按每个角色 ~3.6s 依次演出，这里只做兜底关闭 ──

  function pushOverlayEntry(entry: DiceOverlayEntry): void {
    const state = diceOverlay.value
    const next = { ...state, visible: true, entries: [...state.entries, entry] }
    diceOverlay.value = next
    if (overlaySettleTimer) clearTimeout(overlaySettleTimer)
    if (overlayCloseTimer) clearTimeout(overlayCloseTimer)
    overlaySettleTimer = setTimeout(() => {
      overlayCloseTimer = setTimeout(() => {
        diceOverlay.value = { visible: false, entries: [] }
      }, 600 + next.entries.length * 3600)
    }, 600)
  }

  function closeOverlay(): void {
    if (overlaySettleTimer) clearTimeout(overlaySettleTimer)
    if (overlayCloseTimer) clearTimeout(overlayCloseTimer)
    diceOverlay.value = { visible: false, entries: [] }
  }

  function totalPagesOf(roleId: RoleId): number {
    const role = engine?.controllers.find((c) => c.role.id === roleId)?.role
    if (!role) return 0
    return bookDocs[role.bookId]?.pages.length ?? 0
  }

  function handleEvent(e: EngineEvent): void {
    switch (e.type) {
      case 'phase':
        phase.value = e.phase
        break
      case 'kp-stream':
        streamingRaw.value += e.delta
        break
      case 'kp-narrative':
        streamingRaw.value = ''
        syncAll()
        scheduleSave()
        break
      case 'init-roll': {
        lastDice.value = { ...lastDice.value, [e.roleId]: e.dice }
        const role = engine?.controllers.find((c) => c.role.id === e.roleId)?.role
        const book = role ? bookDocs[role.bookId] : undefined
        const total = totalPagesOf(e.roleId)
        pushOverlayEntry({
          roleId: e.roleId,
          roleName: role?.name ?? e.roleId,
          isKp: role?.kind === 'kp',
          bookName: book?.name ?? '',
          dice: e.dice,
          diceNumber: diceToNumber(e.dice),
          modPage: total > 0 ? diceToNumber(e.dice) % total : 0,
          keywords: [],
          pageText: '',
          lands: [],
          nextPage: e.pageIndex,
          totalPages: total,
          init: true,
        })
        break
      }
      case 'roll': {
        lastDice.value = { ...lastDice.value, [e.roleId]: e.roll.dice }
        const role = engine?.controllers.find((c) => c.role.id === e.roleId)?.role
        const book = role ? bookDocs[role.bookId] : undefined
        const currentPage = engine?.pages[e.roleId] ?? 0
        const total = totalPagesOf(e.roleId)
        pushOverlayEntry({
          roleId: e.roleId,
          roleName: role?.name ?? e.roleId,
          isKp: role?.kind === 'kp',
          bookName: book?.name ?? '',
          dice: e.roll.dice,
          diceNumber: diceToNumber(e.roll.dice),
          modPage: total > 0 ? diceToNumber(e.roll.dice) % total : 0,
          keywords: e.roll.picks.map((p) => p.keyword),
          pageText: book?.pages[currentPage]?.text ?? '',
          lands: e.roll.picks.map((p) => ({
            dieIndex: p.dieIndex,
            keyword: p.keyword,
            onPage: p.pageIndex === currentPage,
            offset: p.offset,
            length: p.length,
          })),
          nextPage: e.roll.nextPageIndex,
          totalPages: total,
          init: false,
        })
        syncAll()
        break
      }
      case 'flip':
        bump(flipTick, e.roleId)
        pages.value = { ...pages.value, [e.roleId]: e.pageIndex }
        break
      case 'log':
        if (engine) log.value = [...engine.log]
        break
      case 'validator-done':
        syncAll()
        scheduleSave()
        break
      case 'mutated':
        syncAll()
        scheduleSave()
        break
      case 'error':
        showError(e.stage)
        break
    }
  }

  // ── 会话/连接 ──

  function makeClient(c: ConnectionConfig): LLMClient {
    return new LLMClient(c.baseUrl, c.apiKey)
  }

  function makeSession(c: ConnectionConfig, defaultTemp: number, modelLabel: string): LLMSession {
    return new LLMSession(makeClient(c), {
      model: c.model.trim() || modelLabel,
      temperature: parseTemperature(c.temperature) ?? defaultTemp,
      maxTokens: parseMaxTokens(c.maxTokens),
    })
  }

  function applyConfig(): void {
    if (!kpSession || !validatorSession) return
    kpSession.client = makeClient(config.form.kp)
    kpSession.params.model = config.form.kp.model.trim()
    kpSession.params.temperature = parseTemperature(config.form.kp.temperature) ?? 0.8
    kpSession.params.maxTokens = parseMaxTokens(config.form.kp.maxTokens)
    validatorSession.client = makeClient(config.form.validator)
    validatorSession.params.model = config.form.validator.model.trim()
    validatorSession.params.temperature = parseTemperature(config.form.validator.temperature) ?? 0.1
    validatorSession.params.maxTokens = parseMaxTokens(config.form.validator.maxTokens)
  }

  // 游戏进行中修改连接配置即时生效
  watch(
    () => config.form,
    () => applyConfig(),
    { deep: true },
  )

  // ── 书籍解析（按来源分流，pageWords 只作用于 TXT） ──

  function parseStored(stored: StoredBook, pageWords: number): BookDocument {
    if (stored.source === 'pdf') {
      return parsePdfPages(stored.id, stored.name, stored.pageTexts ?? [])
    }
    return parseTxt(stored.id, stored.name, stored.text ?? '', pageWords)
  }

  function metaOf(stored: StoredBook, pageWords: number): BookMeta {
    return stored.source === 'pdf'
      ? { id: stored.id, name: stored.name, source: 'pdf', pageWordCount: 0 }
      : { id: stored.id, name: stored.name, source: 'txt', pageWordCount: pageWords }
  }

  async function loadBooks(kpBookId: string, pcBookId: string, pageWords: number): Promise<boolean> {
    const kpStored = await books.getBook(kpBookId)
    const pcStored = await books.getBook(pcBookId)
    if (!kpStored || !pcStored) {
      ElMessage.error(t('booksMissing'))
      return false
    }
    bookDocs = { [kpBookId]: parseStored(kpStored, pageWords) }
    if (pcBookId !== kpBookId) {
      bookDocs[pcBookId] = parseStored(pcStored, pageWords)
    }
    bookTexts = { [kpBookId]: kpStored.text ?? '' }
    bookPageTexts = { [kpBookId]: kpStored.pageTexts ?? [] }
    if (pcBookId !== kpBookId) {
      bookTexts[pcBookId] = pcStored.text ?? ''
      bookPageTexts[pcBookId] = pcStored.pageTexts ?? []
    }
    const metas = new Map<string, BookMeta>()
    metas.set(kpBookId, metaOf(kpStored, pageWords))
    if (pcBookId !== kpBookId) metas.set(pcBookId, metaOf(pcStored, pageWords))
    bookMetas = [...metas.values()]
    return true
  }

  // ── 开局 ──

  async function startGame(setup: StartSetup): Promise<boolean> {
    if (!(await loadBooks(setup.kpBookId, setup.pcBookId, setup.pageWords))) return false

    const kpRoleDef: RoleDef = {
      id: 'kp',
      name: 'KP',
      kind: 'kp',
      controller: 'llm',
      bookId: setup.kpBookId,
    }
    const pcRoleDef: RoleDef = {
      id: 'pc-a',
      name: setup.pcName.trim() || '玩家A',
      kind: 'pc',
      controller: 'human',
      bookId: setup.pcBookId,
    }

    kpSession = makeSession(config.form.kp, 0.8, 'kp-model')
    validatorSession = makeSession(config.form.validator, 0.1, 'validator-model')
    humanController = new HumanController(pcRoleDef, {
      onAwaitAction: (v) => (awaitingAction.value = v),
    })
    const controllers: RoleController[] = [
      new LlmKpController(kpRoleDef, kpSession),
      humanController,
    ]

    engine = new GameEngine(validatorSession, handleEvent)
    const kpStoredName = bookMetas.find((m) => m.id === setup.kpBookId)?.name ?? ''
    saveName.value = `${kpStoredName} · ${new Date().toLocaleString()}`
    log.value = []
    streamingRaw.value = ''
    kpKeywordsHidden.value = false
    awaitingAction.value = false
    view.value = 'game'
    void engine.start(controllers, validatorSession, bookDocs, setup.diceCount).catch(() => {})
    scheduleSave()
    return true
  }

  // ── 游戏操作 ──

  async function submitAction(text: string): Promise<void> {
    // 行动通过人类控制器直达引擎；拒绝/通过信息由 Validator 卡片展示
    humanController?.submitText(text)
  }

  /** 发起重骰：确认弹窗即玩家的同意；其余角色（KP）由引擎协商 */
  async function requestReroll(): Promise<void> {
    if (!engine || !pcRole.value || !canReroll.value) return
    try {
      await ElMessageBox.confirm(t('rerollConfirmText'), t('rerollConfirmTitle'), {
        confirmButtonText: t('rerollConfirmYes'),
        cancelButtonText: t('cancel'),
        type: 'warning',
      })
    } catch {
      return
    }
    const ok = await engine.requestReroll(pcRole.value.id)
    if (ok) ElMessage.success(t('rerollStarted'))
  }

  async function retryInterrupted(): Promise<void> {
    engine?.retryInterrupted()
  }

  function abort(): void {
    engine?.abort()
  }

  function newGame(): void {
    engine?.stop()
    engine = null
    kpSession = null
    validatorSession = null
    humanController = null
    view.value = 'setup'
    phase.value = 'setup'
    log.value = []
    world.value = null
    round.value = 0
    streamingRaw.value = ''
    awaitingAction.value = false
    closeOverlay()
  }

  function bookDocOf(role: RoleDef): BookDocument | undefined {
    return bookDocs[role.bookId]
  }

  // ── 存档 ──

  function buildSaveFile(includeText: boolean): SaveFileV1 | null {
    if (!engine || !kpSession || !validatorSession) return null
    return buildSave(
      saveName.value,
      engine.snapshot(),
      kpSession.serialize(),
      validatorSession.serialize(),
      bookMetas.map((m) =>
        m.source === 'pdf'
          ? { ...m, pageTexts: includeText ? bookPageTexts[m.id] : undefined }
          : { ...m, text: includeText ? bookTexts[m.id] : undefined },
      ),
    )
  }

  function saveToLocal(): void {
    const save = buildSaveFile(false)
    if (!save) return
    try {
      localStorage.setItem(LS_SAVE_KEY, encodeSaveFile(save))
      hasLocalSave.value = true
    } catch {
      // 存储满等情况忽略，导出文件仍可用
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveToLocal, 800)
  }

  function clearLocalSave(): void {
    localStorage.removeItem(LS_SAVE_KEY)
    hasLocalSave.value = false
  }

  /** 用已解析的 SaveFile 恢复对局（书内容必须已就位） */
  async function restoreFromSave(save: SaveFileV1): Promise<boolean> {
    if (!config.connectionReady(config.form.kp) || !config.connectionReady(config.form.validator)) {
      ElMessage.warning(t('needConfigFirst'))
      return false
    }
    const docs: Record<string, BookDocument> = {}
    const metas: BookMeta[] = []
    for (const meta of save.books) {
      const stored = await books.getBook(meta.id)
      const hasContent = stored && ((meta.source === 'pdf' && stored.pageTexts?.length) || (meta.source === 'txt' && stored.text))
      if (!hasContent) {
        ElMessage.error(t('saveBookMissing', { name: meta.name }))
        return false
      }
      docs[meta.id] = parseStored(stored, meta.pageWordCount)
      metas.push({ ...meta })
    }
    bookDocs = docs
    bookTexts = {}
    bookPageTexts = {}
    for (const meta of save.books) {
      const stored = await books.getBook(meta.id)
      bookTexts[meta.id] = stored?.text ?? ''
      bookPageTexts[meta.id] = stored?.pageTexts ?? []
    }
    bookMetas = metas

    kpSession = makeSession(config.form.kp, 0.8, 'kp-model')
    validatorSession = makeSession(config.form.validator, 0.1, 'validator-model')
    // 只恢复 KP 消息历史与摘要；连接与模型以本机配置为准（BYOK）
    kpSession.messages = save.kpSession.messages
    kpSession.summaryText = save.kpSession.summaryText

    const snapshot = save.engine
    const controllers: RoleController[] = snapshot.roles.map((role) =>
      role.kind === 'kp'
        ? new LlmKpController(role, kpSession!)
        : new HumanController(role, {
            onAwaitAction: (v) => (awaitingAction.value = v),
          }),
    )
    humanController = (controllers.find((c) => c.role.kind === 'pc') as HumanController) ?? null

    engine = new GameEngine(validatorSession, handleEvent)
    engine.restore(snapshot, controllers, docs)
    void engine.resumeLoop()

    saveName.value = save.name
    view.value = 'game'
    syncAll()
    return true
  }

  async function continueLocalSave(): Promise<boolean> {
    const raw = localStorage.getItem(LS_SAVE_KEY)
    if (!raw) return false
    const save = decodeSaveFile(raw)
    if (!save) {
      ElMessage.error(t('saveCorrupted'))
      return false
    }
    return restoreFromSave(save)
  }

  async function exportSaveFile(): Promise<void> {
    const save = buildSaveFile(true)
    if (!save) return
    const blob = new Blob([encodeSaveFile(save)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    link.download = `kpet-save-${stamp}.json`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importSaveFile(file: File): Promise<boolean> {
    try {
      const text = await file.text()
      const save = decodeSaveFile(text)
      if (!save) {
        ElMessage.error(t('saveCorrupted'))
        return false
      }
      // 内嵌书内容写入书库（自包含恢复）
      for (const meta of save.books) {
        if (meta.source === 'txt' && meta.text?.trim()) {
          await books.putBook({
            id: meta.id,
            name: meta.name,
            source: 'txt',
            text: meta.text,
            wordCount: 0,
            addedAt: new Date().toISOString(),
          })
        } else if (meta.source === 'pdf' && meta.pageTexts?.length) {
          await books.putBook({
            id: meta.id,
            name: meta.name,
            source: 'pdf',
            pageTexts: meta.pageTexts,
            wordCount: 0,
            addedAt: new Date().toISOString(),
          })
        }
      }
      return await restoreFromSave(save)
    } catch {
      ElMessage.error(t('saveCorrupted'))
      return false
    }
  }

  function checkLocalSave(): void {
    hasLocalSave.value = Boolean(localStorage.getItem(LS_SAVE_KEY))
  }

  // ── 诊断格式化 ──

  function formatDiagnostics(d: LlmDiagnostics): string {
    const lines = [
      `time: ${d.time}`,
      `stage: ${d.stage}`,
      `endpoint: ${d.endpoint}`,
      `model: ${d.model}`,
      `app: kp-explain-this`,
      `userAgent: ${d.userAgent}`,
    ]
    if (typeof d.status === 'number') lines.push(`httpStatus: ${d.status} ${d.statusText ?? ''}`.trim())
    if (d.errorMessage) lines.push(`error: ${d.errorMessage}`)
    if (d.bodyExcerpt) lines.push(`responseBody:\n${d.bodyExcerpt}`)
    return lines.join('\n')
  }

  async function copyDiagnostics(): Promise<void> {
    if (!diagnostics.value) return
    try {
      await navigator.clipboard.writeText(formatDiagnostics(diagnostics.value))
      ElMessage.success(t('diagnosticsCopied'))
    } catch {
      ElMessage.error(t('copyFailed'))
    }
  }

  return {
    // 状态
    view, phase, phaseLabel, round, roles, keywords, pages, rolls, log, world,
    sceneEndHint, streamingNarrative, summarizing, flipTick, lastDice,
    kpKeywordsHidden, saveName, hasLocalSave, diagnostics, diagnosticsOpen,
    awaitingAction, diceOverlay,
    kpRole, pcRole, running, canSubmit, canReroll,
    // 书库
    books,
    // 操作
    startGame, submitAction, requestReroll, retryInterrupted, abort, newGame,
    bookDocOf,
    // 存档
    saveToLocal, clearLocalSave, continueLocalSave, exportSaveFile, importSaveFile, checkLocalSave,
    // overlay
    closeOverlay,
    // 诊断
    formatDiagnostics, copyDiagnostics,
  }
}

export type UseGame = ReturnType<typeof useGame>
