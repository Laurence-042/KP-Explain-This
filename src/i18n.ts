import { createI18n } from 'vue-i18n'

// MVP 阶段仅提供中文文案；保留 vue-i18n 结构便于后续补充其他语言。
const messages = {
  zh: {
    appTitle: 'KP·Explain This',
    appSubtitle: '关键词即兴叙事',

    // 通用
    settings: '设置',
    close: '关闭',
    model: '模型',
    modelPlaceholder: '选择或输入模型名称',
    advanced: '高级选项',
    temperature: '温度 (Temperature)',
    temperatureHint: '取值 0–2，留空使用默认（KP 建议 0.7–1.0）',
    validatorTemperatureHint: '取值 0–2，留空使用默认 0.1（Validator 需要低创造性）',
    maxTokens: '最大输出 Tokens',
    maxTokensHint: '留空则由服务端默认值决定',
    copied: '已复制',
    copyFailed: '复制失败，请手动复制',

    // 请求失败 / 诊断
    requestFailed: '请求失败',
    requestFailedHint: '请求未成功完成。可点击下方按钮复制诊断信息排查。API Key 已自动隐去。',
    diagnosticsTitle: '诊断信息',
    copyDiagnostics: '复制诊断信息',
    diagnosticsCopied: '诊断信息已复制',

    // 阶段
    phase: {
      setup: '未开局',
      'init-roll': '合书初掷',
      rolling: '掷骰取词',
      'kp-scene': 'KP 叙述中',
      'await-action': '等待你的行动',
      validating: 'Validator 判定中',
      'kp-resolve': 'KP 推进剧情',
      'scene-end': '场景结束 · 翻页',
      interrupted: '生成已中断',
      reroll: '重骰中',
    },

    // 游戏
    emptyGame: '游戏尚未开始。',
    roundLabel: '第 {n} 轮',
    roundBadge: '第 {n} 轮',
    validatorName: 'Validator',
    verdictPassed: '行动通过验证',
    verdictRejected: '行动被驳回',
    worldInconsistentNote: '（注意：世界状态一致性未通过）',
    validating: 'Validator 正在独立判定你的行动…',
    kpSceneOpening: 'KP · 场景',
    kpNarrative: 'KP · 推进',
    actionPlaceholder: '描述你的行动（Enter 提交，Shift+Enter 换行）。行动必须真正用上你的三个关键词。',
    submitAction: '提交行动',
    abort: '中止',
    abortHint: '中止当前生成（该次输出将作废）',
    retryInterrupted: '重试生成',
    rerollScene: '重骰场景',
    rerollHint: '需要全体角色同意（KP 会同意）：回滚本轮世界状态与剧情，重新掷骰并生成新场景',
    rerollConfirmTitle: '重骰本场景？',
    rerollConfirmText: '本轮的世界状态与剧情将被回滚，重新掷骰并生成一个全新的场景。KP 会自动同意。此操作不可撤销。',
    rerollConfirmYes: '同意并重骰',
    cancel: '取消',
    rerollStarted: '全体同意，正在重骰本场景…',
    backToSetup: '已返回开局设置',
    flippingText: '……',

    // 掷骰动画
    diceOverlay: {
      title: '掷骰',
      initialRoll: '合书初掷',
      flipTo: '→ 翻到第 {n} / {total} 页',
      hint: '点击任意处继续',
    },

    // 关键词条
    pcTag: '玩家',
    kpName: 'KP',
    kpTag: '主持人',
    showKpKeywords: '显示',
    hideKpKeywords: '隐藏',

    // 书页
    bookLabel: '的书',
    pageOf: '第 {current} / {total} 页',
    bookEmpty: '（没有内容）',
    kpBookHidden: 'KP 的书页与关键词已隐藏',

    // 世界状态
    worldStateTitle: '世界状态',
    world: {
      round: '轮次',
      location: '当前地点',
      time: '时间',
      scene: '当前场景',
      players: '玩家',
      npcs: 'NPC',
      facts: '已确立事实',
      events: '已发生事件',
      plotVariables: '剧情变量',
      undecided: '（未定）',
      none: '（暂无）',
      noGame: '尚未开始游戏。',
      showRaw: '查看原始 JSON',
      hideRaw: '收起 JSON',
    },

    // 开局面板
    setup: {
      needConfig: '开始前需要先配置 KP 与 Validator 的 API 连接（BYOK，密钥只保存在本机浏览器）。',
      openSettings: '打开设置',
      library: '书库',
      importBooks: '导入 TXT / PDF',
      libraryHint: '导入 2 本书（可相同）：1 本给 KP，1 本给玩家。TXT 按词数虚拟分页，PDF 按真实页解析。文件保存在本机浏览器（IndexedDB）。',
      libraryEmpty: '书架还空着，先导入几本书吧。',
      bookPages: '{n} 页',
      bookPagesEst: '≈{n} 页',
      roles: '开局配置',
      kpBook: 'KP 的书',
      pcBook: '你的书',
      pickBook: '选择书籍',
      pcName: '你的名字',
      pcNamePlaceholder: '玩家A',
      diceCount: '骰子数量',
      diceCountHint: '掷在书页上的 1d10 骰子个数（= 关键词个数）；骰面按个/十/百位组合决定翻页（3 个 ≈ 1d1000）',
      pageWords: '每页词数',
      pageWordsHint: 'TXT 虚拟分页的页大小，影响骰子落点密度（仅对 TXT 生效）',
      pdfNoPageWords: '已选 PDF：此设置只对 TXT 生效',
      diceCoverageWarning:
        '《{name}》共约 {pages} 页，{n} 个骰子按位组合最多均匀覆盖 {max} 页：超出部分的页永远不会被翻到。建议增加骰子数量。',
      continueSave: '继续上次存档',
      importSave: '导入存档文件',
      start: '开始游戏',
    },
    bookImported: '已导入《{name}》',
    bookImportFailed: '《{name}》导入失败（空文件或读取错误）',
    booksMissing: '所选书籍已不存在，请重新导入',
    needConfigFirst: '请先在设置中配置好 KP 与 Validator 的连接，再恢复存档',
    saveBookMissing: '存档引用的《{name}》缺少正文，无法恢复',
    saveCorrupted: '存档文件无效或已损坏',
    saveImported: '存档已导入并恢复',

    // 设置抽屉
    kpModelSection: 'KP 连接（叙事/推进剧情）',
    kpModelHint: '偏向创作能力与长上下文的模型，温度建议 0.7–1.0。',
    validatorModelSection: 'Validator 连接（独立判定）',
    validatorModelHint: '偏向指令遵循与稳定 JSON 输出的模型，温度建议 0–0.2，可以是便宜的模型。',
    copyKpConnection: '复制 KP 连接',
    kpConnectionCopied: '已把 KP 的 Base URL / API Key 复制给 Validator（模型保持独立）',

    // 头部菜单
    saveMenu: '存档',
    exportSave: '导出存档文件',
    newGame: '新游戏（回到设置）',
    sceneEndSuggested: 'KP 建议收尾本场景',
  },
}

export const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'zh',
  messages,
})
