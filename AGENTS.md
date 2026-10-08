# AGENTS.md — 项目内部架构说明（给 AI 协作者）

阅读顺序：README.md → 本文件 → `src/core/types.ts`。

## 技术栈与边界

- Vue 3.5 `<script setup lang="ts">` + Element Plus + vue-i18n（仅中文，结构保留双语扩展位）+ Vite 8。无路由、无 Pinia——共享状态在 `App.vue` 组合根里实例化一次的 composables（沿用 YA-BYOK-Chat 约定）。
- **`src/core/` 是框架无关纯 TypeScript**：禁止 import vue / element-plus / 浏览器 DOM API（`crypto`、`fetch`、`Intl`、`AbortSignal` 等运行时标准 API 除外），保证 vitest 在 node 环境直接测试。UI 关注点一律放 `src/composables/`、`src/components/`。pdfjs 只在 `useBooks` 里动态 import。
- 严格 TS：`noUnusedLocals` / `noUnusedParameters` / `erasableSyntaxOnly`（**禁止 enum、构造器参数属性**，用 `const` 对象 + 联合类型）。`verbatimModuleSyntax`：类型导入必须 `import type`。
- **动画禁用 `requestAnimationFrame`**：部分嵌入 webview 不触发 rAF（曾导致动画"完全没实现"）。动画一律用 CSS animation + `:key` 重挂载重放，定时用 `setTimeout`。

## 命令

- `npm run dev` — Vite dev server
- `npm test` — vitest（node env，`src/**/*.test.ts`）
- `npm run build` — `vue-tsc -b` 类型检查 + 构建（**提交前必须全绿**）

## 核心数据流（改代码前先理解）

```
RoleController 三变种（本地 / LLM / 在线占位）：
   HumanController（本地玩家，挂起 Promise）
   BaseLlmController ← LlmKpController（KP 叙事+state_changes）/ LlmPcController（PC 行动，被驳回自动带理由重写）
   （未来 RemoteController 接在线玩家：实现接口即可，引擎零改动）
   ↕ requestAction / requestRerollConsent / sceneCheckpoint·Restore
GameEngine（纯编排，validator 为系统服务）
   ├─ rollRound: 掷骰（BookDocument 页模型）→ 关键词 + 下一页（按落词阅读顺序组合 1d10^K mod 总页数）；建重骰回滚点
   ├─ kpAct: KP 输出（markdown 叙事 + ```json state_changes``` 围栏）
   │    → json-out.parseKpOutput 容错拆分 → world 清洗合并 → scene_end 检测
   ├─ collectValidatedAction: PC 行动（pc-act 请求携带 sceneNarrative 供 LLM PC 读取；
   │    LLM PC 生成失败→interrupted 重试、连续 3 次空回复/驳回→interrupted 护栏；
   │    pc-acting 事件驱动 UI「正在行动」chip 并禁用本地输入）
   │    → Validator（无状态，上下文每次重建）
   │    → verdictPass（valid && 全关键词 && 世界一致，逐字采用）→ 通过才转 KP
   ├─ scene_end=true → 等本场景每位 PC 至少行动一次 → finishScene 自动翻页 → 下一轮（没有手动结束入口）
   └─ requestReroll: 全体同意（LLM 角色恒同意）→ doReroll 回滚 world/log/控制器历史
        → **跳过本轮**（翻到 pendingNextPages 骰面指示页）→ 新页重掷重开
```

## 各模块要点

- `core/controller.ts`：**控制器三变种，扩展多真人 PC / 多 LLM PC / 联机的唯一入口**——实现 `RoleController` 接口即可，引擎零改动。HumanController 用挂起 Promise（UI 经 useGame 调 `submitText`/`consent` resolve）；`BaseLlmController` 持会话 + 回滚点（历史长度+摘要）+ 恒同意重骰；`LlmPcController` 走 `pc-act`：prompt 见 `prompts.ts` PC 侧（与 Validator 同一宽松口径），`onRejected` 暂存理由、下次请求自动带"被驳回"重写，失败时弹出悬挂 user 消息。在线玩家（RemoteController）尚未实现，接口即契约。
- `core/engine.ts`：主循环 `mainLoop(startWithRoll)`；`resumeLoop()` 供存档恢复续跑；phase 含 `interrupted`（生成失败/中止，UI 可重试或重骰）与 `reroll`。恢复时 busy phase 收敛为 await-action 并重建回滚点。
- `core/book.ts`：页导向 `BookDocument.pages[]`，词偏移相对页文本（TXT 切片平移 / PDF 页内分词）。`nearestValidPage` 跳过无字页；`pickKeywordOnPage` 跨页兜底；`diceReachableMaxPage`（=10^骰数）用于覆盖警告。
- `core/randomizer.ts`：骰面与落点分别随机产生；页面命中词按页内文本阅读顺序、封面骰子按纵坐标再横坐标排序，依次组成高位到低位（面 10 视为 0），再对总页数取模。书签展示落点顺序、数字和页码（含无字页就近映射标注）。
- `core/llm/session.ts`：systemPrompt 支持函数形式（每请求携带最新 WorldState）；历史里 assistant 只存叙事（`amendLastAssistant`）；滚动摘要水位机制防失败循环。
- `composables/useGame.ts`：引擎↔Vue 桥。引擎内部数组被原地修改，**同步到响应式必须浅拷贝**（`syncAll`）。掷骰 overlay 用"600ms 无新骰即落定、2.6s 自动关闭"的防抖策略。游戏进行中修改连接配置即时重建 client/params（含 LLM PC 会话，共用一个 pcLlm client）。LLM PC 各自独立会话（`pcLlmSessions`），本地玩家保持 `pcControllers[0]`（物品归属）。「LLM 代写」= pcLlm 连接的一次性 `complete`（`buildPcAssistMessages`，无会话状态），草稿经 `assistInsert` ref 注入输入框、**不自动提交**。
- `composables/useBooks.ts`：TXT（UTF-8 严格解码失败回退 GBK）/ PDF（pdfjs 按页抽文本、y 坐标重组行）→ IndexedDB；`wordCount` 供书架页数估算。
- 连接配置：`kpet-config` 三连接（kp / validator / pcLlm）；旧档缺 pcLlm 字段读取时归一化为默认。
- 存档：localStorage `kpet-save`（不含书正文）+ IndexedDB `kpet-books`；导出 JSON 内嵌正文（TXT 全文 / PDF pageTexts），`pcSessions`（可选）存各 LLM PC 会话。恢复时模型/端点取本机配置，只还原历史/摘要/世界状态。
- i18n：所有 UI 文案在 `src/i18n.ts` 的 zh 字典（`phase.*`、`setup.*`、`world.*`、`diceOverlay.*` 为嵌套命名空间）。

## 约定

- 随机数只走 `core/randomizer.ts`（crypto + 拒绝采样），LLM 永远不允许产生随机结果。
- Validator 判定标准是**宽松即兴标准**（用户产品决策，覆盖 story.md 早期的严格原则）：这是 improv 游戏，任何回应形式（含纯内心独白）都合法；关键词字面出现或任何相关展开（同义/翻译/指代/联想）即算使用，唯一 false 情形是"完全无痕迹"；世界一致性只拦硬性违规（凭空获得物品/能力、瞬移、否认既立事实、替 KP/NPC 做重大决定），主观感受与想象交给 KP 裁决。**用人不疑：判定结论逐字采用 LLM 输出，代码不改写、不补默认值**——判得过严/过宽只能回 `prompts.ts` 调 prompt（含判例锚点），绝不在 `validator.ts` 里覆写模型结论。输出不完整（缺字段/关键词未覆盖）按坏判定重试，仍失败走调用失败路径。
- 演出是需求本体而非装饰：掷骰演出必须呈现"实体书 + 骰子落在真实词位上"（DiceOverlay 渲染封皮/内页/书脊，测量 `[data-land]` 标记位置后绝对定位骰子），不接受抽象化替代。
- LLM 输出一律视为不可信输入：JSON 经 `json-out.ts` 容错解析 + `world.ts` 清洗（含 `state_changes` 嵌套解包）后才进入 WorldState；未知字段丢弃并产生 warning 日志。
- 验收参考 story.md「验收标准」；新增玩法逻辑先在 `src/core/*.test.ts` 补测试（引擎集成测试注入真实 HumanController + monkeypatch 的 `LLMClient.stream/complete`，见 `engine.test.ts`，已含双 PC/重骰回滚/中断恢复/快照续跑用例）。
