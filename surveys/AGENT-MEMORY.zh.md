# Agent 记忆系统的实现方案调研

> 状态：**草稿 v1（增量落盘中）**。本文件按「读到一个项目就写一段」的方式增量补齐，不追求一次成型。
> 调研日期：2026-09-28。
> 写权限：本文件是本任务唯一可写文件，其余全部只读。

## 0. 证据分级约定（贯穿全文）

每条结论后标注来源与**我实际读到什么程度**：

| 标记 | 含义 |
|---|---|
| 【源码】 | 我读过该项目源码的具体文件，并复述了我读到的行为。行号/文件路径可复查。 |
| 【论文】 | 我读过该论文（arXiv 摘要 + 我确实读到的正文部分）。arXiv 号与标题已用 `export.arxiv.org/api/query` 逐条核对过。 |
| 【文档】 | 我只读了 README / 官方文档，**是项目方声称，我没有验证实现**。 |
| 【未证实】 | 我找不到依据 —— 按调研纪律第 3 条，此类内容不写进结论，只在第 8 节列为「没找到答案的问题」。 |

**调研纪律**：每条带 URL；区分「我读过的」和「它声称的」；找不到依据的不写。

---

## 1. 结论摘要（TL;DR）

1. **没有一个大项目靠"把原始消息灌进向量库"来做长期记忆。** mem0 / Letta / Zep / MemoryOS / MemOS 五家无一例外，都在写入路径上先做一次**抽取或分段**，落库的是"事实 / 页 / 边 / 条目"，不是原始消息。原始消息另存一条**消息表**，只在需要精确原文时用。
2. **分层的主流形态是 3~4 层，且分层的目的是"谁能被无条件看见"**，不是"存哪"。Letta：core（常驻上下文）/ recall（消息表）/ archival（向量）；MemoryOS：short（10 条队列）/ mid（2000 页）/ long（100 条知识）；MemOS 更激进，把记忆分成 **文本 / KV 激活 / LoRA 参数** 三种物理载体。【源码】
3. **淘汰的主战场是"降权"而不是"删除"。** Graphiti 用 `invalid_at` 给边打失效时间戳而**不删行**；MemoryOS 用热度堆淘汰会话；mem0 开源版**根本没有遗忘**（`decay` 参数直接抛错）。【源码】
4. **★ 短消息（好 / 继续 / 不对）问题的两个已知解法都不在"存储端调参"**：(a) mem0 在抽取 prompt 里用 few-shot 明确把 `Hi.` 映射成 `{"facts": []}`，**在入库前丢掉**；(b) 把无独立语义的短消息**和它的邻居绑成一个检索单元**（会话/页/片段窗口）再入库。见第 7 节。【源码】
5. **"怎么知道自己记得对不对"这件事，只有图谱派给了真机制**：Graphiti 每次写入都让 LLM 判 `duplicate_facts` / `contradicted_facts` 两个列表，矛盾则给旧边打 `invalid_at`。向量派基本没有——mem0 靠 LLM 输出的 ADD/UPDATE/DELETE 自述，没有校验。【源码】

---

## 2. 载体对比表

| 系统 | repo / 论文 | 物理载体 | 层数 | 我读到什么程度 |
|---|---|---|---|---|
| mem0 | https://github.com/mem0ai/mem0 | 向量库（可插）+ 实体表 + 图 | 事实（单层）+ 会话作用域 | 【源码】`mem0/configs/prompts.py`、`mem0/utils/scoring.py`、`mem0/memory/main.py` |
| Letta（原 MemGPT） | https://github.com/letta-ai/letta (archive 分支) · arXiv 2310.08560 | 块（块=上下文里的一段文本）+ 消息表 + 向量归档 | 3：core / recall / archival | 【源码】`letta/schemas/block.py`、`letta/services/summarizer/summarizer.py`、`letta/functions/function_sets/base.py`、`letta/prompts/system_prompts/sleeptime_v2.py` |
| Zep / Graphiti | https://github.com/getzep/graphiti · arXiv 2501.13956 | 时序知识图谱（节点+边+社区） | 4：episode / entity / edge / community | 【源码】`graphiti_core/edges.py`、`search/search_config*.py`、`utils/maintenance/edge_operations.py`、`prompts/dedupe_edges.py` |
| MemoryOS | https://github.com/BAI-LAB/MemoryOS · arXiv 2506.06326 | 队列 + 会话页 + profile/knowledge | 3：short / mid / long | 【源码】`memoryos-chromadb/{short_term,mid_term,long_term,updater,retriever,memoryos}.py` |
| MemOS | https://github.com/MemTensor/MemOS · arXiv 2507.03724 | **文本 / KV 激活 / LoRA 参数** 三种载体 + Neo4j 树 | 10 种 memory_type | 【源码】`src/memos/memories/textual/item.py`、`textual/tree.py`、`mem_scheduler/memory_manage_modules/activation_memory_manager.py` |
| A-MEM | https://github.com/agiresearch/A-mem · arXiv 2502.12110 | Zettelkasten 卡片网络 | 单层 + 链接 | 待补 |
| Generative Agents | arXiv 2304.03442 | memory stream（自然语言条目+打分） | 3：observation / reflection / plan | 待补 |
| RAPTOR | https://github.com/parthsarthi03/raptor · arXiv 2401.18059 | 递归聚类摘要树 | 树（多层） | 待补 |

> 待补项在后续增量中填写；未填完之前不视为结论。

---

## 3. 六问之一：分层怎么分

### 3.1 Letta：按"能不能被无条件看见"分层（【源码】）

三个物理上完全不同的存储，用"进不进上下文窗口"区分：

- **core memory（核心记忆）**：一组 **block**，每个 block 有 `label` / `description` / `value` / `limit`（字符上限）/ `read_only`。`value` 会被编译进 system prompt，**永远在上下文里**。`letta/schemas/block.py:19-40`。
  - `CORE_MEMORY_BLOCK_CHAR_LIMIT = 100000`，`letta/constants.py:435`。
  - 内置 `Human`（label 固定 `"human"`）与 `Persona` 两种 block，`letta/schemas/block.py:117-125`。
- **recall memory（回忆记忆）**：原始消息表。不进上下文，靠 `conversation_search` 工具按需查。
- **archival memory（归档记忆）**：向量库，永久，靠 `archival_memory_search` 语义检索。

层间流转的**唯一方向是"下沉"**，不是自动晋升：
- 上下文超限时，旧消息被摘要折叠（见 3.4 / 6.4）。
- 智能体被提示可以用 `archival_memory_insert` 把东西写进归档层；但这个动作**由 LLM 自己决定**，没有自动规则。【源码】`letta/functions/function_sets/base.py:164-190`

### 3.2 MemoryOS：按"时间尺度 + 容量"分层（【源码】）

`memoryos-chromadb/memoryos.py:38-42` 的构造参数就是分层定义：

```
short_term_capacity=10          # 短：deque(maxlen=10)
mid_term_capacity=2000          # 中：2000 个 session，堆排序
long_term_knowledge_capacity=100 # 长：100 条知识
retrieval_queue_capacity=7      # 检索回来最多 7 个页
mid_term_heat_threshold=H_PROFILE_UPDATE_THRESHOLD
mid_term_similarity_threshold=0.6
```

- **short**：`ShortTermMemory`，`deque(maxlen=max_capacity)`，装 **QA 对**（`user_input` + `agent_response` + `timestamp`），不是单条消息。`short_term.py:10-11`。
- **mid**：`MidTermMemory`，装 **session**（会话段）。一个 session 由若干 **page** 组成，page 之间用 `pre_page` / `next_page` 连成**对话链**。`mid_term.py:69-73`。
- **long**：`LongTermMemory`，分两支 —— **user profile**（结构化画像）和 **knowledge**（知识条目，分 user/assistant 两类，各有 100 条上限）。`long_term.py:12-22`。

**晋升触发是容量驱动的**：`add_memory()` 里在写入前先判 `if self.short_term_memory.is_full(): self.updater.process_short_term_to_mid_term()`（`memoryos.py:250-253`）。注意源码注释特意说明"先迁移再写入，避免 deque 自动丢弃造成静默丢数据"。

### 3.3 MemOS：按"物理载体"分层（【源码】）

MemOS 的分层不是按时间，而是按**记忆存在哪儿**，这是五家里最不寻常的：

- `textual`（文本记忆）：`src/memos/memories/textual/`，含 `tree.py`（图数据库里的树）、`general.py`、`naive.py`、`preference.py`。
- `activation`（激活记忆）：`src/memos/memories/activation/{kv,vllmkv}.py` —— 把记忆存成 **KV cache**，`activation_memory_manager.py` 负责把新记忆抽成 KVCacheItem 并 dump 到磁盘。
- `parametric`（参数记忆）：`src/memos/memories/parametric/lora.py` —— 记忆存成 **LoRA 权重**。

一个 `MemCube` 同时持有这几种：`src/memos/mem_cube/general.py:187-236`（`text_mem` / `act_mem` / `para_mem` / `pref_mem` 四个 property）。

文本层的 `memory_type` 枚举（`src/memos/memories/textual/item.py:175-189`）共 10 种，`WorkingMemory` 是默认值：

```
WorkingMemory, LongTermMemory, UserMemory, OuterMemory,
ToolSchemaMemory, ToolTrajectoryMemory, RawFileMemory,
SkillMemory, PreferenceMemory, Context
```

→ **`WorkingMemory` → `LongTermMemory` 是 MemOS 表达"工作区 → 长期"的一对类型标签**。

### 3.4 Graphiti / Zep：按"抽象层级"分层（【源码】）

四层，全部在同一个图里：
- **Episode**（`EpisodicNode`）：原始输入（消息 / 文本 / JSON）。有 `NextEpisodeEdge` 把 episode 串成时间线。
- **Entity**（`EntityNode`）：抽取出的实体。
- **EntityEdge**：实体间的事实边，**带四个时间戳**（见下）。
- **Community**：Leiden 社区 + 社区摘要。

边的时序字段，`graphiti_core/edges.py:263-281`：

```python
expired_at     # 记录被"忘记"的时间
valid_at       # 事实在世界中开始成立的时间
invalid_at     # 事实不再成立的时间
reference_time # 这条边来自哪个 episode 的时间
```

**这是本次调研里最重要的一个设计**：事实失效 = 打 `invalid_at`，**不删行**。历史可回放。

---

## 4. 六问之二：写入判据

### 4.1 mem0：抽取 prompt 就是写入判据，且**明确规定了什么不进**（【源码】）

`mem0/configs/prompts.py:15-62` 的 `FACT_RETRIEVAL_PROMPT` 里有一份 few-shot 清单，其中**两条是纯粹的丢弃示例**：

```
Input: Hi.
Output: {"facts" : []}

Input: There are branches in trees.
Output: {"facts" : []}
```

这直接回答了 ★ 短消息问题的一半：**"Hi." 这种没信息量的输入，在抽取阶段就被映射成空列表，根本不入库**。规则是写死在 prompt few-shot 里的，由 LLM 执行。

该 prompt 同时规定了**记什么**（7 类）：个人偏好、重要个人信息、计划与意图、活动/服务偏好、健康偏好、职业信息、杂项。以及：

- "Create the facts based on the user and assistant messages only. Do not pick anything from the system messages."
- "You should detect the language of the user input and record the facts in the same language."

`ADDITIVE_EXTRACTION_PROMPT`（`prompts.py:468+`）是较新的版本，把写入规则写得更死（我读到的原文）：

```
Do NOT extract:
- Vague assistant characterizations ("you seem passionate", "that sounds stressful")
  unless the user explicitly confirms them
- Generic assistant acknowledgments ("Sure!", "Great question!")
- Assistant meta-commentary about its own capabilities
```

→ **"Sure!" "Great question!" 这类助手侧的短消息，明文排除。** 注意它加了一条重要的非对称规则：**用户的泛指不能记，除非被用户明确确认**（"unless the user explicitly confirms them"）。这是任务要求里问的"有没有『只记验证过的』这种规则"的**一个实例**——但注意它只覆盖"助手对用户的描述"这一类，不是通用规则。

同一 prompt 还规定了两件事：
1. 助手消息**也**要抽取（"You extract from BOTH user and assistant messages"），但要以用户视角改写（`"User was recommended X"`）。
2. 去重参考是"最近抽过的 20 条"（`Recently Extracted Memories`）+ `Existing Memories`。
3. 时间锚点只有一个：`Observation Date`。所有相对时间（"yesterday" / "last week"）强制相对它解析 —— 这防止了"昨天"这种相对时间在长期记忆里腐烂。

**答案质量与检索的接口**：抽取出的新事实要跟"已存在的相关记忆"比对，由一个 LLM 输出四种操作之一（`DEFAULT_UPDATE_MEMORY_PROMPT`，`prompts.py:176+`）：

- `ADD` 新信息
- `UPDATE` 语义相同但信息更多的一方胜出（原文给了 (a)/(b) 两个例子区分"该更新"和"不用更新"）
- `DELETE` **新事实与旧记忆矛盾时删除旧的**
- `NONE` 已有

→ 这是 mem0 版的"矛盾处理"。和 Graphiti 的区别：**mem0 删，Graphiti 打失效戳**。

### 4.2 Letta：写入判据写在工具的 docstring 和 sleeptime prompt 里（【源码】）

`archival_memory_insert` 的 docstring（`letta/functions/function_sets/base.py:164-190`）直接给了 best practices：

```
- Store self-contained facts or summaries, not conversational fragments
- Add descriptive tags to make information easier to find later
- Use for: meeting notes, project updates, conversation summaries, events, reports
- Information stored here persists indefinitely and can be searched semantically
```

→ **"not conversational fragments"** 是 Letta 对短消息的立场：**别把对话碎片写进归档层**。而且要求 `content` 必须 **self-contained**。

sleeptime 智能体的 system prompt（`letta/prompts/system_prompts/sleeptime_v2.py`）把写入判据交给后台智能体，并给了两条具体规则：

1. **时间必须绝对化**："do not write 'today' or 'recently', instead write specific dates and times, because 'today' and 'recently' are relative, and the memory is persisted indefinitely"。
2. **选择性 vs 召回率的显式权衡**："Not every observation warrants a memory edit, be selective in your memory editing, but also aim to have high recall."
3. **跳过编辑的正常出口**："If there are no meaningful updates to make to the memory, you call the finish tool directly."（即允许"这次不记"）

sleeptime 还有 `rethink` 工具：**整个 block 重写**（相对 `core_memory_append` / `core_memory_replace` 的窄编辑）。

### 4.3 MemoryOS：写入无判据，只有"进短队列"（【源码】）

`memoryos.py:236-256` 的 `add_memory()` 是**无条件写入**的：每个 `(user_input, agent_response)` 都进 short-term，没有 LLM 过滤、没有重要性打分。判据发生在**下一层的晋升**里（见第 5 节）。

---

## 5. 六问之三：淘汰判据

### 5.1 MemoryOS：热度公式 + LFU，两个不同机制（【源码】）

**淘汰用 LFU**（`mid_term.py:75-96`）：

```python
def evict_lfu(self):
    lfu_sid = min(self.access_frequency, key=lambda k: self.access_frequency[k])
    self.storage.delete_mid_term_session(lfu_sid)
    ...
    self.rebuild_heap()
```

即：mid-term 满 2000 时，删**被访问次数最少**的 session。注意这是**真删**（`delete_mid_term_session`）。

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

→ `H_segment = 访问次数 + 交互长度 + exp(-Δ小时/24)`。堆是 `heapq.heappush(self.heap, (-H_segment, sid))`（`mid_term.py:173`），用负数实现最大堆。

**热度还驱动晋升**：`memoryos.py:138-155` 里，只要堆顶 session 的热度 ≥ `mid_term_heat_threshold`，就触发 **profile 更新** 和 **knowledge 抽取**（两个并行任务，`task_update_profile` / `task_extract_knowledge`）。

### 5.2 mem0：开源版**没有**遗忘机制（【源码】）

这一条很反直觉，值得单独说。`mem0/memory/main.py:467-483` 里 `update(..., decay=True)` 直接抛错：

```
DECAY_FEATURE_ERROR_MESSAGE = "The decay parameter is not supported by the OSS Memory SDK."
```
（`mem0/memory/notices.py:134`）

mem0 开源版**只有三种退出路径**：

1. LLM 判 `DELETE`（矛盾时）。
2. **显式的 TTL**：`add(..., expiration_date="YYYY-MM-DD")`，`_payload_is_expired()` 在检索时把过期项隐藏（`main.py:427-449`）。是"隐藏"，不是删除。
3. 手动 `delete()`。

→ **decay（时间衰减遗忘）是 mem0 的商业版功能，开源版没有。** 这条我读了源码常量，不是猜测。

### 5.3 Graphiti：不删，只失效（【源码】）

`utils/maintenance/edge_operations.py:538-570` 的 `resolve_edge_contradictions()`：当新事实与旧边矛盾时，

```python
edge.invalid_at = resolved_edge.valid_at
edge.expired_at = edge.expired_at if edge.expired_at is not None else utc_now()
```

→ **旧边保留，只盖上"失效于何时"和"何时被记录为失效"两个戳。**

### 5.4 Letta：淘汰 = 上下文窗口管理，不是数据删除（【源码】）

Letta 的"淘汰"发生在**上下文窗口**这一层，底层消息表不删。具体算法见 6.4。

---

## 6. 六问之四：压缩算法

> 这一节只写我读到实现细节的算法。纯"用 LLM 总结"不写。

### 6.1 Letta 的"部分驱逐 + 递归摘要"（【源码】）

`letta/services/summarizer/summarizer.py:136-243`，方法 `_partial_evict_buffer_summarization`。**这是具体到能复现的算法**：

- 参数 `partial_evict_summarizer_percentage` 默认 **0.30**（`summarizer.py:49`）。
- 按**消息条数**（不是 token 数）算，源码注释明说："Summarization as implemented in the original MemGPT loop, but using message count instead of token count."
- 步骤：
  1. `total_message_count = len(all_in_context_messages)`
  2. `target_message_start = round((1.0 - 0.30) * total_message_count)` → 要保留最后 70%
  3. **从 `target_message_start` 往后找第一条 `assistant` 消息**，作为切点 `assistant_message_index`。找不到就抛错。（原因见第 4 步）
  4. 被摘要的区间是 `all_in_context_messages[1:assistant_message_index]`（index 0 是 system prompt，保留）
  5. 生成摘要消息，**role 设为 `user`**，插到 **index 1**
  6. 新上下文 = `[system, summary_message, ...all_in_context_messages[assistant_message_index:]]`

**为什么必须找 assistant 消息当切点**：摘要消息插在 index 1，那么 index 2 必须是 `assistant`，否则消息角色序列非法（OpenAI 兼容 API 不允许连续 user 或开头就是 assistant）。这是一个非常"落地"的约束，文档里不会写，只有读源码才知道。

- 触发条件：`if not force: return ...` —— **不 force 就不摘要**。
- 摘要的 prompt 文本由 `build_summary_request_text(retain_count, evicted_messages, in_context_messages)` 构造（`summarizer.py:436-457`），我读到的原文：

  > "You're a memory-recall helper for an AI that can only keep the last {retain_count} messages. Scan the conversation history, focusing on messages about to drop out of that window, and write crisp notes that capture any important facts or insights about the human so they aren't lost."

  **注意它把"即将掉出窗口的消息"和"还在窗口内的消息"分开喂给摘要器**，并要求聚焦前者。

### 6.2 Letta 的"中间截断"（middle truncate）（【源码】）

`summarizer.py:387-433` 的 `middle_truncate_text(text, budget_bytes, head_frac=0.3, tail_frac=0.3)`：

- 按 **UTF-8 字节**判预算（"correctly accounts for multi-byte characters"），再按实际 bytes-per-char 换算成字符预算，切片在字符上做（避免切断多字节序列）。
- 保留头部 30% + 尾部 30%，**丢中间**。
- 插入标记：`\n[TRUNCATED: dropped {dropped} middle chars due to context budget]\n`；如果标记本身超预算，**先缩 tail 给标记腾地方**。

→ 这是针对**单个超长工具输出**的压缩，和 6.1 的会话级摘要是两个不同粒度的机制。

### 6.3 MemoryOS 的"页 + 多主题摘要 + 链"（【源码】）

升级到 mid-term 时（`updater.py:107-205`）：

1. short-term 里被挤出的 QA 对逐个变成 **page**（`_process_page_embedding_and_keywords`：算 embedding + 抽关键词）。
2. **连续性检查**：`CONTINUITY_CHECK_SYSTEM_PROMPT = "You are a conversation continuity detector. Return ONLY 'true' or 'false'."`（`prompts.py:209`），配 `_update_linked_pages_meta_info` 把 page 连成 `pre_page`/`next_page` 链。
3. **生成多主题摘要**：`MULTI_SUMMARY_SYSTEM_PROMPT = "You are an expert in analyzing dialogue topics. Generate concise summaries. No more than two topics."`（`prompts.py:73`）→ **一次对话最多压成 2 个主题摘要**，这是个硬上限。
4. 摘要用 `topic_similarity_threshold`（默认 0.5）去匹配已有 session，命中则 `insert_pages_into_session` 并入，否则 `add_session` 新建。
5. 每个 page 还带 `meta_info`（对话链信息），检索回来的 page 会**连着 meta_info 一起**喂给模型（`memoryos.py:271-289`）。

摘要长度硬约束（`prompts.py:69-70`）：

> `SUMMARIZE_DIALOGS_USER_PROMPT = "Please generate an concise topic summary based on the following conversation. Keep it to 2-3 short sentences maximum"`

→ **压缩目标写在 prompt 里是"2-3 句"**，不是"随便总结"。

### 6.4 待补

- RAPTOR 的聚类-摘要树（arXiv 2401.18059）：**待补**
- GraphRAG 的 Leiden 社区摘要（arXiv 2404.16130）：**待补**
- 分词级压缩（LongLLMLingua arXiv 2310.06839 / LLMLingua-2 arXiv 2403.12968 / RECOMP arXiv 2310.04408）：**待补**

---

## 7. 六问之五：检索

### 7.1 mem0：三路融合，且**阈值卡在融合之前**（【源码】）

`mem0/utils/scoring.py:60-140` 的 `score_and_rank()`：

```
combined = (semantic + bm25 + entity_boost) / max_possible
```

- 三个信号：`semantic_score`（向量）、`bm25_score`（`mem0/utils/lemmatization.py` 做词形还原后用 BM25）、`entity_boost`（实体图加成，`ENTITY_BOOST_WEIGHT = 0.5`）。
- 分母自适应：纯语义 `1.0`；+BM25 `2.0`；+BM25+实体 `2.5`；+实体无 BM25 `1.5`。
- **关键细节**（源码注释原文）：

  > "Threshold gates the semantic score BEFORE combining -- candidates below the threshold are excluded even if BM25/entity would boost them."

  代码：`if semantic_score < threshold: continue`

  → **一个向量分很低但关键词精确命中的记忆，会被直接丢掉，BM25 救不回来。** 这对 ★ 短消息问题是**不利**的：短消息"好"对着任何 query 的向量分都低，在 mem0 里**先被 threshold 砍掉**，BM25 和实体加成完全用不上。

- 可选独立 reranker：`RerankerFactory.create(config.reranker.provider, ...)`（`main.py:505-510`）。

### 7.2 Graphiti：三种检索 × 五种重排，自由组合（【源码】）

`graphiti_core/search/search_config.py:32-78`：

```python
EdgeSearchMethod   = cosine_similarity | bm25 | bfs(breadth_first_search)
NodeSearchMethod   = cosine_similarity | bm25 | bfs
EpisodeSearchMethod= bm25
CommunitySearchMethod = cosine_similarity | bm25

EdgeReranker = rrf(reciprocal_rank_fusion) | node_distance | episode_mentions | mmr | cross_encoder
```

**重排器是真实现，不是名字**：
- `rrf` —— 倒数排名融合（`search/search.py:374`）
- `mmr` —— 最大边际相关性，有 `mmr_lambda` 参数（`search.py:375-392`）
- `node_distance` —— 按到中心节点的图距离排
- `episode_mentions` —— 按被多少个 episode 提到排（**这是"成串才有意图"的一种天然实现：被反复提及的事实自动靠前**）
- `cross_encoder` —— 交叉编码器

预设配方（`search/search_config_recipes.py`）：`COMBINED_HYBRID_SEARCH_RRF` / `_MMR` / `_CROSS_ENCODER`，以及单层专用的 `EDGE_HYBRID_SEARCH_*` / `NODE_HYBRID_SEARCH_*` / `COMMUNITY_HYBRID_SEARCH_*`。

`search()` 同时对 edges / nodes / episodes / communities **四类各查一遍**（`search.py:169-243`），返回 `SearchResults` 带各自的 reranker score。

→ **这是"多路检索"的极端形态：不是一路检索多个索引，而是四类对象各有一套 (检索方法, 重排器) 配置。**

### 7.3 Letta：混合检索 + 元数据过滤（【源码】）

`conversation_search` 的 docstring（`base.py:87-160`）："Search prior conversation history using hybrid search (text + semantic similarity)."

参数：`query` / `roles` / `limit` / `start_date` / `end_date`。**`query` 可以为 None** —— 此时退化为纯时间范围 + role 过滤（docstring 里明确给了 "Time-range only search (no query)" 的例子）。

→ 这一点对 ★ 短消息问题有用：**当语义检索不可用时，可以按时间窗把短消息捞回来。**

`archival_memory_search`：纯语义 + tag 过滤（`tag_match_mode: "any" | "all"`）+ 时间窗 + `top_k`（默认 10）。

### 7.4 MemoryOS：多源并发检索 + 固定容量队列（【源码】）

`retriever.py:102-116` 的 `retrieve_context()` 并行跑三个来源：

```python
lambda: self._retrieve_mid_term_context(user_query, segment_similarity_threshold, page_similarity_threshold, top_k_sessions),
lambda: self._retrieve_user_knowledge(user_query, knowledge_threshold, top_k_knowledge),
lambda: self._retrieve_assistant_knowledge(user_query, knowledge_threshold, top_k_knowledge)
```

默认阈值（`retriever.py:104-108`）：`segment_similarity_threshold=0.1`、`page_similarity_threshold=0.1`、`knowledge_threshold=0.01`、`top_k_sessions=5`、`top_k_knowledge=20`。→ **阈值定得极低**（0.01~0.1），靠后面的 top-k 队列截断，而不是靠阈值。

mid-term 是**两级检索**：先按 `summary_keywords` + summary embedding 找 session（`mid_term.py:279-356`），再在 session 内按 page 相似度取页，最后用 size-7 的堆取全局 top-7（`retriever.py:44-68`）。

注意 `retriever.py:52-54` 有一句自认的未决问题：

> "Add session relevance score to page score or combine them? For now, using page_score. Could be: page_score * session_match['session_relevance_score']"

→ **作者自己承认"会话分和页分怎么合"还没定，当前只用页分。** 这是个可以被我们改进的点。

---

## 8. 六问之六：它怎么知道自己记得对不对

### 8.1 Graphiti：每次写入都做一次"重复 / 矛盾"二判（【源码】）

这是本次调研里**唯一一个被实现成常规路径的验证机制**。

- prompt schema（`graphiti_core/prompts/dedupe_edges.py:25-31`）要求 LLM 返回两个列表：

  ```
  duplicate_facts:    List of idx values of duplicate facts (only from EXISTING FACTS range). Empty list if none.
  contradicted_facts: List of idx values of contradicted facts (from full idx range). Empty list if none.
  ```

- prompt 里有反例说明（`dedupe_edges.py:88-96`）：
  - `duplicate_facts=[0], contradicted_facts=[]`（identical factual information）
  - `duplicate_facts=[], contradicted_facts=[1]`（**same relationship but updated title — contradiction, NOT a duplicate**）
  - `duplicate_facts=[], contradicted_facts=[]`（different events on different days — neither）

- prompt 的硬约束："NEVER mark facts with key differences as duplicates, particularly around numeric values, dates, or key qualifiers."（`dedupe_edges.py:53`）
- **两个候选池**：`EXISTING FACTS` 与 `FACT INVALIDATION CANDIDATES`，**idx 连续编号**跨两个池（`dedupe_edges.py:56-58, 73`）。
- **防御性校验**：LLM 返回的 idx 越界会被记 warning 并过滤掉，不会崩（`edge_operations.py:735-742` 与 `760-772`）。

→ 这是"它怎么知道自己记得对不对"的一个**可迁移机制**：把"这条新记忆和已有的哪些冲突"变成一个**可校验的结构化判定**（两个整数列表），而不是让 LLM 自由输出"我更新了记忆"。

### 8.2 mem0：没有独立校验（【源码】）

`DEFAULT_UPDATE_MEMORY_PROMPT` 的输出就是记忆本身（`event` 字段 + 新 `text`），**没有第二道验证**。LLM 说 DELETE 就 DELETE，没有检查被删的那条是否真的和 `old_memory` 一致。

→ 证据：我在 `mem0/configs/prompts.py` 与 `mem0/memory/main.py` 里没有找到任何"校验/回滚/二次确认"逻辑。这是**缺失**，不是"我没找到文档"。

### 8.3 待补

- LongMemEval（arXiv 2410.10813）、LoCoMo（arXiv 2402.17753）、MemoryAgentBench（arXiv 2507.05257）：**评测集能否用来量"记得对不对"——待补**
- Self-RAG（arXiv 2310.11511）、CRAG（arXiv 2401.15884）：**待补**

---

## 9. ★ 短消息怎么办（好 / 继续 / 不对）

> 这是本任务的重点问题。目前找到的**直接证据**如下，其余待补。

### 9.1 已知解法 A：入库前丢弃（【源码】）

- **mem0**：抽取 prompt 的 few-shot 里 `Input: Hi.` → `Output: {"facts" : []}`；`ADDITIVE_EXTRACTION_PROMPT` 明文排除 "Generic assistant acknowledgments ("Sure!", "Great question!")"。`mem0/configs/prompts.py:15-62, 468+`
- **Letta**：`archival_memory_insert` 的 best practices 明文 "Store self-contained facts or summaries, **not conversational fragments**"。`letta/functions/function_sets/base.py:164-190`

→ **两家的立场一致：短消息不进长期记忆层。** 但注意：这解决的是"别污染"，**不解决"那串意图就丢了"**。

### 9.2 已知解法 B：把短消息绑成检索单元（【源码】）

这是"成串才有意图"的正解方向，三家各有实现：

| 系统 | 绑定方式 | 源码位置 |
|---|---|---|
| MemoryOS | short-term 装的是 **QA 对**（`user_input` + `agent_response` 一起），不是单条消息；晋升时成 **page**，page 之间用 `pre_page`/`next_page` 连成**对话链**，检索回来**带 `meta_info`** | `short_term.py:10-16`、`mid_term.py:66-73`、`memoryos.py:271-289` |
| Graphiti | 原始输入是 **Episode**，多个 episode 用 `NextEpisodeEdge` 串成时间线；检索有 **`episode_mentions` 重排器**——被越多 episode 提到越靠前 | `edges.py:822`（`NextEpisodeEdge`）、`search_config.py:57` |
| Letta | 短消息留在 **recall（消息表）**，可以 **`query=None` + `start_date`/`end_date`** 按时间窗捞回来，完全绕开语义检索 | `base.py:87-160` |

→ **三家都得出同一个工程结论：短消息的检索单元不能是短消息本身。** 要么绑成"问答对/页/链"，要么绕开语义检索走时间窗。

### 9.3 一个反例：mem0 的阈值会把短消息**提前砍掉**（【源码】）

`score_and_rank()` 里 `if semantic_score < threshold: continue`，且注释明说 threshold 在融合之前生效。短消息对任何 query 的向量分都低 → **在 mem0 里，短消息即使经由 BM25 或实体图能命中，也永远进不了候选集**。

→ 如果 dsh-steward 想用"成串意图"，**不能照抄 mem0 的 threshold 位置**。

### 9.4 待补（这是本任务价值最高的缺口）

- Anthropic **contextual retrieval**（给每个 chunk 前置一段上下文再嵌入）：官方声称能显著降低检索失败率。**待核实官方文档 URL + 是否适用于"短消息"**
- **Late chunking**（arXiv 2409.04701）：长上下文嵌入模型先编码全文再按 chunk 池化，使 chunk 向量带上全文语境。**待补**
- **会话式查询改写**（query rewriting / history-aware retriever）：LangChain `create_history_aware_retriever`、LlamaIndex `CondenseQuestionChatEngine`。**待补官方文档 URL**
- 对话检索评测（TREC CAsT 之类）里"短发言不自足"是怎么被处理的。**待补**

---

## 10. 对 dsh-steward 的初步建议（基于已证实部分）

1. **不要用 vecmem 存短消息**。它现在 1800 字符/块的分块策略对"好"这种 1~3 字符的输入毫无意义，且 92.7% 已被文档切片占满。
2. **写入前必过抽取**（mem0 模式）：短消息在抽取阶段就不该产出 fact。
3. **要做"成串意图"，绑成页而不是单条**（MemoryOS 模式）：`(用户话, 助手话)` 成对，邻近页用 `pre_page/next_page` 相连，入库的是**页摘要 + 页关键词**，检索命中摘要后**把原页连着链信息一起喂回**。
4. **淘汰优先学 Graphiti 而不是 mem0**：Graphiti 不删行、打 `invalid_at`；mem0 开源版根本没有遗忘。
5. **验证机制抄 Graphiti 的 `resolve_edge`**：把"新记忆与哪条旧记忆重复/矛盾"变成两个 idx 列表 + 越界校验。
6. **检索别把阈值卡在融合前**（mem0 的坑），也别只用页分不用会话分（MemoryOS 自认的未决问题）。

---

## 11. 没找到答案的问题（截至本稿）

1. 没有任何项目的文档或源码，明确处理"**用户连续说 好/好/继续**"这种**多轮肯定**的意图聚合。三家的做法都是"每轮和它前面的助手消息成对"，没有针对"连续多轮同向短回复"的专门机制。
2. **"只记验证过的"这种通用规则，只在 mem0 的 `ADDITIVE_EXTRACTION_PROMPT` 里找到一个受限实例**（"Vague assistant characterizations ... unless the user explicitly confirms them"）。没找到任何一个系统把它作为**全局写入策略**。
3. 没找到任何系统对**"记忆条目的正确性"做过期回检**（即：过一段时间去重新验证一条旧记忆是否还成立）。Graphiti 的 `invalid_at` 只在**新信息到达时**被动触发。

---

## 12. 参考清单（含证据级别）

### 源码（我读过）
- mem0 — https://github.com/mem0ai/mem0 — `mem0/configs/prompts.py`（15-62 `FACT_RETRIEVAL_PROMPT`；176+ `DEFAULT_UPDATE_MEMORY_PROMPT`；468+ `ADDITIVE_EXTRACTION_PROMPT`）、`mem0/utils/scoring.py`（60-140 `score_and_rank`，`ENTITY_BOOST_WEIGHT=0.5`）、`mem0/memory/main.py`（427-449 过期；467-483 decay 抛错；505-510 reranker）、`mem0/memory/notices.py:134`
- Letta — https://github.com/letta-ai/letta （`archive` 分支；`main` 分支已迁移到 https://github.com/letta-ai/letta-code）— `letta/schemas/block.py`（19-40, 117-125）、`letta/constants.py:435`、`letta/services/summarizer/summarizer.py`（49, 136-243, 387-433, 436-457）、`letta/functions/function_sets/base.py`（87-160, 164-190）、`letta/prompts/system_prompts/sleeptime_v2.py`
- Graphiti — https://github.com/getzep/graphiti — `graphiti_core/edges.py`（263-281, 822）、`graphiti_core/search/search_config.py`（32-78）、`graphiti_core/search/search_config_recipes.py`、`graphiti_core/search/search.py`（169-243, 374-392）、`graphiti_core/utils/maintenance/edge_operations.py`（538-570, 733-772）、`graphiti_core/prompts/dedupe_edges.py`（25-31, 43-96）
- MemoryOS — https://github.com/BAI-LAB/MemoryOS — `memoryos-chromadb/short_term.py`（10-16）、`mid_term.py`（21-37, 75-96, 173, 279-356）、`long_term.py`（12-22）、`utils.py`（154-163）、`updater.py`（107-205）、`retriever.py`（44-68, 102-116）、`prompts.py`（69-74, 209）、`memoryos.py`（38-42, 138-155, 236-256, 271-289）
- MemOS — https://github.com/MemTensor/MemOS — `src/memos/memories/textual/item.py`（175-189 十种 memory_type）、`src/memos/memories/textual/tree.py`（39, 103-233）、`src/memos/mem_cube/general.py`（187-236）、`src/memos/mem_scheduler/memory_manage_modules/activation_memory_manager.py`
- Letta 仓库状态异动（2026-09-28 观察）：`main` 分支只剩 README/LICENSE 等 15 个条目，README 明说当前源码在 `letta-ai/letta-code`，V1 Python server 退到 `archive` 分支。

### 论文（arXiv 号与标题已用 `export.arxiv.org/api/query` 核对）
- MemGPT: Towards LLMs as Operating Systems — arXiv 2310.08560
- Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory — arXiv 2504.19413
- Zep: A Temporal Knowledge Graph Architecture for Agent Memory — arXiv 2501.13956
- Memory OS of AI Agent — arXiv 2506.06326
- MemOS: A Memory OS for AI System — arXiv 2507.03724
- A-MEM: Agentic Memory for LLM Agents — arXiv 2502.12110
- Generative Agents: Interactive Simulacra of Human Behavior — arXiv 2304.03442
- RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval — arXiv 2401.18059
- From Local to Global: A Graph RAG Approach to Query-Focused Summarization — arXiv 2404.16130
- LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory — arXiv 2410.10813
- Evaluating Very Long-Term Conversational Memory of LLM Agents（LoCoMo）— arXiv 2402.17753
- Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions（MemoryAgentBench）— arXiv 2507.05257
- On Memory Construction and Retrieval for Personalized Conversational Agents（SeCom）— arXiv 2502.05589
- Recursively Summarizing Enables Long-Term Dialogue Memory in Large Language Models — arXiv 2308.15022
- Walking Down the Memory Maze: Beyond Context Limit through Interactive Reading（MemWalker）— arXiv 2310.05029
- MemoryBank: Enhancing Large Language Models with Long-Term Memory — arXiv 2305.10250
- HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models — arXiv 2405.14831
- From RAG to Memory: Non-Parametric Continual Learning for LLMs（HippoRAG 2）— arXiv 2502.14802
- Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection — arXiv 2310.11511
- Corrective Retrieval Augmented Generation — arXiv 2401.15884
- SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection — arXiv 2303.08896
- Reflexion: Language Agents with Verbal Reinforcement Learning — arXiv 2303.11366
- Sleep-time Compute: Beyond Inference Scaling at Test-time — arXiv 2504.13171
- LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression — arXiv 2310.06839
- LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression — arXiv 2403.12968
- RECOMP: Improving Retrieval-Augmented LMs with Compression and Selective Augmentation — arXiv 2310.04408
- Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models — arXiv 2409.04701

### 已排除（核对时发现的错误引用）
- ~~arXiv 2406.08048 MemoChat~~ — 该号实际是 "3D CBCT Challenge 2024: Improved Cone Beam CT Reconstruction using SwinIR-Based Sinogram and Image Enhancement"，**与 agent 记忆无关，已从参考清单剔除**。
