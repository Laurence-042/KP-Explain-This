## Story

作为玩家，我希望能够导入一本或多本电子书，并由系统通过随机掷骰从书中抽取关键词，使用这些关键词限制我的行动，同时让 LLM 作为 KP/PC 使用同样的机制生成和衔接场景，从而进行一局基于随机文本约束的即兴叙事游戏。

游玩人数可以是2-N，即有且仅有一个KP（主持人），PC（玩家）数量不少于1。

默认由LLM担任KP，但是架构应该允许LLM担任任何角色（即LLM和玩家的controller同基类并使用相同接口操作）

当前阶段不需要支持联机，只需要支持1个人类玩家（不管其充当PC还是KP），但是我们要留后续扩展成联机的预埋能力，不要写死成只有1个人类玩家

## 核心玩法

1. 最初游玩的初始化
   1. KP和PC根据书籍实际情况，决定用几个骰子。以下使用“3个”作为预设参数，并假设有2个玩家A、B
   2. 玩家创建游戏并导入 TXT、PDF 等支持的书籍，导入的书籍数量应该是2（PC数量）+1（KP数量），但允许不同PC/KP使用相同的书
   3. 系统解析书籍，并建立可用于随机定位的文本或页面索引。
   4. KP/PC每人在合上的书封面上投掷3个1d10骰子，根据点数和书总页数取模得到值KP_0，A_0，B_0
   5. KP、A、B各自播放翻书动画，翻到KP_0，A_0，B_0最近的有效页（有足够文字的页）
2. 第N个游玩循环（从1开始数）：
   1. KP/PC在打开的书页（不管是初始化打开的还是游玩途中打开的）上投掷3个1d10骰子，根据点数和书总页数取模得到值KP_N，A_N，B_N
   2. 骰子所覆盖的3个单词被选为对应的KP/PC关键词
   3. KP LLM根据当前世界状态、剧情历史和 KP 关键词生成场景。
   4. 玩家根据自己的关键词提交行动。
   5. Validator LLM 独立判断玩家行动是否真正满足玩家关键词约束，以及该行动在当前世界状态下是否可行。
   6. 验证通过后，KP LLM 接收已经确认合法的玩家行动，并继续推进剧情。
   7. 场景结束后，KP、A、B各自播放翻书动画，翻到KP_N，A_N，B_N最近的有效页（有足够文字的页），进入下一个游玩循环

## LLM 架构

不能沿用普通 chatbot 的单 LLM、单 conversation context 结构。

至少拆分为两个逻辑角色。

### KP LLM

负责：

- 生成和描述场景。
- 控制 NPC。
- 推进剧情。
- 根据随机 KP 关键词建立事件。
- 保持世界观和既有剧情连续性。
- 根据已经通过验证的玩家行动生成结果。

KP 不负责最终判断玩家的关键词解释是否合法。

这样可以避免 KP 为了让自己的剧情继续而主动替玩家圆解释。

### Validator LLM

负责：

- 判断玩家行动是否真正使用了当前三个关键词。
- 判断关键词是否实际影响行为，而不是被机械塞进句子。
- 判断行动是否符合当前世界状态。
- 判断玩家是否通过语言包装绕过规则。
- 输出结构化验证结果。

Validator 不负责续写剧情。

推荐输出：

```
{
  "valid": true,
  "keyword_usage": {
    "knife": true,
    "winter": true,
    "debt": true
  },
  "world_consistent": true,
  "reason": "The knife is used to remove ice caused by winter, allowing escape from the debt collector."
}
```

Validator 应尽量保持低创造性和低温度。

## 上下文管理

不能直接使用现有 chatbot 的单例 conversation history。

游戏需要至少维护三类状态。

### 1. Canonical World State

结构化保存已经成为事实的内容，例如：

- 当前地点。
- 当前时间。
- 玩家状态。
- NPC 状态。
- 物品。
- 已发生事件。
- 已建立世界设定。
- 当前场景关键词。
- 长期剧情变量。

这是所有 LLM 的共同事实源。

### 2. KP Context

KP 专用上下文，包括：

- Canonical World State。
- 最近若干场景叙事。
- 当前 KP 关键词。
- 已验证通过的玩家行动。
- KP system prompt。

KP 不需要看到 Validator 的完整推理历史。

### 3. Validator Context

Validator 专用上下文，包括：

- Canonical World State。
- 当前场景描述。
- 当前玩家关键词。
- 玩家提交的行动。
- Validator system prompt。

Validator 不需要整个剧情聊天记录，只需要足以判断合法性的事实。

## 推荐状态流

```
Book
  ↓
Randomizer
  ↓
Player Keywords + KP Keywords
  ↓
World State
  ↓
KP LLM
  ↓
Scene
  ↓
Player Input
  ↓
Validator LLM
  ↓
valid / invalid
  ↓
if valid
  ↓
KP LLM
  ↓
Scene Result
  ↓
World State Update
```

## World State 更新

不建议直接把 KP 的自然语言输出当成唯一历史记录。

每轮剧情结束后，应同时产生：

1. 给玩家看的自然语言叙事。
2. 给系统使用的结构化状态变化。

例如：

```
{
  "narrative": "You force the frozen window open and escape into the alley.",
  "state_changes": {
    "location": "back alley",
    "inventory_removed": [],
    "inventory_added": [],
    "npc_changes": {
      "debt_collector": {
        "awareness": "searching"
      }
    },
    "facts_added": [
      "The bedroom window is now broken."
    ]
  }
}
```

可以由 KP 一次生成两个字段，也可以额外增加一个 State Extractor LLM。

MVP 阶段可以先让 KP 同时返回 narrative 和 state_changes。

后续出现状态漂移问题，再拆第三个 LLM。

## 关键词约束

关键词必须实际影响行为的：

- 方式。
- 目的。
- 工具。
- 对象。
- 条件。
- 后果。

关键词：

```
knife / winter / debt
```

有效：

> 我用 knife 撬开被 winter 冻住的窗框，从这里逃出去，避免债主来追讨 debt。

无效：

> 我想着 winter 和 debt，然后拿着 knife 翻窗逃跑。

仅仅提及关键词不算满足规则。

## 随机系统

随机结果必须由前端或后端确定性代码生成，不能由 LLM 选择。

LLM 只能解释结果。

### TXT

可以：

- 按字符位置。
- 按 token。
- 按单词。
- 按虚拟分页。

抽取关键词。

### PDF

优先保留页面二维布局。

流程：

1. 随机确定页码。
2. JS 在页面范围内生成骰子落点。
3. 查询该坐标附近的文本 span。
4. 选取最近的有效词。
5. 在 PDF 页面上显示骰子并高亮关键词。

这样可以保留“把骰子扔在书上”的核心视觉机制。

## 前端架构

基于现有 BYOK chatbot 页面二次开发。

但聊天 UI 从：

```
User ↔ Single Chat Session
```

改成：

```
Player
  ↓
Game Controller
  ├─ KP Session
  ├─ Validator Session
  ├─ World State
  ├─ Book Index
  └─ Randomizer
```

聊天框仍然可以复用。

需要新增：

- 当前三个玩家关键词显示。
- 当前三个 KP 关键词，可选择隐藏。
- 掷骰动画。
- PDF 页面骰子落点显示。
- Validator 拒绝提示。
- 场景切换。
- 世界状态管理。
- 多 LLM session 管理。

## BYOK 接入设计

不能继续把 API client 和 conversation 绑定为全局单例。

建议拆成：

```
LLMProvider
LLMClient
LLMSession
GameSession
```

### LLMProvider

描述供应商：

- OpenAI Compatible
- Anthropic
- Gemini
- 自定义 endpoint

### LLMClient

保存：

- API Key
- Base URL
- Model
- Provider config

一个 Client 可以创建多个逻辑 Session。

### LLMSession

每个 Session 独立保存：

- system prompt
- context
- model parameters
- message history

例如：

```
game.kpSession
game.validatorSession
```

两者可以使用：

- 同一个 API Key。
- 同一个 provider。
- 不同模型。
- 不同 temperature。
- 完全独立的 message history。

## 模型选择

KP 和 Validator 不要求使用同一种模型。

### KP

偏向：

- 创作能力。
- 长上下文。
- 角色扮演稳定性。
- 较高 temperature。

### Validator

偏向：

- 指令遵循。
- 逻辑判断。
- JSON 输出稳定。
- 低 temperature。
- 成本低。

因此 UI 最好允许分别配置：

```
KP Model
Validator Model
```

默认可以使用同一模型，但架构不能假设二者相同。

## Prompt 原则

### KP Prompt

必须明确：

- 只处理已经通过 Validator 的行动。
- 不负责判断玩家是否满足关键词规则。
- 不得私自修改随机关键词。
- 必须保持 Canonical World State。
- 新建立事实需要进入 state_changes。

### Validator Prompt

必须明确：

- 不续写剧情。
- 不替玩家补充没有说出的理由。
- 只根据玩家实际输入判断。
- 不能因为某个解释“理论上可以成立”就自动补全。
- 判断的是玩家是否已经建立了合理关联，而不是 LLM 是否能替其建立关联。

这是整个规则能不能成立的关键。

## MVP 技术范围

第一版只做：

- TXT 导入。
- 随机词抽取。
- 玩家关键词。
- KP 关键词。
- KP / Validator 双 Session。
- 基础 World State。
- 单玩家。
- 文本聊天。
- BYOK。
- 游戏存档。

暂不做：

- PDF 二维骰子。
- 多人。
- 语音。
- 复杂角色卡。
- 地图。
- 自动长期记忆压缩。
- 多 Agent NPC。

## 验收标准

- 玩家可以导入 TXT。
- 系统可以随机生成三个玩家关键词。
- 系统可以随机生成三个 KP 关键词。
- 随机结果完全由程序生成，而不是 LLM。
- KP 和 Validator 使用独立上下文。
- KP 和 Validator 可以配置不同模型。
- Validator 可以独立拒绝不符合关键词约束的行动。
- Validator 不会替玩家补充未表达的关键词关联。
- 验证通过后的行动才会发送给 KP。
- KP 可以根据关键词生成连续场景。
- 世界状态不会只依赖聊天文本维护。
- 游戏可以保存并恢复当前 World State 和两个 LLM Session 的必要状态。