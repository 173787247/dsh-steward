# anomalyco/opencode —— 一份可对照的成熟样本

> 调研人：本会话（DSH）｜ 观测时间：**2026-10-03**（star / 提交 / 包数都是这一天的快照）
> 方法：`gh api` 取元数据 → `gh api contents` 读仓内文档与包清单 → `gh search code` 做结构检索。
> **没有下载仓库、没有逐行读实现。** 证据等级见 §0。
>
> 起因：用户问「这个对 DSH 有参考或搭用价值吗」。结论是**参考价值高、搭用价值低**，
> 本报告把「值得学」的部分落到 §4。

## 0. 证据分级（这张表决定你能信下面每一句话）

沿用 `surveys/README.zh.md` 的分级：

| 标记 | 含义 | 本报告里的例子 |
|---|---|---|
| **【文档】** | 只读了 README / docs / 仓内自带分析 | `CONTEXT.md`、`packages/llm/DESIGN.md`、`AGENTS.md` 的全部内容 |
| **【源码·结构】** | 只 grep 了包名 / 导入 / 常量，没读函数体 | 32 个包的清单、MCP 的三种传输导入、`packages/plugin` 的 exports |
| **【元数据】** | 只有 GitHub API 的数字 | star / fork / 提交日期 / 语言占比 |
| **【无依据】** | 我没找到 | **ACP 支持** —— 搜 `agent-client-protocol` 无结果，见 §3.4 |

**★ 本报告没有任何一条达到「逐行读源码」。** 与 `SELF-IMPROVING-PROJECTS.zh.md` 相比，
这份的证据强度明显低一档 —— 那边的样本是被下载到 `/tmp/survey/` 逐行读的。
**所以下文凡涉及「它怎么实现」的，一律只能复述它自己写的话。**

---

## 1. 一页速查表

| 项 | 值 | 证据 |
|---|---|---|
| 全名 | `anomalyco/opencode` | 【元数据】 |
| 描述 | The open source coding agent. | 【元数据】 |
| 许可 | MIT | 【元数据】 |
| 体量 | **211,523 star · 28,078 fork** | 【元数据】2026-10-03 |
| 创建 / 最近推送 | 2025-04-30 / **2026-10-03**（今天仍在动） | 【元数据】 |
| 栈 | TypeScript 74.4% · MDX 22.2% · CSS 2.9% | 【元数据】 |
| 运行时 | Bun + Effect + Drizzle/SQLite | 【文档】AGENTS.md |
| 包数 | **32** | 【源码·结构】 |
| 默认分支 | `dev`（★ `main` 本地可能不存在） | 【文档】AGENTS.md |
| 文档规模 | `CONTEXT.md` 32 KB · `packages/llm/DESIGN.md` 33 KB · 每包一份 AGENTS.md | 【元数据+文档】 |
| MCP | client 侧很厚：stdio / SSE / StreamableHTTP + OAuth provider + 给 SDK 打补丁 | 【源码·结构】 |
| ACP | **没找到** | 【无依据】 |
| 本地化 | 22 种语言的 README | 【源码·结构】 |

---

## 2. 它把自己写下来的三份东西（这才是最值钱的部分）

### 2.1 `CONTEXT.md` —— 会话运行时规格，32 KB

**【文档】** 结构：`## Language` / `## Relationships` / `## Client contract architecture` /
`## Example dialogue` / `## Flagged ambiguities`。

它给每个术语三段式定义：**术语 → 释义 → `_Avoid_:`（不要用哪个词）**。摘录：

```
System Context        呈现给模型的结构化上下文事实
  _Avoid_: System prompt
Session History       经压缩与 Context Epoch 截断后、投影给 provider 的对话
  _Avoid_: Session Context
Context Source        一个独立可观测的带类型值：稳定 key + JSON codec +
                      无错加载器 + 纯 baseline/update 渲染器
  _Avoid_: Prompt fragment
Context Epoch         一份 baseline 保持为 provider 缓存基线的区间
Mid-Conversation System Message   告诉模型某个 Context Source 状态变了的持久指令
  _Avoid_: System update, system notification, raw text diff
Safe Provider-Turn Boundary       可安全接纳上下文变化的那个时刻
Admitted Prompt / Prompt Promotion / Context Snapshot /
Unavailable Context / Compaction …
```

**★★ 两处最值得注意的写法：**

1. **`_Avoid_:` 是强制项。** 每个词都配一句「不要用哪个词」——
   这不是修辞，是把**歧义当成缺陷来防**。
2. **有一节叫 `## Flagged ambiguities`（标出来的歧义）。**
   也就是：**它把自己还没想清楚的地方也写进规格**，而不是藏起来。
   ★ 这一条比术语表本身更难得。

### 2.2 `packages/llm/DESIGN.md` —— 33 KB 设计草案

**【文档】** 开篇即声明 `> Discussion draft.`，并且写明
「Names and exact TypeScript signatures are illustrative until implementation,
but the domain boundaries and defaults are deliberate」——
**哪些是示意、哪些是定死的，它自己划了线。**

Goals 八条里有两条正好命中 DSH 这两天踩的坑：

```
5. Preserve one provider turn as an explicit primitive for durable runtimes
6. Keep serializable request data separate from process-local execution behavior
```

Non-goals 划得同样狠（**这一层故意不管**）：

```
· Durable agent orchestration or persistence
· Session history ownership          ← 明确不拥有会话历史
· Permission handling                ← 明确不管权限
· A global provider or model registry
· Runtime model-catalog network requests
```

渐进披露四层：

```
1. LLM.generate / stream                跑一次模型
2. LLM.generateTurn / streamTurn        ★ 控制【一个 provider turn】
3. 模型默认值 / 调用选项 / hooks / provider 配置
4. 实验性的 provider 与 protocol 定义
```

### 2.3 每包一份 `AGENTS.md` —— 给自己那层定的规矩

**【文档】** `packages/llm/AGENTS.md` 摘录：

```
· 包边界上用 HttpClient，不用 web fetch/Response
· 流式用 Stream.Stream；不要手写 async generator 或 reader 循环
· JSON 编解码用 Effect Schema codec，不要在实现里直接 JSON.parse/stringify
· 「Two ways to construct the same thing is one too many.」
  → per-type 构造器挂在类型上（Message.system / Model.make / ToolDefinition.make）
  → 顶层 LLM 命名空间只留给 request 形状的调用
  → Schema classes 是唯一运行时模型；便捷函数返回【同样的实例】，
    不许造出第二个模型
```

仓根的 `AGENTS.md` 另有两条架构纪律：

```
· 依赖方向单向：Schema → Core 与 Protocol → Server；
  Client 可依赖 Schema+Protocol，绝不能依赖 Core 或 Server
· SDK 由 httpapi-codegen 从 Protocol/HttpApi 生成 → 不许手改 src/generated
· 分支名最多三个词、不用斜杠与类型前缀；提交用 type(scope): summary
```

---

## 3. 对照 DSH

### 3.1 底盘

| | opencode | DSH |
|---|---|---|
| star / fork | 211,523 / 28,078 | 私有，无公开社区 |
| 栈 | TypeScript + Bun + Effect + Drizzle | TypeScript + Node + cordis |
| 包数 | **32** | **288** |
| UI | TUI（`packages/tui`）+ desktop + web + Slack | Web GUI（62 个 `dsh-client-*`） |
| 默认分支 | `dev` | — |
| 许可 | MIT | — |

来源：opencode 侧全是【元数据】；DSH 侧是本机 `node_modules/@deepseek-ai/dsh` 的包清单。

### 3.2 逐维度

| 维度 | opencode | DSH | 谁强 |
|---|---|---|---|
| 文档纪律 | 三份规格级文档 + 每包 AGENTS.md + `_Avoid_` | 有中文文档与交接文件，**核心词汇未钉死** | **opencode** |
| 社区 / 分发 | 211K star · 22 语言 README · brew/scoop/choco/npm | 只有本机这一份安装 | **opencode** |
| 交互形态 | 打磨过的 TUI + desktop | Web GUI 为主 | **opencode** |
| Provider 广度 | 靠 Vercel AI SDK 铺开多家 | `llm-deepseek`（+account+api-key）· `llm-pi-ai` | opencode（★ 但这是 DSH 的**取舍**） |
| 插件内核 | `packages/plugin` 是接口包 | cordis 完整内核：loader/include/group/timer + host/client runner + HMR | **DSH** |
| 会话格式演进 | Drizzle/SQLite 表，交给 ORM 迁移 | **4 代格式迁移** v0→v1→v2→v3→v4 + projection(+cache) + query-sqlite + turn-outline + 两种 title 策略 | **DSH** |
| 沙箱 | 未找到对应物 | `sandbox` · `sandbox-local` · `sandbox-policy` · **`sandbox-windows-acl`** | **DSH** |
| ACP | **没找到** | `dsh-acp` + `dsh-acp-app` | **DSH** |
| 子 agent / 团队 | 未找到对应物 | 4 个 subagent 包 + `experimental-agent-team`(+UI+tool) | **DSH** |
| 目标自继续 | Non-goals 明确不做 orchestration | `dsh-goal` + `dsh-goal-round-driver` + `tool-goal` | **DSH** |
| 语音 | 未找到对应物 | `experimental-speech-to-text`(SenseVoice) + voice-input-bundle | **DSH** |
| Windows/WSL | 仅安装方式（scoop/choco） | **40+ 个 `dsh-wsl-*` 插件**（UIA/服务/事件日志/注册表/Defender/性能/屏摄/键鼠…） | **DSH** |
| 国产原生 | 否 | DeepSeek 原生 | DSH（按路线） |

### 3.3 两边在做同一件事（可以互相验证的）

| 概念 | opencode | DSH |
|---|---|---|
| 上下文压缩 | `Context Epoch` / compaction | `compaction-basic` · `compaction-image-offload` · `compaction-tool-result-pruner` |
| 会话运行时 | `CONTEXT.md` 的术语体系 | `session-projection` · `session-reference` · `session-turn-outline` · `session-checkpoint-policy` |
| 工具治理 | permission 放在 llm 层之外 | `authorization` · `permission-presets` · `tool-call-timeout-policy` · `sandbox-policy` |
| **provider turn** | **★ 一等原语（DESIGN.md 第 5 条）** | `dsh-llm-retry` —— 在**流之外**重试 |

### 3.4 ★ 明确没找到的

```
ACP（agent-client-protocol）：在 anomalyco/opencode 里搜不到。
原因可能是我只用了 gh search code（有索引与限流），也可能是它确实没有。
★ 按调研纪律第 3 条：写"没找到"，不写成"它没有"。
```

---

## 4. 值得学的三件事（可执行，按性价比）

### ★ 4.1 把核心词汇钉死，每词配一句 `_Avoid_`

**依据：** §2.1。它证明了一件事 —— **歧义可以当缺陷来防**。

**DSH 的现状（证据来自本会话）：** 「会话 / 上下文 / 记忆 / 索引 / 投影 / 目标」
在这几天的交接文档、目标队列、vecmem 用法里是混的。
具体症状：`vecmem` 里 1,454 条 `short-turn` 有 1,445 条来自 web 会话，
而当时要做的任务是「读 IM 对话」—— 词没定死，实现就漂了。

**动作：** 写 `docs/TERMS.zh.md`，每个词三段式（术语 → 释义 → `_Avoid_`），
并照 `## Flagged ambiguities` 的做法**单列一节「还没想清楚的」**。

### ★ 4.2 「一个 provider turn」作为一等原语

**依据：** §2.2 的 Goal 5 + 渐进披露第 2 层（`LLM.generateTurn` / `streamTurn`）。

**为什么对 DSH 是真问题（证据来自本会话）：**

```
会议录音 session：6 MB 上下文，每次尝试跑约 907 秒后失败
错误：DeepSeek Messages SSE event type mismatch
      （dsh-llm-deepseek/lib/index.js:1785 判据：frame.event !== event.data.type）
根因链：流被中途截断 → 留下半个 SSE 帧 → 帧的 event 与 data.type 对不上
而 dsh-llm-retry 是在【流之外】重试 —— 重试时 parser 的 started 标志与
provider 的流不是同一个生命周期，于是又出现 duplicate message_start
（index.js:1925）。
```

**动作：** 读 `packages/llm/DESIGN.md` 全文，写一份
「provider turn 生命周期 vs `dsh-llm-retry` 现状」的对照，
判断 DSH 是否该把「一个 turn」建模成显式原语（而不是在流外面重试）。

### 4.3 两条可检查的纪律

```
① 依赖方向单向
   opencode：Schema → Core/Protocol → Server；Client 不得依赖 Core/Server
   DSH：cordis 插件之间有依赖，但【没有一条可自动检查的规则】
   动作：写一条检查（哪些包不许 import 哪些包），接进 invariants

② 生成物不许手改
   opencode：sdk 由 httpapi-codegen 生成，禁止手改 src/generated
   DSH：typert 有 loader / protocol / registry 三个包 → 产物的边界没写明
   动作：在 typert 产物头部加「本文件由 X 生成，手改会在下次生成时丢失」
```

---

## 5. 明确不该学的

| 不学 | 为什么 |
|---|---|
| 拆细包 | 它是 **32 包**做一件事，DSH 是 **288 包**。粒度更细对隔离测试有利，对理解是成本。DSH 的差距在**文档**，不在包数 |
| 引入 Effect | Bun + Effect 的语义搬进 cordis 插件不是复用，是重写 |
| 用它做底座 | `@opencode-ai/plugin` 是给 opencode 自己的插件接口；`@opencode-ai/sdk` 是驱动 opencode 服务器的 SDK。用它 = 在 DSH 里跑一个同层竞品 |
| 因为它 star 多而改路线 | 它是别人的 agent 本体；DSH 的路线是自研 + 国产 |

---

## 6. 一句话

**opencode 赢在「把已经想清楚的东西写下来」，DSH 赢在「已经长出来的能力广度」。**

能力上 DSH 不输 —— 会话格式四代演进、Windows ACL 沙箱、ACP、子 agent 与 Agent Team、
目标自继续、语音、40+ 个 Windows 宿主插件，这些在 opencode 里我都没找到对应物。

**差距几乎全在表达：它把想法变成了规格，DSH 把想法变成了 288 个包。**
