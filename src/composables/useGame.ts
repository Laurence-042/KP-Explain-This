import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { GameEngine, type EngineEvent } from '../core/engine'
import {
  HumanController,
  LlmKpController,
  LlmPcController,
  stripFences,
  type RoleController,
} from '../core/controller'
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
import { buildPcAssistMessages } from '../core/prompts'
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
  /** LLM 扮演的玩家（独立行动、过 Validator） */
  llmPcs: Array<{ name: string; bookId: string }>
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
  landings: Array<{ x: number; y: number }>
  keywords: string[]
  /** 初掷为即将翻开的目标页；其余为掷骰所在页 */
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
  /** 当前客户端代表的角色。与当前正在查看哪本书分开，联机接入时可由会话身份设置。 */
  const viewerRoleId = ref<RoleId | null>(null)
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
  const saveName = ref('')
  const hasLocalSave = ref(false)
  const awaitingAction = ref(false)
  /** 正在生成行动的 LLM PC 名字（空 = 无） */
  const pcActing = ref('')
  /** 「LLM 代写」草稿注入（seq 递增触发 ActionComposer 合并进输入框） */
  const assistInsert = ref<{ seq: number; text: string } | null>(null)
  const assisting = ref(false)

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
  /** LLM PC 会话（RoleId → 独立历史），共享一个 pcLlm 传输 client */
  let pcLlmSessions: Record<RoleId, LLMSession> = {}
  let pcLlmClient: LLMClient | null = null
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
  const canSubmit = computed(() => phase.value === 'await-action' && !pcActing.value)
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
    if (!roles.value.some((r) => r.id === viewerRoleId.value)) {
      viewerRoleId.value = roles.value.find((r) => r.controller === 'human')?.id ?? null
    }
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
        : stage === 'pc-act' || stage === 'pc-assist'
          ? pcLlmClient
          : kpSession?.client
    diagnostics.value = client?.diagnostics ?? null
    diagnosticsOpen.value = true
    ElMessage.error(t('requestFailed'))
  }

  // ── 骰子 overlay：只演出当前视角角色，开局先合书初掷、再在翻开页上掷骰 ──

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
        if (e.roleId !== viewerRoleId.value) break
        const role = engine?.controllers.find((c) => c.role.id === e.roleId)?.role
        const book = role ? bookDocs[role.bookId] : undefined
        const total = totalPagesOf(e.roleId)
        pushOverlayEntry({
          roleId: e.roleId,
          roleName: role?.name ?? e.roleId,
          isKp: role?.kind === 'kp',
          bookName: book?.name ?? '',
          dice: e.dice,
          landings: e.landings,
          keywords: [],
          pageText: book?.pages[e.pageIndex]?.text ?? '',
          lands: [],
          nextPage: e.pageIndex,
          totalPages: total,
          init: true,
        })
        break
      }
      case 'roll': {
        if (e.roleId !== viewerRoleId.value) {
          syncAll()
          break
        }
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
          landings: [],
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
      case 'pc-acting':
        pcActing.value = e.active ? e.roleName : pcActing.value === e.roleName ? '' : pcActing.value
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
    pcLlmClient = makeClient(config.form.pcLlm)
    for (const s of Object.values(pcLlmSessions)) {
      s.client = pcLlmClient
      s.params.model = config.form.pcLlm.model.trim() || 'pc-llm-model'
      s.params.temperature = parseTemperature(config.form.pcLlm.temperature) ?? 0.8
      s.params.maxTokens = parseMaxTokens(config.form.pcLlm.maxTokens)
    }
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

  async function loadBooks(bookIds: string[], pageWords: number): Promise<boolean> {
    const uniqueIds = [...new Set(bookIds.filter(Boolean))]
    if (uniqueIds.length === 0) {
      ElMessage.error(t('booksMissing'))
      return false
    }
    const docs: Record<string, BookDocument> = {}
    const texts: Record<string, string> = {}
    const pageTextsMap: Record<string, string[]> = {}
    const metas = new Map<string, BookMeta>()
    for (const id of uniqueIds) {
      const stored = await books.getBook(id)
      if (!stored) {
        ElMessage.error(t('booksMissing'))
        return false
      }
      docs[id] = parseStored(stored, pageWords)
      texts[id] = stored.text ?? ''
      pageTextsMap[id] = stored.pageTexts ?? []
      metas.set(id, metaOf(stored, pageWords))
    }
    bookDocs = docs
    bookTexts = texts
    bookPageTexts = pageTextsMap
    bookMetas = [...metas.values()]
    return true
  }

  // ── 开局 ──

  async function startGame(setup: StartSetup): Promise<boolean> {
    const needPcLlm = setup.llmPcs.length > 0
    if (needPcLlm && !config.connectionReady(config.form.pcLlm)) {
      ElMessage.warning(t('pcLlmNotReady'))
      return false
    }
    if (
      !(await loadBooks(
        [setup.kpBookId, setup.pcBookId, ...setup.llmPcs.map((p) => p.bookId)],
        setup.pageWords,
      ))
    ) {
      return false
    }

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
    pcLlmClient = makeClient(config.form.pcLlm)
    pcLlmSessions = {}
    const controllers: RoleController[] = [new LlmKpController(kpRoleDef, kpSession)]
    humanController = new HumanController(pcRoleDef, {
      onAwaitAction: (v) => (awaitingAction.value = v),
    })
    // 本地玩家保持在 pcControllers[0]（引擎把获得的物品记到首个 PC 名下），LLM PC 随后
    controllers.push(humanController)
    setup.llmPcs.forEach((p, i) => {
      const id = `pc-llm-${i + 1}`
      const roleDef: RoleDef = {
        id,
        name: p.name.trim() || `玩家${'BCDEF'[i] ?? i + 1}`,
        kind: 'pc',
        controller: 'llm',
        bookId: p.bookId,
      }
      const session = makeSession(config.form.pcLlm, 0.8, 'pc-llm-model')
      session.client = pcLlmClient!
      pcLlmSessions[id] = session
      controllers.push(new LlmPcController(roleDef, session))
    })

    engine = new GameEngine(validatorSession, handleEvent)
    const kpStoredName = bookMetas.find((m) => m.id === setup.kpBookId)?.name ?? ''
    saveName.value = `${kpStoredName} · ${new Date().toLocaleString()}`
    log.value = []
    streamingRaw.value = ''
    awaitingAction.value = false
    pcActing.value = ''
    viewerRoleId.value = pcRoleDef.id
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

  /** 「LLM 代写」：用 LLM 玩家连接为本地玩家草拟行动，填入输入框（不自动提交） */
  async function requestAssist(): Promise<void> {
    if (!engine || !pcRole.value || !canSubmit.value || assisting.value) return
    if (!config.connectionReady(config.form.pcLlm)) {
      ElMessage.warning(t('pcLlmNotReady'))
      return
    }
    assisting.value = true
    try {
      const role = pcRole.value
      const messages = buildPcAssistMessages(
        role.name,
        engine.world,
        engine.keywords[role.id] ?? [],
        engine.round,
        engine.currentSceneNarrative,
      )
      const client = pcLlmClient ?? (pcLlmClient = makeClient(config.form.pcLlm))
      const raw = await client.complete(
        {
          model: config.form.pcLlm.model.trim() || 'pc-llm-model',
          messages,
          temperature: parseTemperature(config.form.pcLlm.temperature) ?? 0.8,
          maxTokens: parseMaxTokens(config.form.pcLlm.maxTokens),
        },
        'pc-assist',
      )
      const text = stripFences(raw)
      if (text) {
        assistInsert.value = { seq: (assistInsert.value?.seq ?? 0) + 1, text }
      }
    } catch {
      showError('pc-assist')
    } finally {
      assisting.value = false
    }
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
    pcLlmSessions = {}
    pcLlmClient = null
    view.value = 'setup'
    viewerRoleId.value = null
    phase.value = 'setup'
    log.value = []
    world.value = null
    round.value = 0
    streamingRaw.value = ''
    awaitingAction.value = false
    pcActing.value = ''
    assisting.value = false
    closeOverlay()
  }

  function bookDocOf(role: RoleDef): BookDocument | undefined {
    return bookDocs[role.bookId]
  }

  // ── 存档 ──

  function buildSaveFile(includeText: boolean): SaveFileV1 | null {
    if (!engine || !kpSession || !validatorSession) return null
    const pcSessions: Record<string, ReturnType<LLMSession['serialize']>> = {}
    for (const [id, s] of Object.entries(pcLlmSessions)) pcSessions[id] = s.serialize()
    return buildSave({
      name: saveName.value,
      engine: engine.snapshot(),
      kpSession: kpSession.serialize(),
      validatorSession: validatorSession.serialize(),
      pcSessions,
      books: bookMetas.map((m) =>
        m.source === 'pdf'
          ? { ...m, pageTexts: includeText ? bookPageTexts[m.id] : undefined }
          : { ...m, text: includeText ? bookTexts[m.id] : undefined },
      ),
    })
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
    pcLlmClient = makeClient(config.form.pcLlm)
    pcLlmSessions = {}
    const savedPcSessions = save.pcSessions ?? {}
    const controllers: RoleController[] = snapshot.roles.map((role) => {
      if (role.kind === 'kp') return new LlmKpController(role, kpSession!)
      if (role.controller === 'llm') {
        // LLM PC：会话参数取本机配置，只还原历史与摘要（旧档无 pcSessions 则空会话）
        const session = makeSession(config.form.pcLlm, 0.8, 'pc-llm-model')
        session.client = pcLlmClient!
        const saved = savedPcSessions[role.id]
        if (saved) {
          session.messages = saved.messages
          session.summaryText = saved.summaryText
        }
        pcLlmSessions[role.id] = session
        return new LlmPcController(role, session)
      }
      return new HumanController(role, {
        onAwaitAction: (v) => (awaitingAction.value = v),
      })
    })
    humanController = (controllers.find((c) => c instanceof HumanController) as HumanController) ?? null

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
    view, phase, phaseLabel, round, roles, viewerRoleId, keywords, pages, rolls, log, world,
    sceneEndHint, streamingNarrative, summarizing, flipTick,
    saveName, hasLocalSave, diagnostics, diagnosticsOpen,
    awaitingAction, diceOverlay, pcActing, assistInsert, assisting,
    kpRole, pcRole, running, canSubmit, canReroll,
    // 书库
    books,
    // 操作
    startGame, submitAction, requestReroll, retryInterrupted, abort, newGame,
    requestAssist,
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
