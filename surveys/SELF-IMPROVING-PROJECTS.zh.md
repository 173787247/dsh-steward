# 开源世界里真实可跑的自我改进 agent 项目

> 调研人：`os-projects-surveyor`（task-5） ｜ 初稿落盘：2026-09-28
> 方法：`gh api` 取元数据 → `raw.githubusercontent.com` 拉真实文件 → 本地读/ grep。
> 落盘在本机 `/tmp/survey/<owner>/<repo>/...`，正文里给的是 **repo 内相对路径 + 行号**。

## 0. 证据分级（这张表决定你能不能信下面每一句话）

| 标记 | 含义 | 你能期待什么 |
|---|---|---|
| **【源码】** | 我下载并实际读了源码文件 | 可给到具体行号级别的机制描述 |
| **【文档】** | 我只读了 README / docs / CHANGELOG / 仓库内自带的分析文档 | 只能复述它自己写的话 |
| **【元数据】** | 我只读了 GitHub API 的 star / 最后提交 / release / issue 数字 | 只能判断死活，不能判断机制 |
| **【无依据】** | 我没找到 | 明确写"没找到"，不猜 |

**没有一条"大概是""应该是"。** 凡我没读到的机制，条目里写「未找到依据」。

---

## 1. 一页速查表

| 项目 | 改哪一层 | 怎么知道改好了 | 失败怎么退 | 活跃度（2026-09-28 观测） | 证据等级 |
|---|---|---|---|---|---|
| [dgm](https://github.com/jennyzzt/dgm) | **自己的代码**（coding agent 全套） | SWE-bench 子集→全量跑分 | 归档不删 + 编译失败即丢 + 噪声容差 | 2.4k★，最后提交 2025-08-13 → **停滞约 13 个月** | 源码 |
| [self_improving_coding_agent](https://github.com/MaximeRobeyns/self_improving_coding_agent) | **自己的代码**（prompts/tools/agents/framework） | benchmark 套件跑分 + 统计比较 | 每代独立目录 + archive 只读挂载 + 换父代 | 404★，最后提交 2025-04-23 → **停滞约 17 个月** | 源码 |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent)（reviewer） | 不改自己；改**被修的仓库** | reviewer 模型打分，卡在 submit 点 | 多次提交取最优 + 预算闸 | 20.4k★，最后提交 2026-07-16，release v1.1.0 | 源码 |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)（harness） | 不是 agent，是**评测基础设施** | FAIL_TO_PASS / PASS_TO_PASS 双向判据 | 不适用（它是判据本身） | 5.9k★，最后提交 2026-09-02 | 源码 |
| [openevolve](https://github.com/algorithmicsuperintelligence/openevolve) | 被演化的**程序代码**（EVOLVE-BLOCK） | 用户 evaluator + 级联评估 | checkpoint + 岛屿存档 | 7.5k★，**今天还有提交和发版** | 源码（配置层） |
| [ShinkaEvolve](https://github.com/SakanaAI/ShinkaEvolve) | **提示词自己**也进进化池 | 每个候选跑 job 拿 fitness | UCB 存档 + novelty judge + 预算上限 | 1.4k★，最后提交 2026-08-21，release v0.0.7 | 源码（prompt_evolver）/ 文档 |
| [AFlow](https://github.com/FoundationAgents/AFlow) | **工作流图（代码）+ 经验库** | 验证集跑 5 次取均值，跟自己上一版比 | 每轮快照 + 失败清单禁重试 | 605★，最后提交 2025-12-25 → **停滞 9 个月** | 源码 |
| [live-swe-agent](https://github.com/OpenAutoCoder/live-swe-agent) | **运行时的自己的能力**（写新工具） | SWE-bench Verified / Pro 跑分 | **未找到依据** | 461★，最后提交 2026-01-19 → 停滞 8 个月 | 文档 + 配置 |
| [babyagi](https://github.com/yoheinakajima/babyagi)（functionz） | **自己的函数库** | 几乎没有验证 | 未找到依据 | 22.4k★（含老版历史），最后提交 2026-01-31 | 源码 + 仓内自带分析 |
| [agent-zero](https://github.com/agent0ai/agent-zero) | 记忆 / 技能 / 提示词片段 | 未找到依据（本轮未读源码） | 未找到依据 | 19.3k★，release v2.13（2026-09-23）→ 活 | 文档 |
| [Voyager](https://github.com/MineDojo/Voyager) | 技能库（代码形式的技能） | Minecraft 任务成功率 | 技能库只存通过的技能 | 7.2k★，最后提交 2024-04-03 → **死 2 年半** | 元数据 |
| [SEAL](https://github.com/Continual-Intelligence/SEAL) | **权重**（self-adapting LLM） | 下游任务分数 | 未读 | 1.9k★，最后提交 2025-08-01 → 停滞 14 个月 | 元数据 |

---

## 2. 逐项目详情

### 2.1 DGM — Darwin Gödel Machine（最直接的"改自己代码"样本）

`https://github.com/jennyzzt/dgm` ｜ 2,380★ ｜ 最后提交 `a565fd2` 2025-08-13 ｜ 无 release ｜ 27 open issues ｜ Apache-2.0

**我读过的文件（【源码】）：**
- `README.md`（全文）
- `DGM_outer.py`（全文 336 行）
- `prompts/self_improvement_prompt.py`（只读了函数/常量结构，未读全文 29KB）
- 仓库文件树（`git/trees/HEAD?recursive=1`）

**① 改什么 —— 自己整个 coding agent 的代码。**
README 原话：*"a novel self-improving system that iteratively modifies its own code (thereby also improving its ability to modify its own codebase) and empirically validates each change using coding benchmarks."* 涉及面是 `coding_agent.py` + `tools/` + `prompts/` 全套。

**② 怎么知道改好了 —— 跑 SWE-bench，两级评估。**
- `DGM_outer.py:268` `test_more_threshold = 0.4`；`DGM_outer.py:192-219` `get_full_eval_threshold()`：从归档里取**第二高分**（`sorted(archive_scores, reverse=True)[1]`）并强制不低于 `0.4`，低于这个门槛的节点不跑全量评测。这是明确的分级评测（便宜的子集先筛，贵的全量后置）。
- `DGM_outer.py:152-165` `filter_compiled()`：代码没编译过、或补丁全空的 run，**直接不进归档**。
- `DGM_outer.py:174-190` `update_archive(method, noise_leeway=0.1)`：`keep_better` 模式下要求 `score >= 初始分 - 0.1` —— **它承认评测有噪声，所以留 0.1 的容差**。默认 `keep_all`。
- 注意：门控实际发生在 `self_improve_step.py`，**我没读那个文件**，所以"`test_more_threshold` 到底怎么被消费"这一步我没有依据。

**③ 失败怎么退 —— 归档（archive）+ 追加式状态日志 + 超时取消。**
- 归档从一开始就是 `['initial']` 这个 commit 列表（`DGM_outer.py:19`），**只追加不删**；父代选择 `score_child_prop`（`DGM_outer.py:91-100`）= 分数 sigmoid × `1/(1+子代数)`，即"好评但没被薅过的版本优先"，天然保住了老版本。
- `DGM_outer.py:324-332`：每代把 `{generation, selfimprove_entries, children, children_compiled, archive}` **append** 到 `dgm_metadata.jsonl`；`initialize_run(prevrun_dir=...)`（`:15-35`）能从上一轮恢复，`start_gen_num = generation + 1`。
- `DGM_outer.py:305`：单次自改进 `future.result(timeout=1.5*60*60)`（1.5 小时），超时 `future.cancel()`；异常只记 log，不中断整个演化（`:310-313`）。
- "回退"在这里不是 revert，而是**不把它放进 archive 就不再被选为父代**。

**④ 它自己承认的坑（【源码】里的自认）：**
- README 顶部 safety warning：*"This repository involves executing untrusted, model-generated code... it may still behave destructively due to limitations in model capability or alignment."* —— 自己承认模型生成代码可能搞破坏。
- `DGM_outer.py:37-48` `any_exceeding_context_length()`：判定"agent 根本没试着修"的依据是**同一个错误串连续出现两次**：
  `if f'{error_str}\n{error_str}' in md_log: return True`，注释写着 *"Repeated error_str means no attempt to fix it"*。这是它承认 agent 会原地打转、假装在干活。
- `prompts/self_improvement_prompt.py` 里有 4 类诊断提示：通用 issue、`diagnose_prompt_emptypatches`（补丁为空 / 只改测试不改源码）、`diagnose_prompt_stochasticity`（一次不对，让它多试几次选最好的）、`diagnose_prompt_contextlength`（上下文超长）。**等于承认失败集中在这四类**。
- README 要求 SWE-bench **checkout 到固定 commit** `dc4c087c2b9e4cefebf2e3d201d27e36` —— 环境漂移会直接毁掉判据，这是它的应对。

**⑤ 我没读的：** `self_improve_step.py`、`utils/evo_utils.py`（`is_compiled_self_improve` 的判定细节）、27 个 open issue 的具体内容（只看了总数）。

---

### 2.2 SICA — Self-Improving Coding Agent（督促控制器的直接前例）

`https://github.com/MaximeRobeyns/self_improving_coding_agent` ｜ 404★ ｜ 最后提交 `ed8275d` 2025-04-23 ｜ 无 release ｜ 3 open issues

**我读过的文件（【源码】）：**
- `README.md`（全文）
- `base_agent/README.md`（读了 247–300 行 + 全文 grep，未逐行读全文 23KB）
- `base_agent/agent_change_log.md`（全文 20 行）
- `base_agent/src/oversight/overseer.py`（**全文 444 行**）
- `runner.py`（读了头部 60 行 + 关键词定位，未逐行读全文 38KB）
- 仓库文件树

**① 改什么 —— 自己代码库，且有明确的"先改哪层"的排序。**
`base_agent/README.md` 原话给出简单度层级：*"The hierarchy of simplicity ... is: prompts > tools > reasoning structures > agents > the framework itself."* 并且明确劝阻在系统层优化上花时间：*"LLM calls dominate this system in terms of cost and latency. Do not spend time working on systems level optimisations (like caching files or tool results) since these are unlikely to yield the benchmark improvements that we want."*

**② 怎么知道改好了 —— 一套 benchmark + 统计比较，而不是单次跑分。**
- `base_agent/src/benchmarks/` 下有一整排：`aime.py` `arc_agi.py` `drop.py` `gpqa.py` `gsm8k.py` `gsm_ic.py` `humaneval.py` `livecodebench.py` `math.py` `refute.py` `swebench_verified.py` `file_editing.py` `symbol_location.py` `aiq_benchmark.py`。
- `runner.py:26-31` 引入 `ArchiveAnalyzer / compute_statistics / ScoreType` —— **它在做统计比较，不是"这次分数高了就算赢"**。
- 每轮产出落到 `results/run_<id>/agent_<i>/benchmarks/<bench>/{results.jsonl, perf.jsonl, traces/}`（README 目录结构）。

**③ 失败怎么退 —— 三个机制叠在一起。**
- `runner.py:777` `shutil.copytree(base_code_dir, next_agent_code_dir)`：**每一代是一个独立代码副本**，旧版本物理上还在 archive 里。
- `runner.py:832` 容器挂载 `-v {exp_dir}:/home/agent/archive:ro` —— **历史版本对 agent 只读**，agent 改不了自己的过去（也改不了别的代）。
- `runner.py:94` 附近注释 *"Select which previous agent iteration to use as the base for improvement"*：下一轮的基准是**从 archive 里重新选**的，所以"退"= 换父代继续，不是原地 revert。
- `base_agent/agent_change_log.md`：一张表，每行 `Iteration | Change Name | Was Successful? (pending/yes/no)`，正文要求第 i 代写**假设/动机**，第 i+1 代补**实测结果**。**注意：仓库里这份日志只有 Iteration 0（Base Agent）一行**，后面全是模板占位 —— 也就是说这套纪律在发布出来的仓库里并没有真的被填满。

**④ 它自己承认的坑（金矿，全部带行号）：**
- ★ `base_agent/README.md:10-12`：*"this code is not hot-loaded or running at this point: in order to test anything (e.g. a new tool), you must invoke a new test instance of the agent on some test task, and inspect its outputs and logs."*
- `base_agent/README.md:146`：*"After running the test agent instance, you should inspect the temporary output directories and test that everything went well. In particular look at the traces in the log directory, and if you ran with the `--debug` flag, the `contexts` directory which will show the system prompt, core prompt and each of the prefills for each of the subagents that ran."*
- `oversight/overseer.py:243-246`（写进监督者提示词的自我认知）：*"The agent may be instructed to work on its own code / It sometimes gets confused, especially when testing tools, about what code is running: **the code it is editing is not the code that is currently running** / If the agent attempts to test one of its own tools by invoking it directly (which is wrong and will fail), then you MUST intervene."*
- `oversight/overseer.py:321-330`：监督者判决解析失败时 `return None`，注释 *"Throw away error for now / TODO: we should log this in the very outer context's event stream."* —— **监督者自己静默失败，没人知道**。
- `oversight/overseer.py:297` `# TODO: properly do constrained tool calling for the overseer judgement` —— 判决靠 XML 正则抠，不是结构化输出。
- README「Things to work on」：*"reduce the variance of self-improvement runs (early features often influence subsequent features)"* —— 自认**早期改动的红利会污染后续比较**（路径依赖）。
- README：*"get the agent to curate / build more of its own benchmarks"* —— 自认 benchmark 还是人给的。

**⑤ 顺带记下它的 runtime 自评机制（第 3 节要用）：**
`overseer.py:42-93` 的 `OverseerJudgement` 字段：`making_progress` / `is_looping` / `currently_running_agent` / `needs_notification(+reasoning)` / `agent_to_notify` / `notification_content` / `notes_for_next_iteration`（**跨轮持久化自己的观察**）/ `next_check_type`(`time`|`events`) / `next_check_delay` / `force_cancel_agent`。
调度是双模式（`overseer.py:401-410`）：按时轮询，或**挂在事件上等 N 个事件**。
它的提示词里写死了几条纪律，直接对应"督促"这件事的边界：
- *"DO NOT jump to negative conclusions too early"*、*"Don't rush the agent too much"*、*"Do not start 'back seat driving'. You can see less than the agent can (your callgraph is missing crucial information from open files and other events the agent can see)"*（`:255`）
- *"YOU MUST make at least one attempt to notify the agent of its wrongdoings before issuing a cancellation command."*（`:237`）
- *"Use these [cancellations] very sparingly ... any new sub-agent will often have to start the task from scratch."*（`:259`）
- 监督者要**换一个模型**（`overseer.py:165-172` 构造参数注释 *"try to use a different model to the main loop model"*，默认 `Model.SONNET_37`）。

---

### 2.3 SWE-agent 的 reviewer —— "督促"的另一种形态：卡在提交点上

`https://github.com/SWE-agent/SWE-agent` ｜ 20,435★ ｜ 最后提交 `3ea751c` 2026-07-16 ｜ release v1.1.0 (2025-05-22) ｜ 126 open issues

**我读过的文件（【源码】）：** `sweagent/agent/reviewer.py`（读了 1–30、200–330、559–700 行）、`tools/review_on_submit_m/README.md`、`tools/review_on_submit_m/config.yaml`。（`config/benchmarks/250522_anthropic_filemap_simple_review.yaml` 我下载了但**没有读**，不作为依据。）

**① 改什么：不改自己。** 它改的是被修的仓库；自我改进的部分是"**提交前的自评-打回**"循环。

**② 怎么知道改好了：另一个模型给这次提交打分。**
- `reviewer.py:1-3` 文件开头就写 *"The reviewer implements a retry loop for the agent to retry solving the issue and to select the best solution."*
- `reviewer.py:157-176` `ReviewerConfig`：`failure_score_penalty`（因成本/退出条件自动提交的，要扣分）、`score_range`。
- `reviewer.py:200-234` `ScoreRetryLoopConfig`：`accept_score`（及格线）、`max_accepts`、`max_attempts`、`min_budget_for_new_attempt`、`cost_limit`。注释说明 `cost_limit` **不包含最后一次 review 的钱**（*"The last review is not included in the cost limit, because we would waste the last attempt if we couldn't score it."*）。
- `reviewer.py:565`：*"This model will not share instance cost with the parent agent"* —— **评审模型与主 agent 分开计费/分离上下文**（和 SICA 的 overseer 换模型是同一个思路）。
- `reviewer.py:604-628` `_review()` / `retry()`：每次提交后打分，`exit_cost` 类退出连续计次；超预算 / 超次数 / 已达标 / 余额不够都直接停。
- `reviewer.py:657-676` `get_best()`：**在多次尝试里选分最高的那一份**提交；同分时取 API 调用最少的（*"If there are multiple submissions with the same score, choose the shortest one"*）。

**③ 失败怎么退：** 没有 revert；用的是"多产几份、挑最好的一份"（`get_best`）+ 预算闸（`cost_limit`/`max_attempts`）。

**④ 它自己承认的坑：**
- 打分靠**正则抠数字**：`reviewer.py:248-258` `interpret()` 取响应最后一行里的数字，失败就 `return []`；`Chooser.interpret()` 失败 `return 0`（`:398-405`）——即**解析失败被当成 0 分**。
- `ReviewerConfig` 里 `type: Literal["reviewer"]` 但 `get_reviewer` 的默认实现细节我未读到（`AbstractReviewer` 是抽象类，`reviewer.py:81-89`），这一层我没读全，不作为结论。
- `tools/review_on_submit_m/README.md`：*"Provides an alternative for `submit` that does not immediately submit, but asks the agent to perform additional reviewing steps. Only `submit -f` will trigger the real submit."* —— 它用"改掉 submit 工具的语义"来实现强制自审。

---

### 2.4 SWE-bench harness —— 不是 agent，是"不变量 + 差分"的参考实现（本报告最该抄的一份）

`https://github.com/SWE-bench/SWE-bench` ｜ 5,928★ ｜ 最后提交 `02e7a74` 2026-09-02 ｜ 无 release ｜ 22 open issues

**我读过的文件（【源码】）：** `swebench/harness/grading.py`（读了 1–110、110–178、228–300 行）。`README.md` 下载了但**没有读**。

**① 判据结构 = 你要的"六不变量"的工业版：**
- `FAIL_TO_PASS`：改动后**必须从失败变通过**（新能力）。
- `PASS_TO_PASS`：改动后**必须保持通过**（不变量/回归）。`grading.py:93-98` `test_maintained()` 的语义注释：*"P2P semantics: a skipped test is not a regression, unlike for F2P."*
- `FAIL_TO_FAIL` / `PASS_TO_FAIL`：额外统计（`grading.py:240-280`）。
- `grading.py:101-110` `test_failed()`：**F2P 的 SKIPPED 算未解决**，注释给了理由：*"without this, a patch that makes every F2P test skip lands in neither list and scores RESOLVED_FULL"*。

**② ★ 它防"假 AGREE"的三道校验（这是差分运行器的血泪清单）：**
1. **"没看见失败" ≠ "通过"**：`grading.py:24-45` 定义 `SUITE_RAN` 正则，且**所有计数都要求非零**（`Executed [1-9]\d* of ...`），注释明说：*"A runner that starts and immediately loses the browser still prints its summary -- karma logs 'Executed 0 of 0' -- and under EvalType.FAIL_ONLY an empty status map scores every F2P test as passing, so a zero count read as evidence turns a suite that never ran into a resolved instance."*
   落到代码：`grading.py:153-160`，`if not status_map and not SUITE_RAN.search(content): return {}, False`。
2. **不信"自报通过"**：`grading.py:164-176`，*"A patch can print its own 'PASSED' lines (e.g. from a conftest.py hook), so cross-check the log against the test command's exit status"* —— 退出码非 0 且状态表里一个 FAILED/ERROR 都没有 ⇒ 这份日志描述的不是真实发生的那次运行 ⇒ 判 invalid。它在日志里另写了 `TEST_EXIT_CODE:` 标记专门做这件事（`grading.py:47-58`）。
3. **解析器的已知数据缺陷要显式记账**：`grading.py:60-77` `_resolve_case()` 容忍 676 个被截断的参数化用例 id（issue #290），仅在候选的 pass/fail 判断一致时才前缀匹配；函数 docstring 自己承认 *"wrong placement — a pytest/Verified-specific data defect encoded in grading, which is meant to be benchmark-agnostic"*，并留了 TODO（修 676 个 id，其中 47 个有歧义）。

**对 dsh-steward 的直接含义：** 差分运行器报 AGREE 之前，必须先能回答"两条线**真的都跑起来了**吗"和"这份结论是**被测程序自己说的**吗"。SWE-bench 把这两条写成了守卫代码，而不是写进文档。

---

### 2.5 openevolve —— 工程化程度最高的演化循环

`https://github.com/algorithmicsuperintelligence/openevolve`（原 `codelion/openevolve`，API 会 301 到新名）｜ 7,452★ ｜ 最后提交 `927299a` **2026-09-28（观测当天）** ｜ release v0.4.0（2026-09-28）｜ 104 open issues

**我读过的文件（【源码，但只到配置/校验层】）：** `openevolve/config.py`（grep 定位）、`openevolve/evaluator.py`（grep 定位 + 关键段）、`README.md`（grep）。检查点/评估循环的**函数体我没有逐行读**，下面凡涉及"实现细节"的都标注了层。

**① 改什么：** 被演化的程序（`EVOLVE-BLOCK` 标记的代码块）；提示词由 `prompt/sampler.py` 从存档里拼装。
**② 怎么知道改好了：** 用户提供的 evaluator。
- `config.py:396-397` `cascade_evaluation: bool = True`，`cascade_thresholds: [0.5, 0.75, 0.9]` —— **级联评估默认开**：分低的候选不进下一级（省评测钱）。
- `evaluator.py:260-302`：超时**不重试**直接返回 `{"error": 0.0, "timeout": True}`；其余异常重试，全失败才记 error。
**③ 失败怎么退：** `config.py:432` `checkpoint_interval: int = 100`；仓库有 `tests/test_checkpoint_resume.py`、`tests/integration/test_checkpoint_with_llm.py`（我只看到文件名，**未读内容**）；`database.py`（115KB，未读）承载岛屿存档；`config.py:379` `similarity_threshold = 0.99` 去重。

**④ 它自己承认的坑（都在代码注释里，不是宣传页）：**
- `config.py:283-286`：`use_meta_prompting: bool = False` 上面写着 `# Note: meta-prompting features not implemented` —— **配置项摆着，功能没实现**。
- `evaluator.py:109-137` `_validate_cascade_configuration()`：如果开了 `cascade_evaluation: true` 但 evaluator 里没有 `evaluate_stage1`，它会警告 *"This will fall back to direct evaluation, making the cascade setting useless."* —— **静默降级**是它自己知道会发生的坑。

---

### 2.6 ShinkaEvolve —— 把"提示词本身"也扔进进化池

`https://github.com/SakanaAI/ShinkaEvolve` ｜ 1,417★ ｜ 最后提交 `9912af1` 2026-08-21 ｜ release v0.0.7（2026-06-02）｜ 7 open issues

**我读过的文件：** `shinka/core/prompt_evolver.py`（【源码】，grep 结构 + 类/方法清单）、`README.md`（【文档】，grep）、`CHANGELOG.md`（【文档】，读前 60 行）、`docs/core_concepts.md`（下载了，**没读**）。

**① 改什么：两层同时改。** 一层是被演化的程序；另一层是**演化用的系统提示词自己**：
`prompt_evolver.py:2-4` *"SystemPromptEvolver and SystemPromptSampler for meta-prompt evolution."*；`:168-174` `SystemPromptEvolver` 的变异算子分两种：`diff`（局部定向修改）和 `full`（整体重写）。`:100-113` `SystemPromptSampler` 用 **UCB + epsilon-greedy** 从 prompt archive 里采样（注释解释 c 大偏探索、c 小偏利用）。
**② 怎么知道改好了：** 每个候选跑一个 job 拿 fitness（本地 / SLURM / Docker / SLURM+Docker 四种执行后端，README）；另有 `novelty_judge.py` / `async_novelty_judge.py`（文件名层面）、`max_patch_resamples: 3`（补丁解析失败就重采样，README 配置表）、`max_api_costs`（总预算帽，超了 async runner 停止提新候选，README）。
**③ 失败怎么退：** UCB 存档本身就是"保留次优解"；`docs/` 有 `bandit_selection.md`、`async_evolution.md`（未读）。**具体的回滚/检查点实现我没读到依据。**

**④ 它自己承认的坑（CHANGELOG 是富矿，全是真实事故修复）：**
- *"Fixed diff insertions (empty SEARCH blocks) splicing the payload directly against the EVOLVE-BLOCK-END marker, **which corrupted the marker line, let consecutive insertions merge code lines into invalid programs, and caused marker validation to reject every insertion patch** for block-comment languages such as Wolfram. Reported in issue #183."*
- *"Removed the automatic Claude Code Review pull-request workflow."*（**把自动 PR 审查关掉了**）
- *"bounded candidate queue drops the newest raw event with a rate-limited warning"*（队列满时**丢事件**）
- *"Fixed Anthropic response parsing to dispatch by content-block type, avoiding crashes and truncated output for redacted, thinking-only, and multi-block responses"*（解析脆弱性）

---

### 2.7 AFlow —— "经验沉淀"最直白，也最露怯

`https://github.com/FoundationAgents/AFlow` ｜ 605★ ｜ 最后提交 `3f45721` 2025-12-25 ｜ 无 release ｜ 6 open issues ｜ ICLR 2025 Oral

**我读过的文件（【源码】）：** `scripts/optimizer_utils/experience_utils.py`（**全文**）、`scripts/optimizer.py`（grep 结构）、`README.md`（下载，未细读）。

**① 改什么：** 用代码表示的 agentic workflow 图（`workspace/<dataset>/workflows/round_N/{graph.py,prompt.py}`）；**外加一份可复用的经验库**（`processed_experience.json`）。
**② 怎么知道改好了：** `optimizer.py:43-45` `initial_round / max_rounds=20 / validation_rounds=5` —— 每个候选图在验证集上**跑 5 次取平均分**，`update_experience` 里 `succeed = bool(avg_score > before)`（与自己父节点比）；`optimizer.py:108` 用 `check_convergence(top_k=3)` 判收敛。
**③ 失败怎么退：** 每轮一个 `round_N` 目录 = 天然快照；失败进 `experience["failure"]`，下一轮被渲染成禁令。
**④ ★ 我读源码时**发现的具体缺陷（**不是它承认的，是我读出来的**）：`experience_utils.py:61-77` `format_experience()` —— success 分支和 failure 分支打印的是**同一句 "Absolutely prohibit"**，而且 success 那条还丢掉了分数：

```python
for key, value in experience_data["failure"].items():
    experience += f"-Absolutely prohibit {value['modification']} (Score: {value['score']})\n"
for key, value in experience_data["success"].items():
    experience += f"-Absolutely prohibit {value['modification']} \n"      # ← 成功经验也被写成"绝对禁止"
```
再叠加 `experience_utils.py:79-92` `check_modification()`：**成功和失败的修改一律 `return False`**（试过的不能再试）。两处合起来，等于把"曾经成功过的改法"也拉黑。这是我能在 6 行内给出证据的 bug。

---

### 2.8 live-swe-agent —— "运行时自进化"，但实现面很薄

`https://github.com/OpenAutoCoder/live-swe-agent` ｜ 461★ ｜ 最后提交 `8d7dd86` 2026-01-19 ｜ release v1.0.0（2025-11-17）｜ 8 open issues

**我读过的文件：** `README.md`（【文档】，读了大半）、`config/livesweagent.yaml`（【源码】，读了前 80 行）。

**① 改什么：** 运行时的自身能力。README：*"the first live, runtime self-evolving software engineering agent that expands and revises its own capabilities on the fly"*，关键洞察 *"software agents are themselves software systems"*。
**但它薄**：*"We built Live-SWE-agent on top of ... mini-swe-agent framework with **very minimal modifications**. To use Live-SWE-agent, simply install mini-swe-agent first ... and use the custom Live-SWE-agent config"* —— **整个仓库的可见产物主体是一份 YAML 配置**（仓库文件树只有 `README.md` + `config/` 四件）。也就是说"自进化"的载体是 agent 在 bash 里自己造工具/改文件，而不是仓库里有一套演化引擎。
**② 怎么知道改好了：** SWE-bench Verified / Pro 跑分（README：Opus 4.5 79.2%、Gemini 3 Pro 77.4%、SWE-Bench Pro 45.8%），v1.0.0 release 附完整 trajectories/patches。
**③ 失败怎么退：未找到依据。** 我读的 config 里没有 checkpoint/rollback。
**④ 它自己承认的坑：** 配置里写死 *"Failure to follow these rules will cause your response to be rejected."*；*"Directory or environment variable changes are not persistent. Every action is executed in a new subshell."*；README 教程链接是空的（`[this guide]()`）—— 上手路径断了。

---

### 2.9 babyagi / functionz —— 反面教材价值最高

`https://github.com/yoheinakajima/babyagi` ｜ 22,365★（含老 BabyAGI 历史）｜ 最后提交 `fa8930e` 2026-01-31 ｜ 无 release ｜ 30 open issues

**我读过的文件（【源码】+【文档】）：** `README.md`（grep 关键段）、`CODE_READINESS_ANALYSIS.md`（读了前 80 行）、`babyagi/functionz/packs/drafts/self_build.py`（前 60 行）、`babyagi/functionz/core/execution.py`（30–60、110–130 行）。

**① 改什么：** 自己的函数库。functionz 把函数存进 DB，agent 生成新函数再注册回去（`packs/drafts/self_build.py`）。
**② 怎么知道改好了：基本没有。** 仓库自带的分析文档给 **Testing 0/10**（该文档日期 2026-01，"Verdict: **NOT PRODUCTION READY**"，总分 3/10）。
**③ 失败怎么退：** 我看到函数有 `function_version` 与 `log_id` 的历史记录，但**没读到回滚机制**，不作为结论。
**④ 它自己承认的坑：**
- README:6-7 原文：*"This is a framework built by Yohei who has never held a job as a developer. The purpose of this repo is to share ideas and spark discussion... **Not meant for production use**. Use with cautioun."*（原文含拼写错误）
- README:4：**老版 BabyAGI 已归档**到 `babyagi_archive`（2024-09 快照）。
- README:247：draft 功能 *"are experimental concepts and **may not function as intended**"*。
- `CODE_READINESS_ANALYSIS.md`：点名 `execution.py:44,122` 用 `exec()` 执行 DB 里的代码、无沙箱 → RCE；SQL 注入；加密 key 打进日志。★ **我核对了 `execution.py`**：第 44 行附近 `exec(dep_data['code'], local_scope)`、第 122 行附近 `exec(function_version['code'], local_scope)` **确实存在**，分析文档没有冤枉它。

**对 dsh-steward 的含义：** "agent 写代码存进 DB 再执行"这条路上，**没有沙箱 + 没有验证 + 没有回滚**会同时出现；babyagi 是这三缺的活样本。

---

### 2.10 agent-zero —— 多 agent 自我组织（本轮**只读了文档**）

`https://github.com/agent0ai/agent-zero`（原 `frdel/agent-zero`）｜ 19,326★ ｜ 最后提交 `e3051fb` 2026-09-23 ｜ release v2.13（2026-09-23）｜ 139 open issues

**我读过的文件（【文档】）：** `README.md`（grep + 标题）。
**明确声明：本轮我没有读它的源码**（一次 tree 查询被会话重启打断），所以下面只有 README 说了什么：
- *"Every agent can create subordinate agents to break down work. The superior gives tasks and receives reports; subagents keep their own contexts focused and return their findings when done."*（README:236）→ agent 自己拉 agent。
- 记忆/技能/项目隔离：*"Keep files, instructions, secrets, memories, repositories, and model-preset choices isolated per project."*（README:36）
- 路线图式自认缺口：*"Memory systems - alternative memory backends, intelligent consolidation strategies, vector recall plugins."*（README:174，列在"想做的/欢迎贡献"里）
**② 验证 / ③ 回退：未找到依据（本轮未读源码）。**

---

### 2.11 Voyager（死项目，但"技能库"这个概念的开创样本）——【元数据】only

`https://github.com/MineDojo/Voyager` ｜ 7,231★ ｜ **最后提交 2024-04-03**（死 2 年半）｜ 7 open issues ｜ JavaScript
我**只读了 GitHub API 元数据**，没读 README、没读源码。写在这里只是为了说明"技能库/经验沉淀"这条线的历史节点，**不提供任何机制结论**。

### 2.12 SEAL（改权重）——【元数据】only

`https://github.com/Continual-Intelligence/SEAL` ｜ 1,863★ ｜ 最后提交 2025-08-01 ｜ 4 open issues
同样**只读了元数据**。它代表"改权重"这一层（self-adapting LLM），但 dsh-steward 的场景（单机、DeepSeek Harness、要能回退）里权重层不可行 —— 这句是判断，不是它说的。

---

## 3. 专题：**哪些真的在改自己的代码**（tier 3），它们怎么防跑飞

### 3.1 分层（只按"我读到证据"分）

| 层级 | 项目 | 证据 |
|---|---|---|
| **tier 3：改自己的代码/能力** | DGM、SICA、live-swe-agent | DGM_outer.py 全文；SICA runner.py:777/832 + base_agent/README.md:10-12；live-swe-agent README + config |
| **tier 2：改提示词/工作流（不改自己的实现）** | ShinkaEvolve（system prompt 进 archive）、AFlow（workflow 图 + 经验库）、openevolve（被演化程序） | prompt_evolver.py 类清单；experience_utils.py 全文；config.py:396 |
| **tier 1：改自己的函数库（有执行无验证）** | babyagi/functionz | execution.py:44,122 + CODE_READINESS_ANALYSIS.md |
| **不是 tier 3** | SWE-agent reviewer（改被修仓库）、SWE-bench（评测基础设施） | reviewer.py:559-700；grading.py 全文段 |

### 3.2 防跑飞的机制清单（每条带出处）

1. **沙箱/容器隔离** —— DGM README 要求 Docker（`docker run hello-world` 自检）；SICA README：*"IMPORTANT NOTE: always run the agent in the provided Docker container. Since the agent can execute shell commands, this offers some isolation from your host machine, avoiding inadvertent file system manipulation and similar risks."*；**babyagi 是这条的反面样本**（`exec()` 无沙箱）。
2. **单次时限** —— `DGM_outer.py:305` `future.result(timeout=1.5*60*60)` + `future.cancel()`。
3. **自改范围限定（改哪、不能改哪）** —— SICA：新版本由 `shutil.copytree` 生成到 `archive/agent_<i>/agent_code`（`runner.py:777`），历史 archive **只读挂载**（`runner.py:832` `:/home/agent/archive:ro`）。DGM：改的是 agent 代码库自身（`coding_agent.py`+`tools/`+`prompts/`）。
4. **归档可追溯 + 不删** —— DGM：`archive` 列表 + 每代 append `dgm_metadata.jsonl`（`DGM_outer.py:324-332`），父代按 `score_child_prop` 选（`:91-100`）；SICA：每代独立目录 + `agent_change_log.md`（表格含 `Was Successful? pending/yes/no`）。
5. **准入过滤（改坏的别进来）** —— DGM：`filter_compiled()` 丢编译失败/全空补丁（`:152-165`）；`update_archive(keep_better, noise_leeway=0.1)` 给评测噪声留 0.1 容差（`:174-190`）。
6. **预算闸** —— SWE-agent `cost_limit`/`max_attempts`/`max_accepts`/`min_budget_for_new_attempt`（reviewer.py:616-655）；ShinkaEvolve `max_api_costs`（README 配置表）。
7. **级联评测（贵的只在便宜的先过之后才跑）** —— DGM `get_full_eval_threshold()` 取归档第二高分且 ≥0.4（`:192-219`）；openevolve `cascade_thresholds: [0.5,0.75,0.9]`（config.py:396-397）。

### 3.3 ★ 你问的那个 quote 属于哪一类

> *"this code is not hot-loaded or running at this point: in order to test anything (e.g. a new tool), you must invoke a new test instance of the agent on some test task, and inspect its outputs and logs."* —— `base_agent/README.md:10-12`

它属于 **第 8 类：「进程外验证 + 冷启动」**，是上面 7 条里我唯一没在别处看到的、而且**恰好补上"一个进程无法监督自己的缺席"**的那一条：

- **被改的代码不参与本轮运行。** 改完不热加载 —— 正在跑的进程永远跑的是旧代码，所以它**没有能力自证新代码对错**。
- **新版本必须新起一个实例**，在一个**真实任务**上跑（不是单元测试；`base_agent/README.md:252-254` 明确说 *"It is better to write end-to-end tests rather than unit tests with complicated mocking"*）。
- **然后由外部读 logs/traces 下判断**（`:146`：临时输出目录 + log 目录里的 traces，`--debug` 时还有 `contexts/` 目录能看到每个 subagent 的 system prompt / core prompt / prefill）。

**它和 SICA 自己的 overseer 是两个不同的环，不能合并：**
- `overseer.py` 是**运行时**监督：看 callgraph 判"这轮有没有跑歪"，它**不判断"改完的代码对不对"**（它连新代码都没在跑）。
- `base_agent/README.md:10-12` + `:146` 是**版本级**验证：新代码必须冷启动重跑，由外部（人或 benchmark）看日志。
SICA 把版本级这一步**留给了人**（README 的主语是 "you must / you should inspect"）；能自动化的部分它放在了 benchmark 套件 + `compute_statistics` 里。**这正是 dsh-steward 要把"人"替换掉的那一格。**

顺带一条同源证据：SICA 把这件事的失败模式写进了 overseer 的提示词（`overseer.py:243-246`）：*"It sometimes gets confused, especially when testing tools, about what code is running: the code it is editing is not the code that is currently running... you MUST intervene."* —— **"我改的代码不是正在跑的代码"这个坑，它用监控者的嘴说出来，而不是用文档。**

### 3.4 一个反面对照：谁没有回滚

- **DGM**：归档 + 追加日志 = 可回到任意历史 commit 继续演化（恢复点明确）。
- **SICA**：每代独立目录 + 只读 archive = 旧版本永远在（"回退"= 换父代）。
- **SWE-agent**：无 revert，用 `get_best()` 在多份提交里挑最好的（"退" = 不选它）。
- **babyagi**：**无沙箱、无验证、无回滚**三者同时缺（`CODE_READINESS_ANALYSIS.md` + `execution.py:44,122`）。
- **live-swe-agent / agent-zero / Voyager / SEAL**：**我没找到回滚机制的依据**，不写。

---

## 4. 专题：对照 dsh-steward 的三件事

### 4.1 五层目标队列 ← 别人怎么做"找下一个目标"

- **DGM 是"按失败类型排队"的最干净样本**（`prompts/self_improvement_prompt.py` 的常量结构 + `DGM_outer.py:112-148`）：每代先按**失败类别**决定这次要改进什么 —— `solve_empty_patches`（10% 以上是空补丁时，25% 概率）、`solve_stochasticity`（25% 概率）、`solve_contextlength`（检测到同一错误重复且 25% 概率），否则从**未解决实例**里随机挑一个。**这就是 L2「已知缺口」的机器版**，而且它是从评测日志里自动抠出来的，不是人手写 backlog。
- **AFlow 是"经验库驱赶下一轮"**：失败的修改被渲染进下一轮提示词（`experience_utils.py:61-77`），但如 2.7 所述，它的 success/failure 渲染有 bug。
- **SICA 是"人给方向 + 简单度排序"**：`base_agent/README.md:262-300` 给的不是目标队列，而是**取舍准则**（prompts > tools > reasoning structures > agents > framework；先问"能不能提高 benchmark/降时间/降成本"）。

### 4.2 督促控制器 ← SICA 的 overseer 是最接近的实现

对照表（全部来自 `oversight/overseer.py`）：

| dsh-steward 的要素 | SICA overseer 的对应物 | 差异/可借鉴点 |
|---|---|---|
| 另一个 agent 读工作日志判断 | 读 **callgraph 执行树**（`generate_overseer_execution_tree`，`:207`），不是读日志文件 | 它看结构化事件流，不看文本日志 |
| 输出"下一句推动" | `notification_content` 注入到目标 agent 的事件流（`:374-392`，`EventType.OVERSEER_NOTIFICATION`） | 通知是**注入上下文**，不是重写任务 |
| 判"偷懒还是真完成" | `making_progress` / `is_looping` 两个布尔（`:44-50`） | 二值判断，无证据链 |
| 跨轮记忆 | `notes_for_next_iteration` → `self._previous_notes`（`:369-372`），并在下次提示里回填 | **一次只留一段 note** |
| 调度 | `next_check_type=time|events` + `next_check_delay`（5–500s，`:402-410`） | 让监督者自己决定下次什么时候看 |
| 终极手段 | `force_cancel_agent` + 必须先通知一次（`:237`） | 取消的代价它自己写明："新 sub-agent 要从零开始" |
| 独立性 | **换一个模型**（`:165-172`） | 与主循环模型解耦 |

它承认的两个弱点值得 dsh-steward 直接规避：判决解析失败会**静默 `return None`**（`:321-330`，且 TODO 自认没记进事件流）；以及"看得比 agent 少"（提示词 `:255` 自认 "*You can see less than the agent can*"）—— 所以它的纪律是"别急着下负面结论"。

### 4.3 六不变量 + 差分运行器 ← SWE-bench 的守卫清单（直接可抄）

1. 双向判据：新增行为必须由失败转通过（F2P），原有行为必须保持通过（P2P）—— `grading.py:236-247`。
2. 跳过 ≠ 通过：F2P 被 skip 算未解决（`grading.py:101-110`）；P2P 被 skip 不算回归（`:93-98`）。
3. **"跑起来了"必须单独取证**：状态表为空且没有 `SUITE_RAN` 证据 ⇒ 判 invalid，**不是**全过（`grading.py:153-160` + `:24-45`）。
4. **不信被测方的自报**：日志里出现 PASSED 但**测试命令退出码非 0 且无任何 FAILED/ERROR** ⇒ 判 invalid（`grading.py:164-176`）。
5. 解析器的已知缺陷要**显式记账并留 TODO**，不能让它悄悄影响判分（`grading.py:60-77`）。
6. 计数为 0 的边界要有专门处理：`compute_fail_to_pass` 里 `if total == 0: return 1`（`grading.py:288-295`）—— **★ 这一条恰恰是"空集合默认算赢"的隐患写法**，与我们第 3 条要防的东西方向相反。抄它的时候要警惕：分母为 0 时返回 1 是"没有 F2P 用例 ⇒ 满分"，而"没有跑起来"和"没有用例"在日志里长得一样（这正是 `SUITE_RAN` 存在的原因）。

---

## 5. 它们自己承认的坑（汇总，按"最有用"排序）

| # | 项目 | 原话/位置 | 为什么有用 |
|---|---|---|---|
| 1 | SICA | `base_agent/README.md:10-12`：代码不热加载，必须新起实例跑真实任务再看日志 | 自我修改的自证不可能性 |
| 2 | SICA | `overseer.py:245`：*"the code it is editing is not the code that is currently running"* | 同一个坑的第二处证据（写进监督者提示词） |
| 3 | SWE-bench | `grading.py:29-31`：空状态表 + FAIL_ONLY ⇒ 每个 F2P 都算通过 ⇒ "没跑过的套件变成已解决" | 假 AGREE 的经典成因 |
| 4 | SWE-bench | `grading.py:164-176`：补丁可以自己打印 "PASSED"（conftest hook），必须用退出码交叉校验 | 不能信被测方自报 |
| 5 | DGM | `DGM_outer.py:44-47`：同一错误串连续出现两次 ⇒ 判定"根本没试着修" | "假装在干活"的检测器 |
| 6 | DGM | README safety warning：模型生成的代码可能破坏性地运行 | 自改代码的物理风险 |
| 7 | SICA | README「Things to work on」：早期改动会污染后续比较，导致方差大 | 自改循环的路径依赖 |
| 8 | SICA | `overseer.py:326-330`：监督者判决解析失败被静默丢弃 | 监督者自己会瞎 |
| 9 | babyagi | README:6-7 + `CODE_READINESS_ANALYSIS.md`：作者自认非开发者、Not meant for production、测试 0/10、exec 无沙箱 | "自建函数库"这条路的三缺样本 |
| 10 | AFlow | （我读出来的）`experience_utils.py:64` success 分支也写 "Absolutely prohibit" + `check_modification` 一律拉黑 | 经验库会反噬成功经验 |
| 11 | openevolve | `config.py:284`：meta-prompting 没实现；`evaluator.py:124-127`：级联配置不当会静默退化成直接评估 | 配置项存在 ≠ 功能存在 |
| 12 | ShinkaEvolve | CHANGELOG：EVOLVE-BLOCK 标记被腐蚀、连续插入把代码行拼坏、Wolfram 全量拒绝；"Removed the automatic Claude Code Review" | 文本级改代码的脆弱性 + 自动审查被关掉 |
| 13 | SWE-agent | reviewer 的打分靠正则抠最后一个数字，解析失败给 0 分 / 返回全部索引 | 评审器的解析就是薄弱点 |
| 14 | live-swe-agent | 配置里"违反格式就拒绝响应"；文档链接是空的 | 上手路径本身有断点 |

---

## 6. 我没找到答案的问题（诚实清单）

1. **DGM 的门控到底怎么消费 `test_more_threshold` / `full_eval_threshold`** —— 逻辑在 `self_improve_step.py`，我没读。
2. **openevolve 的 checkpoint 到底存了什么、能不能真恢复** —— 我只看到 `config.py:432 checkpoint_interval=100` 和测试文件名，没读 `database.py`（115KB）与 `tests/test_checkpoint_resume.py`。
3. **ShinkaEvolve 的失败回退** —— 我只读到 UCB 采样与预算帽，没读到检查点/回滚实现。
4. **live-swe-agent 的"运行时自进化"具体怎么落地** —— 我只读了 README + config 前 80 行；没读 mini-swe-agent 侧代码，所以"它到底怎么改自己"我没有依据。
5. **agent-zero 的验证与回退** —— 本轮没读它的源码（会话被重启打断），只有 README。
6. **有没有项目在做"两条线并行跑、比对 AGREE/DIVERGE"** —— **我没找到**。SWE-bench 是"对照 gold patch 的判据"，不是"两条独立运行线互相比对"；差分运行器这个具体形态，在这批项目里我没有找到先例。
7. **"six invariants"级别的显式不变量清单** —— 除了 SWE-bench 的 F2P/P2P 二元结构，我没在任何项目里找到"写成代码的、带编号的不变量清单"。
8. **open issue 里"它根本不动"的具体条数** —— 我只有总数（DGM 27 / openevolve 104 / agent-zero 139 / SWE-agent 126 / babyagi 30），**没有逐条读 issue**，所以无法回答"其中几个是彻底跑不起来"。

## 7. 排除清单（及理由）

- **纯论文 / 无下载产物**：AlphaEvolve（只有 paper）、所有只有 arXiv 链接的项目。
- **纯 prompt 模板**：Cline/Roo 的 "Memory Bank" 之类（无可执行物）。
- **宣传稿式框架**：README 只有 GIF 和 logo、仓库无可运行入口的，一律不写。
- **我读了但判定"不该算自我改进 agent"的**：SWE-agent reviewer（改的是被修仓库）、SWE-bench（评测基础设施）—— 但它们作为**机制参考**保留在报告里，并已就地标注。
- **只读元数据、不提供机制结论的**：Voyager、SEAL（在 2.11/2.12 明确标注）。
- **易踩空提示**：`letta-ai/letta` 的默认分支现在**只有文档**（根目录 10 个条目，全是 `.md`/license），README 自己写明源码已迁到 `letta-ai/letta-code`。要找 Letta 的实现别在这条分支上找。（依据：`gh api repos/letta-ai/letta/contents/` 列表 + `letta-ai/letta/README.md`。）
