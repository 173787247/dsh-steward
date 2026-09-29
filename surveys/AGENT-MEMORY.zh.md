# Agent 记忆系统的实现方案调研

> 调研日期：2026-09-28。调研者：memory-surveyor（task-6）。
> **本文件是 task-6 的唯一可写文件**，其余全部只读。
> 本稿为完整版 v2（v1 为增量初稿，已被本稿取代）。

## 0. 证据分级约定（贯穿全文）

每条结论都标注**我实际读到什么程度**。这是调研纪律第 2、3 条的执行方式。

| 标记 | 含义 |
|---|---|
| 【源码】 | 我读过该项目源码的**具体文件与行号区域**，并复述了我读到的行为。可复查。 |
| 【论文·摘要】 | 我读过该论文的 arXiv **摘要页**（`arxiv.org/abs/...`）。 |
| 【标题核对】 | 我只用 arXiv API 核对了**编号与标题**，没读摘要也没读正文。 |
| 【文档】 | 我只读了 README / 官方文档 —— **是项目方声称，我没有验证实现**。 |
| 【未证实】 | 我找不到依据。按纪律第 3 条，此类内容**不写进结论**，只在第 11 节列为缺口。 |

**引用核对说明**：所有 arXiv 编号与标题都用 `export.arxiv.org/api/query` 逐条拉取核对过。
核对中**发现一条错误引用并剔除**（见第 12 节末尾）——记在这里是为了说明"核对"确实发生了，不是走过场。

**本次调研没有创建任何 `.py` 文件**（唯一的交付物是本 `.md`）。所有 Python 都是内联脚本，只读 stdin，不写文件。

---

## 1. 结论摘要（TL;DR）

1. **没有一个大项目靠"把原始消息灌进向量库"做长期记忆。** mem0 / Letta / Zep / MemoryOS / MemOS / LlamaIndex 六家无一例外，都在写入路径上先做**抽取或分段**，落库的是「事实 / 页 / 边 / 条目」，不是原始消息。原始消息另存一条**消息表**，只在需要精确原文时按需取。
   → 本机 vecmem 现在做的（整篇文档切 1800 字符块直接嵌入）**正是这六家都刻意避开的那条路**。
2. **分层的目的不是"存哪"，而是"谁能被无条件看见"。** Letta 的 core block 直接编译进 system prompt 常驻；LlamaIndex 的 block 有 `priority`，`priority=0` 永不截断；MemoryOS 的 short 是固定 10 条的 deque。**层 = 上下文预算的分配等级**。
3. **淘汰的主战场是"降权 / 打失效戳"，不是删除。** Graphiti 给矛盾的旧边打 `invalid_at` 而**不删行**；Letta 的"淘汰"只发生在上下文窗口层，底层消息表不删；只有 MemoryOS 真删（LFU）。
4. **mem0 开源版根本没有遗忘机制** —— `decay=True` 直接抛错 `"The decay parameter is not supported by the OSS Memory SDK."`。它只有 TTL（过期即**隐藏**）和 LLM 判 DELETE。这一条是源码级的反直觉发现。
5. **★ 短消息（好 / 继续 / 不对）有三种已被实现出来的正解，外加两种通用技术。** 最直接的两个是：NousResearch/hermes-agent 用一条**正则**（字面包含 `ok|sure|continue|yeah|got it|...`）在**检索入口直接跳过**；mixpeek/amux 用**周围上下文替换 query**。见第 9 节 —— 这是本任务价值最高的部分。
6. **"怎么知道自己记得对不对"，只有 Graphiti 把验证做成了常规写入路径**（每次写入都让 LLM 返回 `duplicate_facts` / `contradicted_facts` 两个整数列表，并做越界校验）。其余系统基本没有；评测靠 LongMemEval / MemoryAgentBench 这类外部基准。
7. **一个反复出现的坑：把相关性阈值卡在融合之前。** mem0 源码注释明写 threshold 在 combine 之前生效 → 短消息的向量分低，**BM25 和实体图救不回来**。dsh-steward 若要用"成串意图"，绝不能照抄这个顺序。

---

## 2. 载体对比总表

| 系统 | repo / 论文 | 物理载体 | 分层 | 淘汰 | 我读到什么程度 |
|---|---|---|---|---|---|
| **mem0** | https://github.com/mem0ai/mem0 · arXiv 2504.19413 | 向量库（可插）+ 实体表 + 图 | 事实单层 + 会话作用域 | 仅 TTL 隐藏 + LLM 判 DELETE；**无 decay** | 【源码】`configs/prompts.py`、`utils/scoring.py`、`memory/main.py`、`memory/notices.py` |
| **Letta**（原 MemGPT） | https://github.com/letta-ai/letta（`archive` 分支）· arXiv 2310.08560 | 块 + 消息表 + 向量归档 | **3**：core / recall / archival | 上下文层摘要驱逐；底层不删 | 【源码】`schemas/block.py`、`services/summarizer/summarizer.py`、`functions/function_sets/base.py`、`prompts/system_prompts/sleeptime_v2.py` |
| **Zep / Graphiti** | https://github.com/getzep/graphiti · arXiv 2501.13956 | 时序知识图谱 | **4**：episode / entity / edge / community | `invalid_at` 打戳，**不删** | 【源码】`edges.py`、`search/search_config*.py`、`search/search.py`、`utils/maintenance/edge_operations.py`、`prompts/dedupe_edges.py` |
| **MemoryOS** | https://github.com/BAI-LAB/MemoryOS · arXiv 2506.06326 | 队列 + 会话页 + profile | **3**：short 10 / mid 2000 / long 100 | **LFU 真删** + 热度堆 | 【源码】`memoryos-chromadb/*.py`；论文仅【标题核对】 |
| **MemOS** | https://github.com/MemTensor/MemOS · arXiv 2507.03724 | **文本 / KV 激活 / LoRA 参数** 三种物理载体 | 10 种 `memory_type` 标签 | 未见明确淘汰器【未证实】 | 【源码】`memories/textual/{item,tree}.py`、`mem_cube/general.py`、`mem_scheduler/.../activation_memory_manager.py` |
| **A-MEM** | https://github.com/agiresearch/A-mem · arXiv 2502.12110 | Zettelkasten 卡片网（Chroma） | 单层 + 链接 + evolution 历史 | 每 evolve 100 次重建整个集合 | 【源码】`agentic_memory/memory_system.py`、`retrievers.py` |
| **Generative Agents** | https://github.com/joonspk-research/generative_agents · arXiv 2304.03442 | memory stream（自然语言条目） | observation / reflection / plan | 不删；靠 `recency_decay` 降权 | 【源码】`persona/cognitive_modules/retrieve.py`、`reflect.py`、`memory_structures/{scratch,associative_memory}.py`、`prompt_template/v2/poignancy_event_v1.txt` |
| **LlamaIndex Memory** | https://github.com/run-llama/llama_index（`llama-index-core`） | FIFO 队列 + 可组合 blocks | FIFO + N 个 block（带 priority） | 按 priority 顺序截断 | 【源码】`core/memory/memory.py`、`memory_blocks/{fact,static,vector}.py` |
| **RAPTOR** | https://github.com/parthsarthi03/raptor（`master`）· arXiv 2401.18059 | 递归聚类**摘要树** | 树（多层） | 不删 | 【源码】`raptor/cluster_tree_builder.py`、`cluster_utils.py`、`tree_retriever.py` |
| **GraphRAG** | https://github.com/microsoft/graphrag · arXiv 2404.16130 | 知识图谱 + 社区报告 | Leiden 层次 | 不删 | 【源码】`graphs/hierarchical_leiden.py`、`data_model/community_report.py` |
| **LLMLingua** | https://github.com/microsoft/LLMLingua · arXiv 2310.06839 | — （无状态压缩器） | — | — | 【源码】`llmlingua/prompt_compressor.py` |

> **注意 A-MEM 的仓库结构**：`agiresearch/A-mem` 的检索模块文件名是 `retrievers.py`（复数），不是 `retriever.py`。

---

## 3. 六问之一：分层怎么分

### 3.1 三种不同的分层轴

调研下来，**"分层"这个词被三家用在三个完全不同的轴上**，混在一起谈会出错：

| 分层轴 | 代表 | 层的含义 |
|---|---|---|
| **可见性轴** | Letta、LlamaIndex | 这层的内容**能不能进上下文窗口**、进了能不能被截断 |
| **时间尺度轴** | MemoryOS | 短队列 / 中会话 / 长画像，按访问新旧流转 |
| **物理载体轴** | MemOS | 这条记忆**物理上存在哪**（文本 / KV cache / LoRA 权重） |

### 3.2 Letta：可见性轴，3 层（【源码】）

- **core memory**：一组 **block**。每个 block 有 `label` / `description` / `value` / `limit`（字符上限）/ `read_only`，`value` 编译进 system prompt，**永远在上下文里**。`letta/schemas/block.py:19-40`。
  - `CORE_MEMORY_BLOCK_CHAR_LIMIT = 100000`，`letta/constants.py:435`。
  - 内置 `Human`（label 固定 `"human"`）与 `Persona`，`schemas/block.py:117-125`。
- **recall memory**：原始消息表。不进上下文，靠 `conversation_search` 工具按需查。
- **archival memory**：向量库，永久，靠 `archival_memory_search` 语义检索。

**层间流转只有"下沉"，没有自动晋升**：上下文超限时旧消息被摘要折叠（§6.1）；写进 archival 需要 LLM 自己调 `archival_memory_insert`，没有自动规则。

### 3.3 MemoryOS：时间尺度轴，3 层（【源码】）

构造参数即分层定义（`memoryos-chromadb/memoryos.py:38-42`）：

```
short_term_capacity=10           # deque(maxlen=10)，装 QA 对
mid_term_capacity=2000           # 2000 个 session，热度堆排序
long_term_knowledge_capacity=100 # 100 条知识
retrieval_queue_capacity=7       # 检索回来最多 7 个页
mid_term_heat_threshold=H_PROFILE_UPDATE_THRESHOLD
mid_term_similarity_threshold=0.6
```

- **short**：`deque(maxlen=max_capacity)`，装 **QA 对**（`user_input`+`agent_response`+`timestamp`），**不是单条消息**。`short_term.py:10-11`。
- **mid**：装 **session**；session 由若干 **page** 组成，page 用 `pre_page`/`next_page` 连成**对话链**。`mid_term.py:69-73`。
- **long**：**user profile**（结构化画像）+ **knowledge**（user/assistant 两支，各 100 条上限）。`long_term.py:12-22`。

**晋升是容量驱动的**：`add_memory()` 写入前先判 `if self.short_term_memory.is_full(): self.updater.process_short_term_to_mid_term()`（`memoryos.py:250-253`）。源码注释特意说明**先迁移再写入**，避免 deque 自动丢弃造成静默丢数据 —— 这是个值得抄的细节。

### 3.4 MemOS：物理载体轴（【源码】）

最不寻常的一家。`MemCube` 同时持有多种物理载体（`src/memos/mem_cube/general.py:187-236` 的四个 property）：

- `text_mem`：`memories/textual/`，含 `tree.py`（Neo4j 图上的树）、`general.py`、`naive.py`、`preference.py`。
- `act_mem`：`memories/activation/{kv,vllmkv}.py` —— 把记忆存成 **KV cache**。
- `para_mem`：`memories/parametric/lora.py` —— 把记忆存成 **LoRA 权重**。
- `pref_mem`：偏好记忆。

文本层的 `memory_type` 枚举共 **10 种**，默认 `WorkingMemory`（`memories/textual/item.py:175-189`）：

```
WorkingMemory, LongTermMemory, UserMemory, OuterMemory, ToolSchemaMemory,
ToolTrajectoryMemory, RawFileMemory, SkillMemory, PreferenceMemory, Context
```

→ `WorkingMemory → LongTermMemory` 是 MemOS 表达"工作区 → 长期"的一对类型标签。

### 3.5 Graphiti：抽象层级轴，4 层（【源码】）

全在同一个图里：**Episode**（原始输入，`NextEpisodeEdge` 串成时间线）→ **Entity** → **EntityEdge**（带四个时间戳的事实边）→ **Community**（Leiden 社区 + 摘要）。

边的时序字段（`graphiti_core/edges.py:263-281`）：

```python
expired_at     # 记录被"忘记"的时间
valid_at       # 事实在世界中开始成立的时间
invalid_at     # 事实不再成立的时间
reference_time # 这条边来自哪个 episode 的时间
```

**这是本次调研最重要的单个设计**：事实失效 = 打 `invalid_at`，**不删行**，历史可回放。

### 3.6 LlamaIndex：可见性轴 + **waterfall**，最清晰的层间流转（【源码】）

`core/memory/memory.py:188-201` 的类 docstring 直接描述了机制：

> "Works by orchestrating around a FIFO queue of messages, a list of memory blocks, various parameters (pressure size, token limit, etc.).
> When the FIFO queue reaches the token limit, the oldest messages within the pressure size are ejected from the FIFO queue. **The messages are then processed by each memory block.**
> When pulling messages from this memory, the memory blocks are processed in order, and the messages are injected into the system message or the latest user message."

→ **"FIFO 溢出 → 溢出部分喂给每个 block"** 是一条明确的、代码级的层间流转规则。而且每个 block 可以**拒绝**这条流：

```python
accept_short_term_memory: bool = Field(
    default=True,
    description="Whether to accept puts from messages ejected from the short-term memory.",
)
# memory.py:158
if from_short_term_memory and not self.accept_short_term_memory:
    return
```

→ **短消息被 FIFO 挤出时，每个 block 各自决定收不收。** 这是"写入判据"下沉到层级的做法，见 §4.4。

---

## 4. 六问之二：写入判据

### 4.1 mem0：抽取 prompt 就是写入判据，且**明确规定了什么不进**（【源码】）

`mem0/configs/prompts.py:15-62` 的 `FACT_RETRIEVAL_PROMPT` 里有一份 few-shot 清单，**两条是纯粹的丢弃示例**：

```
Input: Hi.
Output: {"facts" : []}

Input: There are branches in trees.
Output: {"facts" : []}
```

→ 这直接回答 ★ 问题的一半：**"Hi." 这类无信息量输入在抽取阶段就映射成空列表，根本不入库。** 规则写死在 prompt few-shot 里，由 LLM 执行。

同一 prompt 规定**记什么**（7 类）：个人偏好、重要个人信息、计划与意图、活动/服务偏好、健康偏好、职业信息、杂项。以及：
- "Create the facts based on the user and assistant messages only. Do not pick anything from the system messages."
- "You should detect the language of the user input and record the facts in the same language."

新版 `ADDITIVE_EXTRACTION_PROMPT`（`prompts.py:468+`）把排除规则写得更死（我读到的原文）：

```
Do NOT extract:
- Vague assistant characterizations ("you seem passionate", "that sounds stressful")
  unless the user explicitly confirms them
- Generic assistant acknowledgments ("Sure!", "Great question!")
- Assistant meta-commentary about its own capabilities
```

→ 这是任务问的"**有没有『只记验证过的』这种规则**"的**唯一一个实例**：助手对用户的描述**不记，除非用户明确确认**。但注意它只覆盖这一类，**不是全局策略**（见 §11 缺口 2）。

同一 prompt 另有两条工程上很关键的规则：
1. **助手消息也抽**（"You extract from BOTH user and assistant messages"），但以用户视角改写（`"User was recommended X"`）。
2. **唯一时间锚点是 `Observation Date`**，所有相对时间（"yesterday" / "last week"）强制相对它解析。→ 防止"昨天"这种相对时间在长期记忆里腐烂。Letta 用另一条路达到同一目的（§4.2）。

**写的四种操作**由第二个 LLM 调用决定（`DEFAULT_UPDATE_MEMORY_PROMPT`，`prompts.py:176-325`）：`ADD` / `UPDATE`（语义相同则信息更多的一方胜出，原文给了 (a)(b) 两个例子区分"该更新"和"不用更新"）/ `DELETE`（矛盾时删旧的）/ `NONE`。

### 4.2 Letta：写入判据写在工具 docstring 和 sleeptime prompt 里（【源码】）

`archival_memory_insert` 的 docstring（`functions/function_sets/base.py:164-190`）给了 best practices：

```
- Store self-contained facts or summaries, not conversational fragments
- Add descriptive tags to make information easier to find later
- Use for: meeting notes, project updates, conversation summaries, events, reports
- Information stored here persists indefinitely and can be searched semantically
```

→ **"not conversational fragments"** 是 Letta 对短消息的立场：**别把对话碎片写进归档层**；且要求 `content` 必须 **self-contained**。

sleeptime 智能体（后台整理记忆的角色，`prompts/system_prompts/sleeptime_v2.py`）的写入判据有三条具体规则：

1. **时间必须绝对化**："do not write 'today' or 'recently', instead write specific dates and times, because 'today' and 'recently' are relative, and the memory is persisted indefinitely"。
2. **选择性 vs 召回率的显式权衡**："Not every observation warrants a memory edit, be selective in your memory editing, but also aim to have high recall."
3. **允许"这次不记"是正常出口**："If there are no meaningful updates to make to the memory, you call the finish tool directly."

还有 `rethink` 工具：**整块重写**（相对 `core_memory_append` / `core_memory_replace` 的窄编辑）。

### 4.3 MemoryOS：写入**无判据**（【源码】）

`memoryos.py:236-256` 的 `add_memory()` **无条件写入**：每个 `(user_input, agent_response)` 都进 short-term，没有 LLM 过滤、没有重要性打分。判据全部发生在**晋升**环节（热度阈值，§5.1）。

### 4.4 LlamaIndex：写入判据 = 抽取 + block 级准入（【源码】）

两层机制：

**第一层：block 自己决定怎么处理被挤出的消息。**
- `FactExtractionMemoryBlock`：LLM 从对话里抽离散事实（`memory_blocks/fact.py:15-36` 的 `DEFAULT_FACT_EXTRACT_PROMPT`，明确 "Do not duplicate facts that are already in the existing facts list"，"If no new facts are present, return: `<facts></facts>`"）。`max_facts` 默认 **50**。
- `StaticMemoryBlock`：静态内容，配合 `priority=0` 永不截断。
- `VectorMemoryBlock`：向量检索。

**第二层：`accept_short_term_memory` 的 block 级准入开关**（§3.6 引的代码）。一个 block 可以声明"我不接受短时记忆溢出流"。

### 4.5 A-MEM：写入时顺带**改写老记忆**（【源码】）

`agentic_memory/memory_system.py` 的 `add_note()` → `process_memory(note)` 流程：

1. `analyze_content(content)`：LLM 抽 `keywords` + `context` + `tags`。prompt 里明确要求 "Don't include keywords that are the name of the speaker or time"、"At least three keywords"（`memory_system.py:177-189`）。
2. 找若干最近邻记忆。
3. **LLM 决定 `should_evolve`**；若演化，还要生成 `new_tags_neighborhood` 和 `new_context_neighborhood` —— **即用新记忆回头改写邻居记忆的 context 和 tags**（`memory_system.py:127-158`）。prompt 硬约束："the length of new_tags_neighborhood must equal the number of input neighbors"。
4. 每次演化 `evo_cnt += 1`；当 `evo_cnt % evo_threshold == 0`（**默认 100**）时调 `consolidate_memories()` —— **重建整个 Chroma 集合**，把所有记忆连同完整元数据重新灌进去（`memory_system.py:261-290`）。

→ **"新记忆触发老记忆改写"是 A-MEM 独有的写入副作用**，其余系统写入都是局部的。

### 4.6 Generative Agents：**每条都存**，重要性只影响检索和反思（【源码】）

写入**没有判据** —— 所有 observation 都进 memory stream。重要性由 LLM 打 1~10 分（`poignancy`），prompt 原文（`prompt_template/v2/poignancy_event_v1.txt`）：

> "On the scale of 1 to 10, where **1 is purely mundane (e.g., brushing teeth, making bed)** and **10 is extremely poignant (e.g., a break up, college acceptance)**, rate the likely poignancy of the following event for {agent}."

→ 关键区别：**mem0/Letta 在写入处丢弃；Generative Agents 不丢弃，而是让重要性参与检索排序和反思触发。** 这是 ★ 短消息问题的**第四条路**（见 §9.5）。

---

## 5. 六问之三：淘汰判据

### 5.1 MemoryOS：热度公式 + LFU（两个不同机制）（【源码】）

**淘汰用 LFU**（`mid_term.py:75-96`）：

```python
def evict_lfu(self):
    lfu_sid = min(self.access_frequency, key=lambda k: self.access_frequency[k])
    self.storage.delete_mid_term_session(lfu_sid)
    ...
    self.rebuild_heap()
```

mid-term 满 2000 时，删**被访问次数最少**的 session。**这是真删**（`delete_mid_term_session`）。

**优先级用热度堆**（`mid_term.py:21-37`）：

```python
HEAT_ALPHA = 1.0; HEAT_BETA = 1.0; HEAT_GAMMA = 1; RECENCY_TAU_HOURS = 24

def compute_segment_heat(session, alpha=HEAT_ALPHA, beta=HEAT_BETA, gamma=HEAT_GAMMA, tau_hours=RECENCY_TAU_HOURS):
    N_visit = session.get("N_visit", 0)
    L_interaction = session.get("L_interaction", 0)
    R_recency = 1.0
    if session.get("last_visit_time"):
        R_recency = compute_time_decay(session["last_visit_time"], get_timestamp(), tau_hours)
    return alpha * N_visit + beta * L_interaction + gamma * R_recency
```

时间衰减是**指数**的（`utils.py:154-163`）：

```python
def compute_time_decay(event_timestamp_str, current_timestamp_str, tau_hours=24):
    delta_hours = (t_current - t_event).total_seconds() / 3600.0
    return np.exp(-delta_hours / tau_hours)
```

→ `H_segment = 访问次数 + 交互长度 + exp(-Δ小时/24)`。堆用负数实现最大堆：`heapq.heappush(self.heap, (-session_obj["H_segment"], session_id))`（`mid_term.py:173`）。

**热度还驱动晋升**：堆顶 session 的热度 ≥ `mid_term_heat_threshold` 时触发 **profile 更新** + **knowledge 抽取**（两个并行任务 `task_update_profile` / `task_extract_knowledge`，`memoryos.py:138-205`）。

### 5.2 mem0：开源版**没有**遗忘（【源码】）

反直觉但确凿。`memory/main.py:467-483`，`update(..., decay=True)` 直接抛错：

```python
DECAY_FEATURE_ERROR_MESSAGE = "The decay parameter is not supported by the OSS Memory SDK."
```
（`memory/notices.py:134`）

mem0 开源版只有三条退出路径：
1. LLM 判 `DELETE`（矛盾时）。
2. **显式 TTL**：`add(..., expiration_date="YYYY-MM-DD")`；`_payload_is_expired()` 在检索时把过期项**隐藏**（`main.py:427-449`）。是隐藏，不是删除。
3. 手动 `delete()`。

→ **时间衰减遗忘是 mem0 的商业版能力，开源版没有。** 这是源码常量级的证据，不是猜测。

### 5.3 Graphiti：不删，只失效（【源码】）

`utils/maintenance/edge_operations.py:538-570` 的 `resolve_edge_contradictions()`：新事实与旧边矛盾时，

```python
edge.invalid_at = resolved_edge.valid_at
edge.expired_at = edge.expired_at if edge.expired_at is not None else utc_now()
```

→ 旧边保留，只盖两个戳：**"失效于何时"** 和 **"何时被记录为失效"**。

### 5.4 LlamaIndex：按 priority 顺序截断，`0` 永不截断（【源码】）

`core/memory/memory.py:481-530` 的 `_truncate_memory_blocks()`：

```python
if memory_blocks_tokens + chat_history_tokens <= self.token_limit:
    return content_per_memory_block

tokens_to_truncate = memory_blocks_tokens + chat_history_tokens - self.token_limit

for memory_block in sorted(self.memory_blocks, key=lambda x: x.priority):  # Lower priority first
    if memory_block.priority == 0:      # they should never be truncated
        continue
    if tokens_to_truncate <= 0:
        break
    truncated_block_content = await memory_block.atruncate(content, tokens_to_truncate)
    tokens_saved = original_tokens - new_tokens
    tokens_to_truncate -= tokens_saved
```

**这里有一个我读源码才发现的文档不一致**：`priority` 字段的 docstring 写的是

> "Priority of this memory block (**0 = never truncate, 1 = highest priority, etc.**)"

但代码是 `sorted(..., key=lambda x: x.priority)` + 注释 "Lower priority first"，且跳过 `0`。
→ **实际行为是：数字小的先被截断（0 例外，永不截断）**，即 **数字越大越受保护**。"1 = highest priority" 与 "lower priority first" 的措辞是矛盾/易误读的。**照抄时请以代码为准。**

其它相关默认值：`chat_history_token_ratio = 0.7`（"Minimum percentage ratio of total token limit reserved for chat history"）；`token_flush_size` 缺省或非法时取 `int(token_limit * 0.1)`；`from_defaults()` 里若 `token_flush_size > token_limit` 则取 `int(token_limit * 0.7)`（`memory.py:276-279, 325-326`）。

### 5.5 A-MEM：没有淘汰，只有周期性重建（【源码】）

没有删除、没有降权。唯一的"周期动作"是 §4.5 的 `consolidate_memories()`：每 100 次演化**重建整个向量集合**。→ 这是**重建**不是**淘汰**，成本随记忆量线性增长。

### 5.6 Generative Agents：不删，用**位置指数**降权（【源码】）

`cognitive_modules/retrieve.py` 的 `extract_recency()`：

```python
recency_vals = [persona.scratch.recency_decay ** i for i in range(1, len(nodes) + 1)]
```

`recency_decay = 0.99`（`memory_structures/scratch.py:60`）。注意下标 `i` **不是时间差，而是该节点在"按 last_accessed 排序后的列表"中的位置**。→ 是一个"访问新鲜度排名"的指数折扣，不是物理时间衰减。这和 MemoryOS 的 `exp(-Δ小时/24)` 是**两种不同的"新近"定义**，很值得区分。

---

## 6. 六问之四：压缩算法

> 只写我读到实现细节的算法。**纯"用 LLM 总结"不写。**

### 6.1 Letta：部分驱逐 + 递归摘要（【源码】）

`services/summarizer/summarizer.py:136-243`，方法 `_partial_evict_buffer_summarization`。**具体到能复现**：

- 参数 `partial_evict_summarizer_percentage` 默认 **0.30**（`summarizer.py:49`）。
- 按**消息条数**算（不是 token），源码注释原文："Summarization as implemented in the original MemGPT loop, **but using message count instead of token count**."
- 步骤：
  1. `total_message_count = len(all_in_context_messages)`
  2. `target_message_start = round((1.0 - 0.30) * total_message_count)` → 保留最后 70%
  3. **从 `target_message_start` 往后找第一条 `assistant` 消息**作为切点 `assistant_message_index`；找不到就抛 `ValueError`
  4. 被摘要区间 = `all_in_context_messages[1:assistant_message_index]`（index 0 是 system prompt，保留）
  5. 生成摘要消息，**role 设为 `user`**，插到 **index 1**
  6. 新上下文 = `[system, summary_message, *all_in_context_messages[assistant_message_index:]]`
- 触发条件：`if not force: return all_in_context_messages, False` —— **不 force 就不摘要**。

**为什么必须找 assistant 当切点**：摘要消息插在 index 1，则 index 2 必须是 `assistant`，否则消息角色序列非法（OpenAI 兼容 API 不允许连续 user 或开头即 assistant）。**这个约束文档里不会写，只有读源码才知道。**

摘要 prompt 由 `build_summary_request_text(retain_count, evicted_messages, in_context_messages)` 构造（`summarizer.py:436-457`），原文：

> "You're a memory-recall helper for an AI that can only keep the last {retain_count} messages. Scan the conversation history, focusing on messages about to drop out of that window, and write crisp notes that capture any important facts or insights about the human so they aren't lost."

→ 它把**"即将掉出窗口的消息"** 和 **"还在窗口内的消息"** 分开喂给摘要器，并要求聚焦前者。

### 6.2 Letta：中间截断（middle truncate）（【源码】）

`summarizer.py:387-433` 的 `middle_truncate_text(text, budget_bytes, head_frac=0.3, tail_frac=0.3)`：

- 按 **UTF-8 字节**判预算（注释："correctly accounts for multi-byte characters"），再按实测 bytes-per-char 换算成字符预算，**切片在字符上做**（避免切断多字节序列）。
- 保留头部 30% + 尾部 30%，**丢中间**。
- 插入标记 `\n[TRUNCATED: dropped {dropped} middle chars due to context budget]\n`；若标记本身超预算，**先缩 tail 给标记腾地方**。

→ 针对**单个超长工具输出**，和 §6.1 的会话级摘要是两个粒度。

### 6.3 MemoryOS：页 + 多主题摘要 + 对话链（【源码】）

`updater.py:107-205` 的晋升流程：

1. 被挤出的 QA 对逐个变 **page**（`_process_page_embedding_and_keywords`：算 embedding + 抽关键词）。
2. **连续性检查**：`CONTINUITY_CHECK_SYSTEM_PROMPT = "You are a conversation continuity detector. Return ONLY 'true' or 'false'."`（`prompts.py:209`），配 `_update_linked_pages_meta_info` 把 page 连成 `pre_page`/`next_page` 链。
3. **多主题摘要**：`MULTI_SUMMARY_SYSTEM_PROMPT = "You are an expert in analyzing dialogue topics. Generate concise summaries. **No more than two topics.** Be as brief as possible."`（`prompts.py:73`）→ **一次最多压成 2 个主题**，硬上限。
4. 摘要用 `topic_similarity_threshold`（默认 0.5）匹配已有 session：命中则 `insert_pages_into_session` 并入，否则 `add_session` 新建。
5. 每个 page 带 `meta_info`；检索回来的 page **连着 meta_info 一起**喂模型（`memoryos.py:271-289`）。

摘要长度硬约束（`prompts.py:69-70`）：

> `SUMMARIZE_DIALOGS_USER_PROMPT = "Please generate an concise topic summary based on the following conversation. **Keep it to 2-3 short sentences maximum**"`

→ **压缩目标写死在 prompt 里是"2-3 句"**，不是"随便总结"。

### 6.4 RAPTOR：UMAP + GMM(BIC) 聚类 → 逐簇摘要 → 递归成树（【源码】）

`raptor/cluster_utils.py` + `cluster_tree_builder.py`。这是**完全不需要人工规则**的树构建算法：

1. **降维**：`global_cluster_embeddings()` 用 `umap.UMAP(n_neighbors=n_neighbors, n_components=dim, metric=metric)`，其中
   `n_neighbors = int((len(embeddings) - 1) ** 0.5)`（自适应 √N）。
2. **选簇数**：`get_optimal_clusters(embeddings, max_clusters=50)` —— 对 `n_components = 1..min(50, N)` 逐个拟合 `GaussianMixture`，取 **BIC 最小**：

   ```python
   bics = []
   for n in n_clusters:
       gm = GaussianMixture(n_components=n, random_state=random_state)
       gm.fit(embeddings)
       bics.append(gm.bic(embeddings))
   optimal_clusters = n_clusters[np.argmin(bics)]
   ```
3. **软分配**：`GMM_cluster()` 用 `gm.predict_proba()`，`labels = [np.where(prob > threshold)[0] for prob in probs]` —— **一个点可以同时属于多个簇**（`threshold` 默认 **0.1**）。→ 这避免了硬聚类的边界错误，但也让同一节点出现在多个父节点下。
4. **逐簇摘要**：`process_cluster()` 里 `self.summarize(context=get_text(cluster), max_tokens=summarization_length)`，每个簇生成一个父节点。`RAPTOR_Clustering.perform_clustering` 有 `max_length_in_cluster=3500`（tiktoken `cl100k_base`）。
5. **递归终止**：`if len(node_list_current_layer) <= self.reduction_dimension + 1: break`，`reduction_dimension` 默认 **10**。

→ **这是"聚类 + 摘要 + 折叠"里唯一一个把"聚几个簇"交给 BIC 而不是拍脑袋的实现。**

### 6.5 GraphRAG：层次化 Leiden + 社区报告（【源码】）

- `graphs/hierarchical_leiden.py` 调 `graspologic` 的 `gn.hierarchical_leiden(...)`，默认 `max_cluster_size=10`、`random_seed=0xDEADBEEF`。提供两个便捷函数：`first_level_hierarchical_clustering()`（`entry.level == 0`）和 `final_level_hierarchical_clustering()`（`entry.is_final_cluster`）。
- 社区报告 schema（`data_model/community_report.py`）：`community_id` / `summary` / `full_content` / `rank` / `full_content_embedding` / `attributes` / `size` / `period`。

→ 压缩的产物是**结构化报告 + 向量**，不是一段散文。`rank` 字段让报告之间可排序，`size` 记录社区规模。

### 6.6 LLMLingua：**token 级**压缩，不生成任何文字（【源码】）

`llmlingua/prompt_compressor.py`。这是和上面所有"摘要派"**根本不同**的一类压缩：**按信息量删 token，不调用 LLM 生成**。

`compress_prompt()` 的关键参数（`prompt_compressor.py:426-522`）：
- `iterative_size: int = 200` —— 每轮只看 200 个 token（滑动窗口迭代压缩）
- `context_budget: str = "+100"` —— 上下文级过滤的 token 预算，字符串形式表示**允许浮动**
- `force_tokens: List[str] = []` —— **永不删除**的 token 白名单
- `drop_consecutive: bool` —— 是否丢弃 `force_tokens` 中连续出现者
- `chunk_end_tokens: List[str] = [".", "\n"]` —— 切段的早停 token

`compress_prompt_llmlingua2()` 走 `LLMLingua-2` 路线（arXiv 2403.12968，标题核对）：用**数据蒸馏训出的 token 分类器**做任务无关压缩。

### 6.7 LlamaIndex：事实**冷凝**（condense）到硬上限（【源码】）

`memory_blocks/fact.py:38-60` 的 `DEFAULT_FACT_CONDENSE_PROMPT`：

> "The condensed list you return **completely replaces** the existing facts, so it must be the full, self-contained snapshot of everything worth keeping - not just newly added or changed facts.
> 1. Review the current list of existing facts
> 2. Return a single, complete list of **fewer than {{ max_facts }}** facts
> 3. **Merge related facts and drop semantically redundant ones** so that each fact appears only once"

`max_facts` 默认 **50**。

→ **这是"压缩成一张有上限的快照"最干净的一行实现**：不删单条，而是把整个事实列表重写成 ≤ 50 条。检索时不需要查多条再合并。

### 6.8 Anthropic Contextual Retrieval：**嵌入前**前置 50~100 token 上下文（【文档】官方工程博客）

https://www.anthropic.com/engineering/contextual-retrieval （Published Sep 19, 2024，我读了全文）

问题定义（原文）："traditional RAG solutions **remove context when encoding information**, which often results in the system failing to retrieve the relevant information"。
举例：一个 chunk 是 `"The company's revenue grew by 3% over the previous quarter."`，单独看不知道是哪家公司、哪个季度。

做法：让 LLM 为每个 chunk 生成一段**置于整体文档中的定位上下文**，前置后**再嵌入、再建 BM25 索引**。官方给的 prompt 原文：

```
<document>
{{WHOLE_DOCUMENT}}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{{CHUNK_CONTENT}}
</chunk>
Please give a short succinct context to situate this chunk within the overall document
for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.
```

结果（原文数字，`1 - recall@20` 失败率）：
- Contextual Embeddings：**5.7% → 3.7%**（降 35%）
- 加上 Contextual BM25：**5.7% → 2.9%**（降 49%）
- 再加 Reranking（Cohere reranker）：**5.7% → 1.9%**（降 67%）

另外两条**负面证据**（原文写明是"评估过、收益很低"）：
- "adding generic document summaries to chunks (**we experimented and saw very limited gains**)"
- "summary-based indexing (**we evaluated and saw low performance**)"

以及：top-20 chunk 比 top-10 / top-5 更有效；contextual 文本"usually 50-100 tokens"；一次性处理成本约 **$1.02 / 百万文档 token**（靠 prompt caching）。

### 6.9 Late Chunking：把切分挪到池化之前（【论文·摘要】）

arXiv 2409.04701，标题 "Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models"（已核对）。摘要原文要点：

> "chunk embeddings created in this way can lose contextual information from surrounding chunks, resulting in sub-optimal representations. In this paper, we introduce a novel method called **late chunking**, which leverages long context embedding models to **first embed all tokens of the long text, with chunking applied after the transformer model and just before mean pooling**... The resulting chunk embeddings capture the full contextual information... works without additional training."

→ 与 §6.8 的区别：Anthropic 是**用 LLM 生成上下文文本再拼进 chunk**（写进原文，BM25 也受益）；Late Chunking 是**改嵌入流程**（先把全文过 transformer，再按 chunk 做 mean pooling），**原文不动，只影响向量**。两者可叠加。

---

## 7. 六问之五：检索

### 7.1 mem0：三路加法融合，且**阈值卡在融合之前**（【源码】）

`utils/scoring.py:60-140` 的 `score_and_rank()`：

```
combined = (semantic + bm25 + entity_boost) / max_possible
```

- 三个信号：`semantic_score`（向量）、`bm25_score`（`utils/lemmatization.py` 词形还原后 BM25）、`entity_boost`（实体图加成，`ENTITY_BOOST_WEIGHT = 0.5`）。
- 分母自适应：纯语义 `1.0`；+BM25 `2.0`；+BM25+实体 `2.5`；+实体无 BM25 `1.5`。
- **关键细节**（源码注释原文）：

  > "Threshold gates the semantic score BEFORE combining -- candidates below the threshold are excluded even if BM25/entity would boost them."

  代码：`if semantic_score < threshold: continue`

  → **向量分低但关键词精确命中的记忆会被直接丢掉，BM25 与实体图救不回来。** 这对 ★ 短消息问题是**不利**的：短消息对任何 query 的向量分都低，在 mem0 里**先被 threshold 砍掉**。
- 可选独立 reranker：`RerankerFactory.create(config.reranker.provider, ...)`（`memory/main.py:505-510`）。

### 7.2 Graphiti：三种检索 × 五种重排，四类对象各查一遍（【源码】）

`search/search_config.py:32-78`：

```python
EdgeSearchMethod    = cosine_similarity | bm25 | bfs(breadth_first_search)
NodeSearchMethod    = cosine_similarity | bm25 | bfs
EpisodeSearchMethod = bm25
CommunitySearchMethod = cosine_similarity | bm25

EdgeReranker = rrf(reciprocal_rank_fusion) | node_distance | episode_mentions | mmr | cross_encoder
```

**重排器是真实现，不是名字**（`search/search.py`）：
- `rrf` —— 倒数排名融合（`search.py:374`）
- `mmr` —— 最大边际相关性，有 `mmr_lambda`（`search.py:375-392`）
- `node_distance` —— 按到中心节点的图距离
- `episode_mentions` —— **按被多少个 episode 提到排序**（★ 这是"成串才有意图"的一种天然实现：被反复提及的事实自动靠前）
- `cross_encoder` —— 交叉编码器

预设配方（`search/search_config_recipes.py`）：`COMBINED_HYBRID_SEARCH_{RRF,MMR,CROSS_ENCODER}`，以及单层专用的 `EDGE_/NODE_/COMMUNITY_HYBRID_SEARCH_*`。
`search()` 对 edges / nodes / episodes / communities **四类各查一遍**（`search.py:169-243`），返回带各自 reranker score 的 `SearchResults`。

→ **这是"多路检索"的极端形态：不是一路检索多个索引，而是四类对象各有一套（检索方法, 重排器）配置。**

### 7.3 Letta：混合检索 + 元数据过滤，**query 可以为空**（【源码】）

`conversation_search` 的 docstring（`functions/function_sets/base.py:87-160`）："Search prior conversation history using **hybrid search (text + semantic similarity)**."

参数：`query` / `roles` / `limit` / `start_date` / `end_date`，且 **`query` 可以传 None** —— 此时退化为纯时间范围 + role 过滤（docstring 里有 "Time-range only search (no query)" 的示例）。

→ **对 ★ 短消息问题有用：语义检索不可用时，可按时间窗把短消息捞回来。**

`archival_memory_search`：纯语义 + tag 过滤（`tag_match_mode: "any" | "all"`）+ 时间窗 + `top_k`（默认 10）。

### 7.4 MemoryOS：三源并发 + 固定容量堆；**两级 session→page**（【源码】）

`retriever.py:102-116` 的 `retrieve_context()` 并发跑三个来源：

```python
lambda: self._retrieve_mid_term_context(user_query, segment_similarity_threshold, page_similarity_threshold, top_k_sessions),
lambda: self._retrieve_user_knowledge(user_query, knowledge_threshold, top_k_knowledge),
lambda: self._retrieve_assistant_knowledge(user_query, knowledge_threshold, top_k_knowledge)
```

默认阈值（`retriever.py:104-108`）：`segment_similarity_threshold=0.1`、`page_similarity_threshold=0.1`、`knowledge_threshold=0.01`、`top_k_sessions=5`、`top_k_knowledge=20`。
→ **阈值定得极低（0.01~0.1），靠后面的 top-k 堆截断，而不是靠阈值。** 这和 mem0 的"高阈值前置过滤"是**相反的取向**。

mid-term 是**两级检索**：先按 summary embedding + `summary_keywords` 找 session（`mid_term.py:279-356`），再在 session 内按 page 相似度取页，最后用 size-7 的堆取全局 top-7（`retriever.py:44-68`）。

作者自认的未决问题（`retriever.py:52-54`，源码注释原文）：

> "Add session relevance score to page score or combine them? **For now, using page_score.** Could be: page_score * session_match['session_relevance_score']"

→ **"会话分和页分怎么合"作者自己没定，当前只用页分。** 这是个可以被我们改进的点。

### 7.5 Generative Agents：三个信号各自归一化后加权求和（【源码】）

`cognitive_modules/retrieve.py` 的 `new_retrieve()`：

```python
nodes = [[i.last_accessed, i] for i in persona.a_mem.seq_event + persona.a_mem.seq_thought
         if "idle" not in i.embedding_key]
nodes = sorted(nodes, key=lambda x: x[0])

recency_out    = normalize_dict_floats(extract_recency(persona, nodes), 0, 1)
importance_out = normalize_dict_floats(extract_importance(persona, nodes), 0, 1)
relevance_out  = normalize_dict_floats(extract_relevance(persona, nodes, focal_pt), 0, 1)

gw = [0.5, 3, 2]
master_out[key] = (recency_w*recency_out[key]*gw[0]
                 + relevance_w*relevance_out[key]*gw[1]
                 + importance_w*importance_out[key]*gw[2])
```

三个信号：`recency`（`0.99^i`，按访问新鲜度排名）、`importance`（`poignancy`，LLM 打 1~10）、`relevance`（与焦点的余弦相似度）。
`scratch.py:57-60` 里 `recency_w = relevance_w = importance_w = 1`，所以最终乘数是 **recency × 0.5、relevance × 3、importance × 2**。

代码注释原文（值得一读，作者自己承认是拍的）：

> "Note to self: test out different weights. **[1, 1, 1] tends to work decently**, but in the future, these weights should likely be learned, perhaps through an RL-like process."

**三个实现细节值得抄**：
1. **`min-max` 归一化到 [0,1] 之后才加权** —— 三个不同量纲的信号（位置指数、1-10 分、余弦相似度）必须先拉到同一尺度，否则权重没意义。
2. **`if "idle" not in i.embedding_key`** —— 明确排除"无所事事"的填充事件，防止无意义记忆挤占 top-k。
3. **命中的节点会被回写 `n.last_accessed = persona.scratch.curr_time`** —— **检索行为本身改变下一次的 recency 排序**（正反馈）。这是个容易被忽略但很关键的自增强机制。

### 7.6 RAPTOR：collapsed tree vs tree traversal（【源码】）

`raptor/tree_retriever.py:19-54, 158-232`：

- `TreeRetrieverConfig`：`threshold` 默认 **0.5**，`top_k` 默认 **5**，`selection_mode` 必须是 `"top_k"` 或 `"threshold"`（否则抛错）。
- 两种模式：
  - **collapsed tree**（`retrieve_information_collapse_tree`）：把**所有层**的节点放进一个扁平索引一起检索 —— 简单、并行、不依赖树结构。
  - **tree traversal**（`retrieve_information`）：从根往下走。
- 选择：`if selection_mode == "threshold": best_indices = [i for i in indices if distances[i] > self.threshold]`；`elif "top_k": best_indices = indices[:self.top_k]`。

→ **"建了树 ≠ 必须走树"**：RAPTOR 官方同时提供两种检索，collapsed tree 常被采用。

### 7.7 A-MEM：**docstring 说 hybrid，实现是单路**（【源码】）

`agentic_memory/memory_system.py:432-441`：

```python
def search(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
    """Search for memories using a hybrid retrieval approach."""
    # Get results from ChromaDB (only do this once)
    search_results = self.retriever.search(query, k)
```

而 `retrievers.py` 的 `ChromaRetriever` 只做 embedding 检索（`SentenceTransformerEmbeddingFunction`），**没有 BM25、没有 link 遍历**。

→ **docstring 声称 "hybrid"，代码是单路向量检索。** 这正是"读源码 vs 读文档"的差别。Zettelkasten 的 links 被存进 metadata（`add_note` 里 `"links": note.links`），但检索路径上没有用它。

### 7.8 LlamaIndex：block 按 priority 顺序注入（【源码】）

`memory.py:446-479` 的 `_get_memory_blocks_content()`：`for memory_block in sorted(self.memory_blocks, key=lambda x: -x.priority)` —— **取出时按 priority 降序**（高数字优先注入）。注释："Get content from memory blocks in priority order"。
注入位置：docstring 说明注入到 **system message 或最新一条 user message**。

→ 注意这里和 §5.4 截断的排序方向**不一样**（截断是升序、跳过 0；注入是降序）。两处对 `priority` 的用法都正确（都是"数字大 = 更重要"），但代码读起来容易看反。

---

## 8. 六问之六：它怎么知道自己记得对不对

### 8.1 Graphiti：每次写入都做一次"重复 / 矛盾"二判（【源码】）

**这是本次调研里唯一一个被实现成常规写入路径的验证机制。**

- prompt schema（`prompts/dedupe_edges.py:25-31`）要求 LLM 返回两个列表：

  ```
  duplicate_facts:    List of idx values of duplicate facts (only from EXISTING FACTS range). Empty list if none.
  contradicted_facts: List of idx values of contradicted facts (from full idx range). Empty list if none.
  ```

- prompt 里的**反例说明**（`dedupe_edges.py:88-96`），这三条把"矛盾 / 重复 / 无关"的边界划得很清楚：
  - `duplicate_facts=[0], contradicted_facts=[]`（identical factual information）
  - `duplicate_facts=[], contradicted_facts=[1]`（**same relationship but updated title — contradiction, NOT a duplicate**）
  - `duplicate_facts=[], contradicted_facts=[]`（different events on different days — neither）

- prompt 硬约束："**NEVER mark facts with key differences as duplicates**, particularly around numeric values, dates, or key qualifiers."（`dedupe_edges.py:53`）
- **两个候选池**：`EXISTING FACTS` 与 `FACT INVALIDATION CANDIDATES`，idx **跨两池连续编号**（`dedupe_edges.py:56-58, 73`）。
- **防御性校验**：LLM 返回的 idx 越界会被记 warning 并过滤，不崩：

  ```python
  invalid_duplicates = [i for i in duplicate_facts if i < 0 or i >= len(related_edges)]
  if invalid_duplicates:
      logger.warning('LLM returned invalid duplicate_facts idx values %s ...')
  duplicate_fact_ids = [i for i in duplicate_facts if 0 <= i < len(related_edges)]
  ```
  （`edge_operations.py:735-742` 与 `760-772`）

→ **可迁移的机制**：把"这条新记忆和已有的哪些冲突"变成**可校验的结构化判定**（两个整数列表 + 边界检查），而不是让 LLM 自由输出"我更新了记忆"。

### 8.2 mem0：**没有独立校验**（【源码】）

`DEFAULT_UPDATE_MEMORY_PROMPT` 的输出**就是**记忆本身（`event` 字段 + 新 `text`），没有第二道验证。LLM 说 DELETE 就 DELETE，没有检查被删的那条是否真的和 `old_memory` 一致。

→ 我在 `configs/prompts.py` 与 `memory/main.py` 里没有找到任何"校验 / 回滚 / 二次确认"逻辑。这是**缺失**，不是"我没找到文档"。

### 8.3 Letta：没有记忆正确性验证，只有上下文预算管理（【源码】）

摘要器有 `middle_truncate_text` 的字节级安全、有角色序列约束、有 idx 越界这类**程序性**防护，但**没有**任何"这条记忆是否仍然成立"的检查。

### 8.4 A-MEM：演化是一致性维护，不是校验（【源码】）

`should_evolve` 让 LLM 判断新记忆是否要改写邻居的 context/tags（§4.5）。这**维护了记忆网的一致性**，但没有"验证旧记忆是否仍为真"的语义。且 `consolidate_memories()` 是**全量重建**，不做校验。

### 8.5 外部基准：怎么量"记得对不对"

| 基准 | 规模 / 能力 | 我读到什么程度 |
|---|---|---|
| **LongMemEval** · arXiv 2410.10813 · https://github.com/xiaowu0162/LongMemEval | **500 道题**，测 5 项核心长期记忆能力：Information Extraction / Multi-Session Reasoning / **Knowledge Updates** / Temporal Reasoning / **Abstention**。ICLR 2025。数据集三档：`oracle` / `s_cleaned` / `m_cleaned`。2026/05 出了 LongMemEval-V2（agentic 场景）。 | 【文档】README 全文 + 标题核对 |
| **MemoryAgentBench** · arXiv 2507.05257 · https://github.com/HUST-AI-HYZ/MemoryAgentBench | **4 项能力**：Accurate Retrieval (AR) / Test-Time Learning (TTL) / Long-Range Understanding (LRU) / **Conflict Resolution (CR)**。新构造 EventQA 与 FactConsolidation。设计哲学："**inject once, query multiple times**"。ICLR 2026 接收。 | 【文档】README 全文 + 标题核对 |
| **LoCoMo** · arXiv 2402.17753 | 标题 "Evaluating Very Long-Term Conversational Memory of LLM Agents"。 | 【标题核对】 |

**注意 LongMemEval 的 `Abstention`（弃答）和 MemoryAgentBench 的 `Conflict Resolution`（冲突消解）** —— 这两项正是"记得对不对"的可量化形式：
- Abstention 量的是**该说不知道时会不会瞎编**。
- Conflict Resolution 量的是**新旧信息冲突时会不会用错旧值**。

→ 这两项对 dsh-steward 直接可用：**它们是可以拿来自测的现成指标**，不需要自己设计评测集。

### 8.6 可借鉴的 RAG 侧自校验（不是记忆系统，标注为【文档】）

- **CRAG**（arXiv 2401.15884，https://github.com/HuskyInSalt/CRAG）README 原文：

  > "a lightweight retrieval evaluator is designed to **assess the overall quality of retrieved documents for a query, returning a confidence degree** based on which different knowledge retrieval actions can be triggered... a **decompose-then-recompose** algorithm is designed for retrieved documents to **selectively focus on key information and filter out irrelevant information** in them."

  → **对检索结果本身打分 → 触发不同动作（含 web 兜底）**，而不是无条件相信检索结果。

- **Self-RAG**（arXiv 2310.11511，ICLR 2024 Oral，https://github.com/AkariAsai/self-rag）README 原文：

  > "**retrieves on demand** (e.g., can retrieve multiple times or **completely skip retrieval**) given diverse queries, and **criticize its own generation** from multiple fine-grained aspects by predicting **reflection tokens** as an integral part of generation."

  → **"有时候根本不该检索"是模型自己学的决策**，这和 hermes-agent 那条正则（§9.2）是同一思路的两种实现：**规则版 vs 学习版**。

- **SelfCheckGPT**（arXiv 2303.08896）：标题核对为 "Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models"。机制（采样一致性检测）**我未读正文，故不作为结论**。

---

## 9. ★ 短消息怎么办（好 / 继续 / 不对）

> 这是本任务的重点。**找到了五条已被实现出来的做法**，其中两条是生产代码里针对这个问题的**直接修复**。

问题的本质，用 Anthropic 的话说就是 §6.8 那句：**"traditional RAG solutions remove context when encoding information"**。
把一个 chunk `"The company's revenue grew by 3% over the previous quarter."` 换成 `"好"`，问题一模一样：**单看没有语义，成串才有意图。**

### 9.1 解法 A：入库前丢弃（【源码】）

- **mem0**：抽取 prompt few-shot 里 `Input: Hi.` → `Output: {"facts" : []}`；新版明文排除 "Generic assistant acknowledgments (**"Sure!"**, "Great question!")"。`configs/prompts.py:15-62, 468+`
- **Letta**：`archival_memory_insert` 的 best practices 明文 "Store self-contained facts or summaries, **not conversational fragments**"。`functions/function_sets/base.py:164-190`

→ 两家立场一致：**短消息不进长期记忆层。** 但这只解决"别污染"，**不解决"那串意图就丢了"**。

### 9.2 解法 B：检索时**整体跳过**（【源码】）—— 生产代码直接修复

**NousResearch/hermes-agent**（有外部 memory provider 的 agent harness）。commit `2f14c3e`（2026-08-03，我通过 GitHub commit API 读到完整 diff）：

```
fix: skip memory prefetch on trivial user prompts (greetings)
- Gate the per-turn memory_manager.prefetch_all() on a trivial-prompt check so
  greetings/acknowledgements ('hi!', 'thanks', 'ok') no longer block the turn on
  provider network round-trips or inject stale context.
```

`agent/turn_context.py` 里新增的正则（**这就是"短消息清单"的权威字面版本**）：

```python
_RE_TRIVIAL_USER_QUERY = re.compile(
    r'^(yes|no|ok|okay|sure|thanks|thank you|y|n|yep|nope|yeah|nah|'
    r'hi|hey|hello|yo|sup|'
    r'continue|go ahead|do it|proceed|got it|cool|nice|great|done|next|lgtm|k)'
    r'[\s!?.:;,"\'~\u2018\u2019\u201c\u201d\u2014\u2013\u2026()\[\]{}<>*&^%$#@!+=`\u00a0]*$',
    re.IGNORECASE,
)
```

调用处：

```python
ext_prefetch_cache = ""
if agent._memory_manager:
    _query = original_user_message if isinstance(original_user_message, str) else ""
    if not _is_trivial_user_query(_query):
        ext_prefetch_cache = agent._memory_manager.prefetch_all(_query) or ""
```

`_is_trivial_user_query()` 还会把空串、纯空白、以 `/` 开头（斜杠命令）也判为 trivial。

→ **结论：对一个"好"字，正确动作可能是"不查记忆"，而不是"想办法查出点什么"。** 理由（commit 原文）有两条：避免 (1) 无谓的 provider 网络往返，(2) **注入过期的上下文（inject stale context）**。
→ 注意这个正则**允许任意尾随标点/表情**（`"hi!"` `"hey."` `"thanks :)"` 都算 trivial），这个细节值得抄。

### 9.3 解法 C：用**周围上下文替换 query**（【源码】）—— 生产代码直接修复

**mixpeek/amux**。commit `a95c6de`（2026-06-18）：

```
fix(task-summary): use terminal context for vague inputs like 'continue'
When the sent message is a stop word (continue, yeah, ok, done, etc.) or
under 4 chars, fall back to the last 20 lines of terminal output so the
label reflects what the session is actually working on.
```

`amux-server.py` 里的短消息集合与判定：

```python
_VAGUE_INPUTS = {
    "continue", "cont", "go", "ok", "okay", "yes", "yeah", "yep", "yup", "no",
    "done", "hi", "hello", "hey", "thanks", "thank you", "great", "good", "nice",
    "sure", "proceed", "next", "more", "again", "retry", "stop", "wait", "do it",
    "sounds good", "looks good", "perfect", "lgtm", "go ahead", "keep going",
}

stripped = re.sub(r'^\[.*?\]\s*', '', text).strip().lower().rstrip(".")
is_vague = stripped in _VAGUE_INPUTS or len(stripped) <= 4
if is_vague:
    raw = tmux_capture(session_name, 50)                      # 抓 50 行
    clean = re.sub(r'\x1b\[[0-9;]*[mK]', '', raw)             # 去 ANSI
    ctx_lines = [l.strip() for l in clean.splitlines() if l.strip()
                 and not l.strip().startswith('─') and '❯' not in l][-20:]   # 取最后 20 行
    context = " ".join(ctx_lines)[:600]
    prompt = f"Based on this terminal output, summarize what task is being worked on in 3 words: {context}"
else:
    prompt = f"Summarize this task in 3 words: {text[:400]}"
```

→ **这是"成串才有意图"最直接的实现：短消息的 query 被替换成它周围的环境（最近 20 行终端输出）。** 和我们场景的对应关系很清楚：**终端输出 → 最近的对话轮次**。
→ 它还多了一个判据：**`len(stripped) <= 4`** —— **不靠词表，靠长度**。这是词表法之外的第二道网。

### 9.4 解法 D：**嵌入前**给短消息补上下文（【文档】+【论文·摘要】）

通用技术，两个层次：

1. **Anthropic Contextual Retrieval**（§6.8，官方工程博客，我读了全文）：给每个 chunk 前置 50~100 token 的"它在整体文档中的定位"，然后再嵌入 + 建 BM25。失败率 5.7%→3.7%（仅嵌入）/→2.9%（+BM25）/→1.9%（+重排）。
   → **直接类比到我们**：一条 `"好"` 的 chunk，其 `WHOLE_DOCUMENT` 就是它所在的那段对话窗口；把窗口的定位信息前置到 `"好"` 之前再嵌入，向量就带上了意图。
   → **必须标注这是我的推断**：Anthropic 的原文讲的是文档 chunk，**没有提到短消息/对话**。这是同构迁移，不是原文结论。

2. **Late Chunking**（§6.9，arXiv 2409.04701）：先让长上下文模型编码**全文**，再在 mean pooling 前按 chunk 池化。→ **原文字面不变，只让向量带上全文语境。**
   → 这条路径对"成串意图"很有吸引力，因为**我们不必改写用户的原话**（用户说"好"就是"好"），只是让它的向量带上邻居。

**负面证据**（Anthropic 原文）：给 chunk 加"通用文档摘要"收益很低、summary-based indexing 表现也不好。→ **所以"给每块配个摘要"不如"给每块配它自己的定位上下文"。**

### 9.5 解法 E：不丢，靠**重要性累积阈值**决定何时上升到高层（【源码】）

**Generative Agents** 是唯一"每条都存"的（§4.6）。它对短消息的处理是**结构性的**：

- 每条 observation 由 LLM 打 `poignancy` 1~10（`1 = purely mundane (e.g., brushing teeth, making bed)`）。
- **反思触发条件**是**重要性累积**，不是条数（`cognitive_modules/reflect.py:135-153`）：

  ```python
  def reflection_trigger(persona):
      if (persona.scratch.importance_trigger_curr <= 0 and
          [] != persona.a_mem.seq_event + persona.a_mem.seq_thought):
          return True
      return False
  ```

  `importance_trigger_max = 150`（`memory_structures/scratch.py:61`）；每次反思后 `reset_reflection_counter()` 把计数重置回 150。
- 检索时 `importance` 参与加权（recency × 0.5 + relevance × 3 + importance × 2，§7.5）。

→ **"好" 会被打 1 分，被存下来，但几乎不可能把累积重要性推到 150 去触发一次反思。** 这就是"**存得起，但升不上去**"的设计：低信息量输入自然沉在底层，不影响高层抽象。

### 9.6 解法 F：绑成检索单元，别用短消息当单元（【源码】）—— 三家殊途同归

| 系统 | 绑定方式 | 源码位置 |
|---|---|---|
| **MemoryOS** | short-term 装的是 **QA 对**（`user_input` + `agent_response` 一起），**不是单条消息**；晋升时成 **page**，page 之间用 `pre_page`/`next_page` 连成**对话链**；检索回来**带 `meta_info`** 一起喂模型 | `short_term.py:10-16`、`mid_term.py:66-73`、`memoryos.py:271-289` |
| **Graphiti** | 原始输入是 **Episode**，多个 episode 用 **`NextEpisodeEdge`** 串成时间线；检索有 **`episode_mentions` 重排器** —— 被越多 episode 提到越靠前 | `edges.py:822`、`search_config.py:57` |
| **Letta** | 短消息留在 **recall（消息表）**，可以 **`query=None` + `start_date`/`end_date`** 按时间窗捞回，**完全绕开语义检索** | `functions/function_sets/base.py:87-160` |
| **LlamaIndex** | 短消息留在 **FIFO 队列**；只有被挤出时，**每个 block 各自决定收不收**（`accept_short_term_memory`） | `memory.py:121-123, 158` |

→ **四家得出同一个工程结论：短消息的检索单元不能是短消息本身。** 要么绑成「问答对 / 页 / 链 / 时间线」，要么绕开语义检索走时间窗。

### 9.7 一个反例：mem0 的阈值会把短消息**提前砍掉**（【源码】）

§7.1 已述：`score_and_rank()` 里 `if semantic_score < threshold: continue`，且注释明说 threshold 在 combine **之前**生效。
→ 短消息对任何 query 的向量分都低 → **在 mem0 里，短消息即使经由 BM25 或实体图能命中，也永远进不了候选集。**
→ **如果我们想用"成串意图"，绝不能照抄 mem0 的 threshold 位置。**

### 9.8 ★ 本节小结：五条做法的取舍

| 做法 | 谁在用 | 代价 | 适合我们吗 |
|---|---|---|---|
| A 入库前丢弃 | mem0、Letta | 意图永久丢失 | **要**（挡住"好"污染 vecmem），但不够 |
| B 检索时跳过 | hermes-agent | 该轮无记忆 | **要**（避免 stale context 注入） |
| C 用上下文替换 query | amux | 依赖能拿到上下文 | **要**（我们本来就有会话上下文） |
| D 嵌入前补上下文 | Anthropic / Jina late chunking | 写入成本（$1.02/M token） | **要**（治本，且原话不改） |
| E 重要性累积阈值 | Generative Agents | 需要每轮打分 | 可选（可用于决定哪些进入高层） |
| F 绑成检索单元 | MemoryOS / Graphiti / Letta / LlamaIndex | 改存储结构 | **要**（最根本的一条） |

### 9.9 ★ 缺口：没人处理"连续多轮同向短回复"

**我没有找到任何一个系统，把"好 / 好 / 继续"这种连续多轮肯定聚合成一个意图单元。**
- mem0 / Letta：逐条丢弃（§9.1）。
- hermes-agent：逐轮跳过（§9.2）—— 正则只看**单条**消息，不看前文。
- amux：逐条用环境替换（§9.3）—— 是**替换**，不是**聚合**。
- MemoryOS：QA 对是"一轮"，多轮肯定就是多个独立 QA 对，靠 `CONTINUITY_CHECK` 连成链，**但没有"这几轮在说同一件事"的合并**。
- Generative Agents：每条独立打分，靠重要性累积决定何时反思，**不产生"多轮肯定"这个对象**。

→ 这是一个真实空白，见 §11 缺口 1。**如果 dsh-steward 要做，这是原创空间。**

---

## 10. 对本机 dsh-steward 的具体建议

> 对照现状：vecmem 22,793 条 / 4096 维 / 两阶段检索（嵌入 → 交叉编码器重排）；
> 来源分布 docs 21,117（92.7%）· getnote 1,476 · session 178 · wemeet 14 · dsh 8；
> 缺「关于用户的记忆」，载体是短消息。

1. **不要在 vecmem 里存短消息。** 1800 字符分块对 1~3 字符输入无意义，且 92.7% 已被文档切片占满 —— 短消息进去只会被淹没。用**独立的消息表**（Letta recall / LlamaIndex FIFO 的做法）。
2. **写入前必过抽取**（mem0 模式），且把排除规则写成 few-shot 而不是散文描述 —— mem0 的 `Input: Hi.` → `{"facts": []}` 比任何"请勿记录无意义内容"的指令都有效。
3. **要做"成串意图"，绑成页而不是单条**（MemoryOS 模式）：`(用户话, 助手话)` 成对入库；邻近页用 `pre_page`/`next_page` 相连；入库的是**页摘要 + 页关键词**；检索命中摘要后**把原页连着链信息一起**喂回。
4. **短消息的检索入口照抄 hermes-agent 的正则 + amux 的长度判据**（§9.2/9.3），并**把 query 替换成最近若干轮**（amux 的 `tmux_capture` → 我们的"最近会话窗口"）。
5. **治本用 Anthropic Contextual Retrieval 的同构迁移**（§9.4）：给每条消息在嵌入**前**前置"它在会话窗口中的定位"。注意这是同构迁移，不是原文结论（Anthropic 讲的是文档 chunk）。
6. **淘汰优先学 Graphiti 而不是 mem0**：Graphiti 不删行、打 `invalid_at` + `expired_at`；mem0 开源版根本没有遗忘。**"失效"比"删除"更可回滚，也更省心。**
7. **验证机制抄 Graphiti 的 `resolve_edge`**：把"新记忆与哪条旧记忆重复/矛盾"变成**两个 idx 列表 + 越界校验**；prompt 里必须带那三条反例（重复 / 矛盾非重复 / 无关），否则 LLM 会把"改了个标题"当成重复。
8. **检索有两个明确的坑不要踩**：
   - 别把阈值卡在融合前（mem0 的坑，§7.1）——短消息会被提前砍掉。
   - 别只用页分不用会话分（MemoryOS 作者自认的未决问题，§7.4）。
9. **压缩用 LlamaIndex 的"冷凝快照"**：不删单条，而是**定期把整个用户事实列表重写成 ≤ N 条**（`max_facts` 默认 50），检索时一次拿全，不用多次查再合并。
10. **自测直接上 LongMemEval 的 `Knowledge Updates` / `Abstention` 和 MemoryAgentBench 的 `Conflict Resolution`**（§8.5）——现成指标，不用自己设计评测集。
11. **注意 A-MEM 与 mem0 的"文档 vs 实现"落差**（A-MEM docstring 说 hybrid 实为单路；LlamaIndex `priority` docstring 与代码方向叙述矛盾）→ **接入任何开源记忆层时，检索路径与排序语义必须读源码确认，不能信 docstring。**

---

## 11. 没找到答案的问题（诚实缺口清单）

1. **没有任何系统处理"连续多轮同向短回复"的意图聚合**（§9.9）。"好 / 好 / 继续"在五家里都只是三个独立事件。**这是最大的空白。**
2. **"只记验证过的"没有通用实现**。唯一实例是 mem0 `ADDITIVE_EXTRACTION_PROMPT` 里的一条受限规则（"Vague assistant characterizations ... **unless the user explicitly confirms them**"），只覆盖"助手对用户的描述"这一类。**没找到任何系统把它作为全局写入策略。**
3. **没有任何系统对"记忆条目的正确性"做过期回检**。Graphiti 的 `invalid_at` **只在新信息到达时被动触发**；没有"过一段时间回头验证旧记忆是否仍成立"的机制。
4. **MemOS 的淘汰判据没查到**。我找到了它的 10 种 `memory_type` 和三种物理载体，但没有在 `src/memos/memories/` 下找到明确的删除/降权器（`mem_scheduler` 下有 `filter_pipeline.py` / `rerank_pipeline.py`，但那是**检索后过滤**，不是淘汰）。**标记为【未证实】，不写进结论。**
5. **MemOS 的 "MemLifecycle（Generated/Activated/Merged/Archived/Expired）" 状态机，我在源码里没找到**。我在 `memories/base.py` 里只看到 `BaseMemory` 的 `load/dump`；`textual/item.py` 里 `memory_type` 字段的 description 写的是 "Memory lifecycle type"，但值是上面那 10 个类型标签，**不是生命周期状态**。→ 论文声称的状态机与代码里的字段**可能不是一回事**，我没读论文正文，不敢断言。**标记为【未证实】。**
6. **没有找到任何"记忆检索质量"的端到端在线度量**（即：系统自己知道自己这次检索得好不好）。CRAG 的 retrieval evaluator 是最接近的，但它是 RAG 的，且需要专门微调一个评估器。
7. **SelfCheckGPT / Reflexion / Sleep-time Compute / HippoRAG / SeCom / MemWalker / MemoryBank / Recursively Summarizing / MemGPT 论文正文我都没读**，只核对了标题（见 §12）。这些可能是缺口 1~3 的答案所在，但按纪律**不写没读过的内容**。
8. **短消息的量化收益没有数据**。§9.2/9.3 的两个修复都**只给了定性理由**（"avoid stale context"、"reflects what the session is actually working on"），**commit 里没有任何评测数字**。→ 也就是说"跳过检索"和"用上下文替换 query"哪个更好，**没有公开对照实验**。

---

## 12. 参考清单（含证据级别）

### 【源码】我读过源码的项目

**mem0** — https://github.com/mem0ai/mem0 （Apache-2.0，66,213 stars，2026-09-25 最后推送）
- `mem0/configs/prompts.py`：`FACT_RETRIEVAL_PROMPT`(15-62)、`DEFAULT_UPDATE_MEMORY_PROMPT`(176-325)、`ADDITIVE_EXTRACTION_PROMPT`(468+)、`get_update_memory_messages`(406)、`PAST_MESSAGE_TRUNCATION_LIMIT=300`(965)
- `mem0/utils/scoring.py`：`score_and_rank`(60-140)、`ENTITY_BOOST_WEIGHT=0.5`(57)、`get_bm25_params`(16)、`normalize_bm25`(43)
- `mem0/memory/main.py`：过期判定(427-449)、`decay` 抛错(467-483)、reranker(505-510)、`search`(1393)
- `mem0/memory/notices.py`：`DECAY_FEATURE_ERROR_MESSAGE`(134)、`DECAY_FEATURE_NOTICE_ID`(102)

**Letta**（原 MemGPT）— https://github.com/letta-ai/letta （Apache-2.0，24,950 stars）
> ⚠️ **仓库状态异动（2026-09-28 观察）**：`main` 分支只剩 15 个条目（README/LICENSE 等）。README 原文说当前源码在 https://github.com/letta-ai/letta-code，V1 Python server 退到 **`archive` 分支**。**我读的是 `archive` 分支。**
- `letta/schemas/block.py`：`BaseBlock`(19-40)、`Human`/`Persona`(117-125)
- `letta/constants.py`：`CORE_MEMORY_BLOCK_CHAR_LIMIT=100000`(435)、`DEFAULT_MAX_MESSAGE_BUFFER_LENGTH=30`(89)
- `letta/services/summarizer/summarizer.py`：`partial_evict_summarizer_percentage=0.30`(49)、`_partial_evict_buffer_summarization`(136-243)、`_static_buffer_summarization`(244)、`middle_truncate_text`(387-433)、`build_summary_request_text`(436-457)
- `letta/functions/function_sets/base.py`：`conversation_search`(87-160)、`archival_memory_insert`(164-190)、`archival_memory_search`(194-245)、`core_memory_append`(246)、`core_memory_replace`(263)
- `letta/prompts/system_prompts/sleeptime_v2.py`（全文）
- `letta/schemas/memory.py`（`Memory.compile`(688)、`BasicBlockMemory`(783)）
- `letta/services/memory_repo/`、`letta/groups/sleeptime_multi_agent_v{1..4}.py`（存在性）

**Zep / Graphiti** — https://github.com/getzep/graphiti （Apache-2.0，31,261 stars）
- `graphiti_core/edges.py`：`EntityEdge` 四时间戳(263-281)、`EpisodicEdge`(143)、`CommunityEdge`(575)、`HasEpisodeEdge`(689)、`NextEpisodeEdge`(822)
- `graphiti_core/search/search_config.py`：枚举(32-78)
- `graphiti_core/search/search_config_recipes.py`：`COMBINED_HYBRID_SEARCH_{RRF,MMR,CROSS_ENCODER}`(34/56/81) 及单层配方(111+)
- `graphiti_core/search/search.py`：`search`(98-243)、`edge_search`(253+)、rrf(374)、mmr(375-392)
- `graphiti_core/utils/maintenance/edge_operations.py`：`extract_edges`(117)、`resolve_extracted_edges`(325)、`resolve_edge_contradictions`(538-570)、`_extract_edge_timestamps`(576-621)、`resolve_extracted_edge`(623-733)、idx 校验(735-772)
- `graphiti_core/prompts/dedupe_edges.py`：schema(25-31)、`resolve_edge`(43-96)

**MemoryOS** — https://github.com/BAI-LAB/MemoryOS （Apache-2.0，1,590 stars，EMNLP 2025 Oral）
- `memoryos-chromadb/short_term.py`(9-50)、`mid_term.py`(21-37 热度、75-96 LFU、173 堆、279-356 两级检索)、`long_term.py`(12-22)、`utils.py`(154-163 时间衰减)、`updater.py`(107-205)、`retriever.py`(44-68、102-116)、`prompts.py`(69-74、209-233)、`memoryos.py`(38-42、138-205、236-320)
- 同仓库另有 `memoryos-mcp/` 与 `memoryos-playground/` 两份近重复实现

**MemOS** — https://github.com/MemTensor/MemOS （Apache-2.0，11,620 stars）
- `src/memos/memories/textual/item.py`：`TreeNodeTextualMemoryMetadata` 十种 `memory_type`(175-189)、`TextualMemoryItem`(299)
- `src/memos/memories/textual/tree.py`：`TreeTextMemory`(39)、`add`(103)、`replace_working_memory`(116)、`get_working_memory`(121)、`search`(157-228)、`get_relevant_subgraph`(233-324)
- `src/memos/mem_cube/general.py`：`text_mem`/`act_mem`/`para_mem`/`pref_mem`(187-236)
- `src/memos/mem_scheduler/memory_manage_modules/activation_memory_manager.py`（全文头部）
- `src/memos/memories/activation/{kv,vllmkv}.py`、`src/memos/memories/parametric/lora.py`（存在性）

**A-MEM** — https://github.com/agiresearch/A-mem （MIT，1,186 stars）
- `agentic_memory/memory_system.py`：`MemoryNote`(24-70)、`AgenticMemorySystem`(83)、`evo_threshold=100`(97)、evolution prompt(127-158)、`analyze_content`(159-231)、`add_note`(233-264)、`consolidate_memories`(266-290)、`find_related_memories`(291+)、`search`(432-441)
- `agentic_memory/retrievers.py`：`ChromaRetriever`(42)、`PersistentChromaRetriever`(147)、`CopiedChromaRetriever`(210)

**Generative Agents** — https://github.com/joonspk-research/generative_agents
- `reverie/backend_server/persona/cognitive_modules/retrieve.py`：`normalize_dict_floats`、`extract_recency`、`extract_importance`、`extract_relevance`、`new_retrieve`（`gw = [0.5, 3, 2]`）
- `reverie/backend_server/persona/cognitive_modules/reflect.py`：`reflection_trigger`(135-153)、`reset_reflection_counter`(156-169)
- `reverie/backend_server/persona/memory_structures/scratch.py`：`att_bandwidth=3`(21)、`retention=5`(23)、权重(57-62)
- `reverie/backend_server/persona/memory_structures/associative_memory.py`（`poignancy` 字段位置）
- `reverie/backend_server/persona/prompt_template/v2/poignancy_event_v1.txt`（全文）

**LlamaIndex Memory** — https://github.com/run-llama/llama_index
- `llama-index-core/llama_index/core/memory/memory.py`：`BaseMemoryBlock`(103-135，含 `priority`、`accept_short_term_memory`)、`aput` 准入(158)、`Memory` docstring(188-201)、`token_limit`/`token_flush_size`/`chat_history_token_ratio`(205-215)、`from_defaults`(289-335)、`_get_memory_blocks_content`(446-479)、`_truncate_memory_blocks`(481-530)、FIFO flush(709-761)
- `llama-index-core/llama_index/core/memory/memory_blocks/fact.py`：`DEFAULT_FACT_EXTRACT_PROMPT`(15-36)、`DEFAULT_FACT_CONDENSE_PROMPT`(38-60)、`max_facts=50`(86-88)
- 同目录 `static.py`、`vector.py`

**RAPTOR** — https://github.com/parthsarthi03/raptor （`master` 分支）
- `raptor/cluster_utils.py`：`global_cluster_embeddings`(23-37)、`local_cluster_embeddings`(37)、`get_optimal_clusters` BIC(46-58)、`GMM_cluster`(60-67)、`perform_clustering`(69)、`RAPTOR_Clustering`(132-160)
- `raptor/cluster_tree_builder.py`：`ClusterTreeConfig`(`reduction_dimension=10`)、`construct_tree`、`process_cluster`
- `raptor/tree_retriever.py`：`TreeRetrieverConfig`(`threshold=0.5`/`top_k=5`/`selection_mode`)(19-54)、`retrieve_information_collapse_tree`(158)、`retrieve_information`(197-232)
- 另有 `raptor/tree_builder.py`、`tree_structures.py`、`RetrievalAugmentation.py`

**GraphRAG** — https://github.com/microsoft/graphrag
- `packages/graphrag/graphrag/graphs/hierarchical_leiden.py`：`hierarchical_leiden(max_cluster_size=10, random_seed=0xDEADBEEF)`、`first_level_hierarchical_clustering`、`final_level_hierarchical_clustering`
- `packages/graphrag/graphrag/data_model/community_report.py`：`CommunityReport` 字段
- `packages/graphrag/graphrag/index/operations/summarize_communities/`、`cluster_graph.py`

**LLMLingua** — https://github.com/microsoft/LLMLingua
- `llmlingua/prompt_compressor.py`：`__init__`(71)、`compress_prompt`(426-522：`iterative_size=200`、`context_budget="+100"`、`force_tokens`、`chunk_end_tokens=[".","\n"]`)、`compress_prompt_llmlingua2`(727+)、`control_context_budget`(602)

**生产修复（★ 短消息的直接证据）**
- **NousResearch/hermes-agent** — commit `2f14c3e5b0b10a7cc2311c4e03b0daf4bf7bd904`
  https://github.com/NousResearch/hermes-agent/commit/2f14c3e5b0b10a7cc2311c4e03b0daf4bf7bd904 （2026-08-03）
  改动文件：`agent/turn_context.py`(+37/-1)、`plugins/memory/honcho/__init__.py`(+5/-3)。**我通过 GitHub commit API 读到了完整 patch。**
- **mixpeek/amux** — commit `a95c6dea81c1d3de390c03fc8c54cf456eaeef0a`
  https://github.com/mixpeek/amux/commit/a95c6dea81c1d3de390c03fc8c54cf456eaeef0a （2026-06-18）
  改动文件：`amux-server.py`(+23/-2)。**同上，读的是 patch。**

### 【文档】官方文档 / README

- **Anthropic — "Introducing Contextual Retrieval"**（2024-09-19）
  https://www.anthropic.com/engineering/contextual-retrieval **（我读了全文）**
  配套 cookbook：https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide （**未读**）
  附录（含各数据集数字）：https://assets.anthropic.com/m/1632cded0a125333/original/Contextual-Retrieval-Appendix-2.pdf （**未读**）
- **LongMemEval** https://github.com/xiaowu0162/LongMemEval （README 全文）；数据 https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned ；V2 https://github.com/xiaowu0162/LongMemEval-V2
- **MemoryAgentBench** https://github.com/HUST-AI-HYZ/MemoryAgentBench （README 全文）
- **CRAG** https://github.com/HuskyInSalt/CRAG （README 概述段原文引用）
- **Self-RAG** https://github.com/AkariAsai/self-rag （README 概述段原文引用）

### 【论文·摘要】/【标题核对】

全部编号与标题经 `export.arxiv.org/api/query` 核对。标注"【摘要】"者我读了 arXiv 摘要页；其余**只核对到标题，正文与摘要均未读**。

| arXiv | 标题 | 我读到 |
|---|---|---|
| 2310.08560 | MemGPT: Towards LLMs as Operating Systems | 【标题核对】 |
| 2504.19413 | Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory | 【标题核对】 |
| 2501.13956 | Zep: A Temporal Knowledge Graph Architecture for Agent Memory | 【标题核对】 |
| 2506.06326 | Memory OS of AI Agent | 【标题核对】 |
| 2507.03724 | MemOS: A Memory OS for AI System | 【标题核对】 |
| 2502.12110 | A-MEM: Agentic Memory for LLM Agents | 【标题核对】 |
| 2304.03442 | Generative Agents: Interactive Simulacra of Human Behavior | 【标题核对】 |
| 2401.18059 | RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval | 【标题核对】 |
| 2404.16130 | From Local to Global: A Graph RAG Approach to Query-Focused Summarization | 【标题核对】 |
| 2410.10813 | LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory | 【标题核对】 |
| 2402.17753 | Evaluating Very Long-Term Conversational Memory of LLM Agents（LoCoMo） | 【标题核对】 |
| 2507.05257 | Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions（MemoryAgentBench） | 【标题核对】 |
| 2502.05589 | On Memory Construction and Retrieval for Personalized Conversational Agents（SeCom） | 【标题核对】 |
| 2308.15022 | Recursively Summarizing Enables Long-Term Dialogue Memory in Large Language Models | 【标题核对】 |
| 2310.05029 | Walking Down the Memory Maze: Beyond Context Limit through Interactive Reading（MemWalker） | 【标题核对】 |
| 2305.10250 | MemoryBank: Enhancing Large Language Models with Long-Term Memory | 【标题核对】 |
| 2405.14831 | HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models | 【标题核对】 |
| 2502.14802 | From RAG to Memory: Non-Parametric Continual Learning for Large Language Models（HippoRAG 2） | 【标题核对】 |
| 2310.11511 | Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection | 【标题核对】 |
| 2401.15884 | Corrective Retrieval Augmented Generation（CRAG） | 【标题核对】 |
| 2303.08896 | SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection for Generative Large Language Models | 【标题核对】 |
| 2303.11366 | Reflexion: Language Agents with Verbal Reinforcement Learning | 【标题核对】 |
| 2504.13171 | Sleep-time Compute: Beyond Inference Scaling at Test-time | 【标题核对】 |
| **2409.04701** | **Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models** | **【摘要】读全文摘要** |
| 2310.06839 | LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression | 【标题核对】 |
| 2403.12968 | LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression | 【标题核对】 |
| 2310.04408 | RECOMP: Improving Retrieval-Augmented LMs with Compression and Selective Augmentation | 【标题核对】 |

### 核对中剔除的错误引用

- ~~arXiv 2406.08048 MemoChat~~ → 该编号实际是 **"3D CBCT Challenge 2024: Improved Cone Beam CT Reconstruction using SwinIR-Based Sinogram and Image Enhancement"**，与 agent 记忆无关。**已在核对阶段发现并从清单剔除**，正文中未引用。

---

## 13. 后续可做（本稿未覆盖）

按价值排序，这些是下一步最值得补的（我未读、故本稿不写结论）：

1. ~~短消息~~ → 已尽量覆盖，**剩"多轮同向聚合"是空白**（§9.9）。
2. **MemGPT / MemOS 论文正文** —— 用来确认 §11 缺口 5（MemLifecycle 状态机）到底是论文概念还是我漏看的代码。
3. **MemoryBank（2305.10250）** —— 标题指向"记忆增强"，且常与 Ebbinghaus 遗忘曲线关联。**若其实现了遗忘曲线，就是 §5 里唯一一个"按遗忘曲线淘汰"的公开实现**，价值高。
4. **SeCom（2502.05589）标题为 "On Memory Construction and Retrieval for Personalized Conversational Agents"** —— "记忆构造与检索"直击本题，且是**对话**场景。
5. **LongMemEval / MemoryAgentBench 实测**：用它们量一下 dsh-steward 自己的记忆层，比继续读论文更有价值。
6. **Reflexion（2303.11366）/ Sleep-time compute（2504.13171）** —— 与"验证"和"离线整理"相关。
