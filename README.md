# KP，编啊 — 关键词即兴叙事

本项目采用 [MIT License](LICENSE)。

把骰子扔在书上，用砸中的词讲故事。

一款基于**随机文本约束**的即兴叙事游戏（MVP）：导入 TXT/PDF 电子书，系统用程序掷骰从书中随机抽取关键词，玩家（PC）与 LLM 主持人（KP）各自被自己的关键词约束——KP 用关键词驱动场景，玩家的行动必须**真正使用**自己的关键词并通过独立 Validator 的验证，剧情才会推进。

基于 [YA-BYOK-Chat](../YA-BYOK-Chat) 脚手架二次开发。BYOK：API Key 只保存在本机浏览器，浏览器直连任意 OpenAI 兼容端点，无后端。

## 玩法循环

```
导入 TXT / PDF → 合书初掷（定初始页，掷骰动画）
  ↓
每轮：在打开的书页上掷 K 个 1d10（全屏演出：带封皮/书脊/内页的实体书，骰子落定在被砸中的词上，
  书签可查看「落点顺序 → 骰面数字 → 取模 → 页码」的推导）
  ├─ 骰子盖住的词 = 本轮关键词（PC 一组 / KP 一组）
  └─ 骰子按落点从上到下、同行从左到右排成数字（面 10 视为 0；3 颗骰子 ≈ 1d1000）
     mod 总页数 = 本轮结束后翻到的页（翻页动画；无字页就近映射并在演出中标注）
  ↓
KP LLM 用 KP 关键词生成场景（流式叙事）
  ↓
玩家用 PC 关键词描述行动
  ↓
Validator LLM 独立判定（宽松即兴标准：关键词实质展开即可，只拦硬性世界违规）
  ├─ 驳回 → 玩家修改重交（KP 全程不知情）
  └─ 通过 → KP 推进剧情，输出 叙事 + 结构化 state_changes
  ↓
KP 判定场景自然收尾（scene_end）→ 自动翻页 → 下一轮
  （多人场景会等每位 PC 至少行动一次，再兑现 KP 的收尾建议）
  （没有"主动结束场景"按钮；对当前场景不满意可发起"重骰场景"，
    需全体角色同意——LLM KP 默认同意——重骰即**跳过本轮**：回滚后直接翻到
    本轮骰面指示的页，在新页重掷开局）
```

**关键设计**：KP 与 Validator 是两个完全独立的 LLM Session（可分别配置不同模型/温度/端点）。Validator 按**宽松即兴标准**判定——这是即兴游戏，内心独白、对话、观察、联想都算合法回应，关键词实质展开即可，只有凭空获得物品、瞬移、否认既定事实这类硬性世界违规才会驳回。世界状态（地点/物品/NPC/事实）以结构化 JSON 维护，不依赖聊天记录。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core 纯逻辑单元测试（vitest）
npm run build      # vue-tsc 类型检查 + 产物构建
```

1. 打开 **设置**，配置三组连接：**KP**、**Validator** 与 **LLM 玩家**（Base URL / API Key / 模型；后两者可一键复制 KP 的连接）。KP / LLM 玩家建议高温度创作型模型，Validator 建议低温度、JSON 稳定的便宜模型。LLM 玩家连接供独立 LLM PC 与"LLM 代写"使用，不配也不影响纯本地玩法。
2. 在开局面板**导入 TXT / PDF**（至少 1 本，各角色可共用）。TXT 按词数虚拟分页（每页词数可调），PDF 按**真实页**解析；书架会显示每本书的页数。为 KP 和你自己各分配一本书；**可添加若干「LLM 玩家」**（各自的名字与书，由 LLM 扮演并自主行动）。设置骰子数（默认 3，骰面按落点阅读顺序组成页码数字，3 个 ≈ 1d1000）——若书页数超过骰子组合上限（10^骰数），系统会警告"靠后的页永远摇不到"。
3. **开始游戏**。掷骰动画落定后看关键词 → 阅读 KP 场景（书页上的命中词高亮）→ 描述行动（Enter 提交；写不出就点 **LLM 代写**，生成草稿填入输入框，可修改后提交）→ 等待 Validator 判定 → 被驳回就换种写法，通过则剧情推进。有 LLM PC 时它们会在你之后自主行动（行动中显示"正在行动"提示），同样要过 Validator，被驳回会自动重写。
4. 场景由 KP 通过 `scene_end` 自然收尾，自动翻页进入下一轮（翻页有纸张翻覆动画）。对场景不满意：**重骰场景**（确认后回滚重来）。生成卡住可**中止**并重试。
5. 存档：自动保存到本机（localStorage + IndexedDB 存书）；也可从顶部 **存档** 菜单导出/导入自包含 JSON 文件。各角色关键词一直显示在共享记事本上，世界状态随时可在抽屉中查看。

## 架构

```
src/
├── core/                  # 框架无关纯逻辑（vitest 覆盖，不 import vue）
│   ├── controller.ts      # ★ RoleController 三变种：HumanController（本地玩家）、
│   │                        BaseLlmController ← LlmKpController / LlmPcController（LLM），
│   │                        在线玩家实现同一接口即可接入（引擎零改动）
│   ├── engine.ts          # 纯编排状态机：只面向 RoleController；scene_end 自动收尾；
│   │                        全体同意重骰（回滚 world/log/控制器历史）；快照恢复+续跑
│   ├── book.ts            # 页导向 BookDocument：TXT 虚拟分页 + PDF 真实页（parsePdfPages 纯函数）
│   │                        骰位映射/最近有效页/跨页取词兜底/骰子覆盖上限
│   ├── randomizer.ts      # crypto 掷骰（拒绝采样），骰面→页/词位映射
│   ├── world.ts           # WorldState + state_changes 解包/清洗/合并
│   ├── json-out.ts        # LLM 输出容错解析（围栏/裸JSON/截断修复）
│   ├── prompts.ts         # KP/Validator system prompt 与上下文组装
│   ├── validator.ts       # Verdict 清洗 + 判定（双重试）
│   ├── save.ts            # SaveFile v1 编解码（TXT 全文 / PDF 页文本）
│   └── llm/
│       ├── client.ts      # OpenAI 兼容传输：SSE 流式/非流式 + abort + 诊断脱敏
│       └── session.ts     # LLMSession：独立参数/历史/滚动摘要
├── composables/           # useConfig(双连接) useModels useBooks(pdfjs+IndexedDB) useGame(控制器桥)
└── components/            # SetupPanel / KeywordsBar / BookView(实体书+翻页动画) / GameChat /
                            # ActionComposer(重骰/中止) / DiceOverlay(实体书掷骰演出：骰子落在词上) / WorldStateDrawer …
```

- **RoleController 三变种**（story 核心要求）：本地玩家（HumanController）、LLM（BaseLlmController 派生的 KP / PC 控制器，各自独立会话）、在线玩家（未来实现同一接口即可）。引擎只面向该接口编排，不关心背后是人类输入框、LLM 会话还是网络玩家；引擎测试中注入 HumanController×2 与 LlmPcController 均验证了顺序行动、驳回重写、失败中断与重骰回滚。
- **Validator 是系统裁判**而非游戏角色，作为引擎服务存在（BYOK 语义下它只需要配置，不需要历史）。
- **TXT/PDF 统一页模型**：`BookPage { text, words[], valid[] }`，词偏移相对页文本；PDF 经 pdfjs 按页抽文本（懒加载 worker），无字页保留占位、翻页时跳过；骰子取词允许跨页兜底。
- **存档**：自动存档不含书正文（书在 IndexedDB）；导出文件内嵌正文（TXT 全文 / PDF 页文本），单文件自包含；恢复时连接/模型以本机配置为准（BYOK 语义），只还原历史与世界状态，并支持从行动阶段续跑。

## MVP 范围

已做：TXT+PDF 导入、随机取词（PC+KP 关键词）、KP/Validator/LLM 玩家三连接、独立 LLM PC（自主行动+驳回自动重写）、本地玩家 LLM 代写、基础 World State、文本聊天、BYOK、存档/恢复（含 LLM PC 会话）、实体书掷骰演出/翻页动画、全体同意重骰。

未做（见 story.md）：PDF 二维坐标骰子落点、在线玩家（控制器接口已就绪）、多本地玩家输入路由、语音、角色卡、地图、长期记忆压缩、多 Agent NPC。

## 致谢

脚手架与流式/摘要/诊断模式来自 [YA-BYOK-Chat](../YA-BYOK-Chat)。
