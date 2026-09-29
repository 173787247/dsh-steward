# 开源世界里真实可跑的自我改进 agent 项目

> 调研人：`os-projects-surveyor`（task-5）｜ 观测时间：**2026-09-28**（所有 star / 提交 / issue 数字都是这一天的快照）
> 方法：`gh api` 取元数据 → `raw.githubusercontent.com` 拉真实文件 → 本地读 + grep。
> 下载物在 `/tmp/survey/<owner>/<repo>/…`；正文给的是 **repo 内相对路径 + 行号**。

## 0. 证据分级（这张表决定你能信下面每一句话）

| 标记 | 含义 | 你能期待什么 |
|---|---|---|
| **【源码】** | 我下载并实际读了源码文件（含行号级引用） | 机制描述可以引用到具体行 |
| **【源码·结构】** | 我只 grep 了类/函数/常量结构，没逐行读函数体 | 只能说"它有这么个东西"，不能说它怎么实现 |
| **【文档】** | 我只读了 README / docs / CHANGELOG / 仓内自带分析 | 只能复述它自己写的话 |
| **【元数据】** | 只有 GitHub API 的 star / 提交 / release / issue 数字 | 只能判断死活 |
| **【无依据】** | 我没找到 | 明确写"没找到"，不猜 |

**计量口径提醒：** GitHub 的 `open_issues_count` **包含 PR**。下表的 "open issue" 是我用 search API 重算的**不含 PR** 的值（`is:issue is:open`），PR 数单列。

---

## 1. 一页速查表

| 项目 | 改哪一层 | 怎么知道改好了 | 失败怎么退 | 活性（2026-09-28） | 证据 |
|---|---|---|---|---|---|
| [dgm](https://github.com/jennyzzt/dgm) | **自己的代码**（coding agent 全套） | SWE-bench 两级评测（子集→全集） | 归档不删 + 补丁链重放 + 编译不过即丢 | 2,380★，最后提交 2025-08-13 → **停滞 13 个月**；issue 21 / PR 6 | 源码 |
| [self_improving_coding_agent](https://github.com/MaximeRobeyns/self_improving_coding_agent) | **自己的代码**（prompts/tools/agents/framework） | benchmark 套件 + **置信区间下界**选版本 | 每代独立目录 + archive 只读挂载 | 404★，最后提交 2025-04-23 → **停滞 17 个月**；issue 2 / PR 1 | 源码 |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent)（reviewer） | 不改自己；改**被修的仓库** | 另一个模型给提交打分，卡在 submit 点 | 多份提交里挑最好 + 预算闸 | 20,435★，最后提交 2026-07-16，release v1.1.0；issue 49 / PR 77 | 源码 |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)（harness） | 不是 agent，是**评测基础设施** | FAIL_TO_PASS / PASS_TO_PASS 双向判据 + 三道防伪 | 不适用（它就是判据） | 5,928★，最后提交 2026-09-02；issue 12 / PR 10 | 源码 |
| [openevolve](https://github.com/algorithmicsuperintelligence/openevolve) | 被演化的**程序代码**（EVOLVE-BLOCK） | 用户 evaluator + 级联评估 | checkpoint 存档/恢复（有测试） | 7,452★，**观测当天还有提交和发版**；issue 61 / PR 43 | 源码 |
| [ShinkaEvolve](https://github.com/SakanaAI/ShinkaEvolve) | 程序 + **提示词自己也进化** | 每候选跑 job 拿 fitness | UCB 存档 + novelty judge + 预算帽 | 1,417★，最后提交 2026-08-21，release v0.0.7；**issue 0 / PR 7** | 源码·结构 + 文档 |
| [AFlow](https://github.com/FoundationAgents/AFlow) | **工作流图（代码）+ 经验库** | 验证集跑 5 次取均值，跟自己上一版比 | 每轮快照 + 失败清单禁重试 | 605★，最后提交 2025-12-25 → **停滞 9 个月**；issue 5 / PR 1 | 源码 |
| [live-swe-agent](https://github.com/OpenAutoCoder/live-swe-agent) | **运行时自己写工具**（提示词驱动） | SWE-bench Verified / Pro 跑分 | **无依据** | 461★，最后提交 2026-01-19 → 停滞 8 个月；issue 7 / PR 1 | 文档 + 配置 |
| [babyagi](https://github.com/yoheinakajima/babyagi)（functionz） | **自己的函数库** | 基本没有（仓内自评 Testing 0/10） | **无依据** | 22,365★（含老版历史），最后提交 2026-01-31；issue 18 / PR 12 | 源码 + 文档 |
| [agent-zero](https://github.com/agent0ai/agent-zero) | 记忆 / **技能库** / 提示词片段 | **无依据** | 提示词设置快照-还原（局部） | 19,326★，最后提交 & release **2026-09-23** → 活；issue 64 / PR 77 | 源码 |
| [Voyager](https://github.com/MineDojo/Voyager) | 技能库（可执行代码形式的技能） | 环境反馈 + 执行错误 + 自验证 | 技能只存验证通过的 | 7,231★，最后提交 **2024-04-03** → **死 2 年半**；issue 0 / PR 7 | 文档 |
| [SEAL](https://github.com/Continual-Intelligence/SEAL) | **权重**（RL 生成 self-edit） | 下游任务分数 | 未读 | 1,863★，最后提交 2025-08-01 → 停滞 14 个月；issue 2 / PR 2 | 文档 |

---

## 2. 逐项目详情

### 2.1 DGM — Darwin Gödel Machine（"改自己代码"最完整的公开样本）

`https://github.com/jennyzzt/dgm` ｜ 2,380★ ｜ 最后提交 `a565fd2` 2025-08-13 ｜ 无 release ｜ issue 21 / PR 6 ｜ Apache-2.0

**我读过的文件：**
- 【源码】`README.md`（全文）、`DGM_outer.py`（**全文 336 行**）、`self_improve_step.py`（读了 138–180、285–360 行，并全文 grep）
- 【源码·结构】`prompts/self_improvement_prompt.py`（只读常量/函数结构，未读 29KB 全文）
- 下载未读：`coding_agent.py`、`utils/evo_utils.py`

**① 改什么 —— 自己整个 coding agent 的代码。**
README：*"a novel self-improving system that iteratively modifies its own code (thereby also improving its ability to modify its own codebase) and empirically validates each change using coding benchmarks."*

**② 怎么知道改好了 —— SWE-bench，两级门控（我这次读到了门控本体）。**
- `self_improve_step.py:153-155`：先在小子集上跑评测，然后
  `overall_performance.get('total_resolved_instances', 0) >= len(test_task_list) * test_more_threshold`
  成立才继续跑更大的集合。`test_more_threshold = 0.4` 在 `DGM_outer.py:268` 给定。
- `DGM_outer.py:192-219` `get_full_eval_threshold()`：从归档里取**第二高分**（`sorted(archive_scores, reverse=True)[1]`）并强制 ≥ 0.4，作为"够格跑全量评测"的门槛 —— 换成 `--no_full_eval` 就关掉。
- `DGM_outer.py:152-165` `filter_compiled()`：**编译不过、或补丁全空的 run 直接不进归档**（`is_compiled_self_improve`，该函数在未读的 `utils/evo_utils.py`）。
- `DGM_outer.py:174-190` `update_archive(..., noise_leeway=0.1)`：`keep_better` 模式要求 `score >= 初始分 - 0.1` —— **它给评测噪声留了 0.1 的容差**（默认是 `keep_all`，全收）。

**③ 失败怎么退 —— 归档 + 补丁链重放 + 追加式状态日志 + 两层超时。**
- 归档是 `['initial']` 这个 commit 列表（`DGM_outer.py:19`），**只追加不删**。父代选择 `score_child_prop`（`DGM_outer.py:91-100`）= 分数 sigmoid × `1/(1+子代数)`：好评但没被薅过的版本优先，天然保住老版本。
- **版本怎么重建**：每次自改进都开一个**新容器**，把父代归档里的 patch 全部 `patch -p1` 重放（`self_improve_step.py:293-302`），然后 `git add --all` + `git commit`（`:303-305`），再把 git 输出里的 hash 抠出来（`:307-309`）当 `--base_commit` 交给 harness（`:353`）。即 **版本 = 初始镜像 + 归档补丁链**。
- 状态日志：每代 append 到 `dgm_metadata.jsonl`（`DGM_outer.py:324-332`）；`initialize_run(prevrun_dir=...)`（`:15-35`）从上一轮恢复，`start_gen_num = generation + 1`。
- **两层超时**：容器内 `timeout 1800`（30 分钟，`self_improve_step.py:348`，注释原文 `# 30min timeout`）；外层 `future.result(timeout=1.5*60*60)` + `future.cancel()`（`DGM_outer.py:305-309`）。异常只记 log，不中断整个演化（`:310-313`）。
- "退"在这里不是 revert，是**不放进 archive 就不再被选为父代**。

**④ 它自己承认的坑（全部带出处）：**
- README safety warning：*"This repository involves executing untrusted, model-generated code... it may still behave destructively due to limitations in model capability or alignment."*
- `DGM_outer.py:37-48` `any_exceeding_context_length()`：判定"agent 根本没试着修"的依据是**同一个错误串连续出现两次** —— `if f'{error_str}\n{error_str}' in md_log: return True`，注释写着 *"Repeated error_str means no attempt to fix it"*。**这是"假装在干活"的检测器。**
- `prompts/self_improvement_prompt.py` 里 4 类诊断提示：通用 issue、`diagnose_prompt_emptypatches`（补丁为空 / 只改测试不改源码）、`diagnose_prompt_stochasticity`（一次不对就多试几次选最好）、`diagnose_prompt_contextlength`（上下文超长）。**等于承认失败就集中在这四类。**
- `self_improve_step.py:307-308` 的注释：`# Git commit output format: '[master (root-commit) <hash>] a nonsense commit message'` —— 它靠**解析 git 的人类可读输出**拿 commit hash（`commit_output.split()[1].strip("[]")`）。
- ★ **我在源码里 grep `exit_code`，`self_improve_step.py` 全文零命中**：父代补丁 `patch -p1` 应用后只 `log_container_output(exec_result)`（`:296-298`），**不判断成败**；`git add`/`git commit` 同样只看日志。也就是说补丁链断裂时会继续往下跑（这一点我是从代码读出来的，不是它承认的）。
- README 要求 SWE-bench **checkout 到固定 commit** `dc4c087c2b9e4cefebf2e3d201d27e36` —— 环境漂移会毁掉判据，这是它的应对。

**⑤ 我对了它的 issue：既有真 bug，也基本没人管。**
最新 5 条非 PR issue（我读了标题）：
- **#31（2026-06-12）*"best parent-selection mode is unreachable from CLI and selects lowest scores when called"*** → ★ **我在源码中核对属实**：`DGM_outer.py:103-104` 用 `sorted(...)` **升序**后取**前 N 个**（取到的是最低分）；同文件 `:228` 的 `choices=['random','score_prop','score_child_prop' 'best']` 少了逗号，Python 隐式拼接成 `'score_child_propbest'`，**`'best'` 从 CLI 根本选不到**。issue 提交者的说法与代码完全一致。
- **#35（2026-07-28）*"Harness agent can access hidden Polyglot tests and reference solutions"*** → 基准污染，评测可信度问题；0 评论，未修。
- **#36（2026-08-04）** `load_all_tools` 用 `importlib` 盲目导入 `tools/*.py`，**没有来源校验** → 自改 agent 的工具加载面。
- #33（Polyglot loader 缺文件）、#34（每轮重复发 tool schema 不走 cache_control，成本问题）。
→ 21 个 open issue 中，最新 5 条里 4 条 **0 评论**；最后提交已经是 13 个月前。**结论：这个仓库现在是"存档"状态，不是在维护。**

---

### 2.2 SICA — Self-Improving Coding Agent（督促控制器的直接前例）

`https://github.com/MaximeRobeyns/self_improving_coding_agent` ｜ 404★ ｜ 最后提交 `ed8275d` 2025-04-23 ｜ 无 release ｜ issue 2 / PR 1

**我读过的文件：**
- 【源码】`README.md`（全文）、`base_agent/agent_change_log.md`（全文 20 行）、`base_agent/src/oversight/overseer.py`（**全文 444 行**）、`runner.py`（读了 1–60、88–165、196–232 行 + 全文 grep）
- 【源码·结构】`base_agent/README.md`（全文 grep + 读了 247–300 行）
- 下载未读：`base_agent/src/benchmarks/base.py`、`.../implementations/review_committee_member.py`、`archive_explorer.py`、`main_orchestrator.py`

**① 改什么 —— 自己代码库，而且明确规定了"先改哪层"。**
`base_agent/README.md:262-276`：*"The hierarchy of simplicity ... is: prompts > tools > reasoning structures > agents > the framework itself."* 并明确劝阻在系统层优化上花时间：*"LLM calls dominate this system in terms of cost and latency. Do not spend time working on systems level optimisations (like caching files or tool results) since these are unlikely to yield the benchmark improvements that we want."*

**② ★ 怎么知道改好了 —— 用置信区间下界选版本（这批项目里最讲究的一处）。**
`runner.py:88-150` `select_base_agent()`：
1. `compute_statistics(scores_df, summaries_df, score_type=score_type)` 算出**每个迭代的统计量，含置信区间**；
2. 找 `target_score` 最大的那个迭代，取它的 **`ci_lower`（置信下界）**；
3. **从当前迭代往回扫到 0**（`runner.py:126` `for i in range(current_iteration, -1, -1)`），返回第一个 `mean >= best_lower_bound` 的迭代（`:133-135`）；
4. 扫过最优迭代还没找到就用最优那个；出异常退回 iteration 0（`:140-150`）。

即 **"在噪声带内挑最新的那个版本"**：不追点估计的最高分，而是取"和最好的版本统计上分不出差别"的更晚版本。配合的 benchmark 面很宽（`base_agent/src/benchmarks/` 下有 `aime / arc_agi / drop / gpqa / gsm8k / gsm_ic / humaneval / livecodebench / math / refute / swebench_verified / file_editing / symbol_location`）。
每轮产物落到 `results/run_<id>/agent_<i>/benchmarks/<bench>/{results.jsonl, perf.jsonl, traces/}`。

**③ 失败怎么退 —— 独立副本 + 只读归档 + 换父代。**
- `runner.py:777` `shutil.copytree(base_code_dir, next_agent_code_dir)`：**每代是独立代码副本**，旧版本物理上还在。
- `runner.py:832` 容器挂载 `-v {exp_dir}:/home/agent/archive:ro` —— **历史对 agent 只读**（改不了自己的过去）。
- `runner.py:94` 起 `select_base_agent` 的注释 *"Select which previous agent iteration to use as the base for improvement."* → "退" = 换父代。
- `runner.py:207-215` `metadata.json` 记 `git_commit`（`git rev-parse HEAD`）、`python_version`、`executable`。
- `agent_change_log.md`：表头 `Iteration | Change Name | Was Successful? (pending/yes/no)`，要求第 i 代写假设、第 i+1 代补实测。**注意：仓库里这份日志只有 Iteration 0 一行**，其余是模板占位 —— 纪律写下来了，发布出来的仓库里**没真的填**。

**④ 它自己承认的坑（金矿，全部带行号）：**
- ★ `base_agent/README.md:10-12`：*"this code is not hot-loaded or running at this point: in order to test anything (e.g. a new tool), you must invoke a new test instance of the agent on some test task, and inspect its outputs and logs."*
- `base_agent/README.md:146`：*"After running the test agent instance, you should inspect the temporary output directories and test that everything went well. In particular look at the traces in the log directory, and if you ran with the `--debug` flag, the `contexts` directory which will show the system prompt, core prompt and each of the prefills for each of the subagents that ran."*
- `base_agent/README.md:252-254`：*"It is better to write end-to-end tests rather than unit tests with complicated mocking."*
- `oversight/overseer.py:243-246`（写进监督者提示词的自我认知）：*"The agent may be instructed to work on its own code / It sometimes gets confused, especially when testing tools, about what code is running: **the code it is editing is not the code that is currently running** / If the agent attempts to test one of its own tools by invoking it directly (which is wrong and will fail), then you MUST intervene."*
- `oversight/overseer.py:321-330`：监督者判决解析失败时 `return None`，注释 *"Throw away error for now / TODO: we should log this in the very outer context's event stream."* → **监督者自己静默失败。**
- `oversight/overseer.py:297`：`# TODO: properly do constrained tool calling for the overseer judgement` → 判决靠 XML 抠取，不是结构化输出。
- README「Things to work on」：*"reduce the variance of self-improvement runs (early features often influence subsequent features)"* → **自认早期改动的红利会污染后续比较**（路径依赖）；还有 *"get the agent to curate / build more of its own benchmarks"*（benchmark 还是人给的）。

**⑤ 它的运行时自评机制（第 3 节要用）：**
`overseer.py:42-93` `OverseerJudgement` 字段：`making_progress` / `is_looping` / `currently_running_agent` / `needs_notification(+reasoning)` / `agent_to_notify` / `notification_content` / `notes_for_next_iteration`（**跨轮持久化自己的观察**）/ `next_check_type`(`time`|`events`) / `next_check_delay` / `force_cancel_agent`。
- 调度双模式（`:401-410`）：按时轮询，或**挂在事件上等 N 个事件**（`:186-195`）。
- 通知是**注入目标 agent 的事件流**（`:374-392`，`EventType.OVERSEER_NOTIFICATION`），不是改写任务。
- 换模型：构造参数注释 *"try to use a different model to the main loop model"*（`:165-172`），默认 `Model.SONNET_37`。
- 提示词里写死的纪律：*"DO NOT jump to negative conclusions too early"*、*"Don't rush the agent too much"*、*"Do not start 'back seat driving'. You can see less than the agent can (your callgraph is missing crucial information from open files...)"*（`:255`）、*"YOU MUST make at least one attempt to notify the agent of its wrongdoings before issuing a cancellation command."*（`:237`）、*"any new sub-agent will often have to start the task from scratch"*（`:259`，取消的代价）。

---

### 2.3 SWE-agent 的 reviewer —— "督促"的另一种形态：卡在提交点上

`https://github.com/SWE-agent/SWE-agent` ｜ 20,435★ ｜ 最后提交 `3ea751c` 2026-07-16 ｜ release v1.1.0（2025-05-22）｜ issue 49 / PR 77

**我读过的文件：** 【源码】`sweagent/agent/reviewer.py`（读了 1–30、200–330、559–700 行）、`tools/review_on_submit_m/README.md`、`tools/review_on_submit_m/config.yaml`。（`config/benchmarks/250522_anthropic_filemap_simple_review.yaml` 我下载了但**没读**，不作依据。）

**① 改什么：不改自己。** 改的是被修的仓库；自我监督部分是"提交前自评 → 打回重做"。
**② 怎么知道改好了：另一个模型给这次提交打分。**
- `reviewer.py:1-3`：*"The reviewer implements a retry loop for the agent to retry solving the issue and to select the best solution."*
- `reviewer.py:157-176` `ReviewerConfig`：`failure_score_penalty`（因成本/退出条件自动提交要扣分）、`score_range`。
- `reviewer.py:200-234` `ScoreRetryLoopConfig`：`accept_score`（及格线）、`max_accepts`、`max_attempts`、`min_budget_for_new_attempt`、`cost_limit`。注释说明 `cost_limit` **不含最后一次 review**：*"The last review is not included in the cost limit, because we would waste the last attempt if we couldn't score it."*
- `reviewer.py:565`：*"This model will not share instance cost with the parent agent"* → **评审模型与主 agent 分离计费/上下文**（与 SICA 换模型同思路）。
- `reviewer.py:604-655` `_review()/retry()`：超预算 / 超次数 / 已达标 / 余额不足 都直接停。
- `reviewer.py:657-676` `get_best()`：**在多次尝试里选分最高的提交**，同分取 API 调用最少的：*"If there are multiple submissions with the same score, choose the shortest one"*。
**③ 失败怎么退：** 无 revert；"多产几份、挑最好一份"（`get_best`）+ 预算闸。
**④ 它自己承认的坑：**
- 打分靠**正则抠数字**：`reviewer.py:248-258` `Preselector.interpret()` 取响应最后一行数字，失败返回 `[]`；`Chooser.interpret()`（`:299-305`）取最后一个数字，失败 `return 0` → **解析失败 = 0 分**。
- `Preselector.choose()` 无索引时 *"No indices found in response, using all indices"*（`:287-288`）→ 退化成全选。
- `tools/review_on_submit_m/README.md`：*"Provides an alternative for `submit` that does not immediately submit, but asks the agent to perform additional reviewing steps. Only `submit -f` will trigger the real submit."* → 用**改 submit 工具语义**来强制自审。

---

### 2.4 SWE-bench harness —— 不是 agent，是"不变量 + 差分"的参考实现（本报告最该抄的一份）

`https://github.com/SWE-bench/SWE-bench` ｜ 5,928★ ｜ 最后提交 `02e7a74` 2026-09-02 ｜ 无 release ｜ issue 12 / PR 10

**我读过的文件：** 【源码】`swebench/harness/grading.py`（读了 1–110、110–178、228–300 行）。`README.md` 下载了但**没读**。

**① 判据结构 = "不变量"的工业版：**
- `FAIL_TO_PASS`：改动后**必须从失败变通过**（新能力）；`PASS_TO_PASS`：改动后**必须保持通过**（不变量/回归）。
- `grading.py:93-98` `test_maintained()`：*"P2P semantics: a skipped test is not a regression, unlike for F2P."*
- `grading.py:101-110` `test_failed()`：**F2P 的 SKIPPED 算未解决** —— 注释给了理由：*"without this, a patch that makes every F2P test skip lands in neither list and scores RESOLVED_FULL"*。
- `grading.py:240-280`：另有 `FAIL_TO_FAIL` / `PASS_TO_FAIL` 两类"额外统计"。

**② ★ 防"假 AGREE"的三道守卫（差分运行器的血泪清单）：**
1. **"没看见失败" ≠ "通过"**：`grading.py:24-45` 定义 `SUITE_RAN`，**所有计数都要求非零**（`Executed [1-9]\d* of ...`）。注释原文：*"A runner that starts and immediately loses the browser still prints its summary -- karma logs 'Executed 0 of 0' -- and under EvalType.FAIL_ONLY an empty status map scores every F2P test as passing, so a zero count read as evidence turns a suite that never ran into a resolved instance."* 落到代码：`grading.py:153-160` `if not status_map and not SUITE_RAN.search(content): return {}, False`。
2. **不信被测方的自报**：`grading.py:164-176`，*"A patch can print its own 'PASSED' lines (e.g. from a conftest.py hook), so cross-check the log against the test command's exit status"* —— 退出码非 0 且状态表里没有任何 FAILED/ERROR ⇒ 日志描述的不是真实那次运行 ⇒ 判 invalid。为此 eval 脚本专门写 `TEST_EXIT_CODE:` 标记（`:47-58`）。
3. **解析器的已知缺陷要显式记账**：`grading.py:60-77` `_resolve_case()` 容忍 676 个被截断的参数化用例 id（issue #290），仅当候选的 pass/fail 判断一致时才前缀匹配；docstring 自认 *"wrong placement — a pytest/Verified-specific data defect encoded in grading, which is meant to be benchmark-agnostic"*，并留 TODO（676 个 id，其中 47 个有歧义）。

**③ ★ 一处要警惕的反例：** `grading.py:288-295` `compute_fail_to_pass()` 里 `if total == 0: return 1` —— **分母为 0 时返回满分**。它的前提是"没有 F2P 用例"，但"没有用例"和"没跑起来"在日志里长得一样（这正是 `SUITE_RAN` 存在的理由）。dsh-steward 抄判据结构时，这一条要反过来写。

---

### 2.5 openevolve —— 工程化程度最高的演化循环（今天还在动）

`https://github.com/algorithmicsuperintelligence/openevolve`（原 `codelion/openevolve`，API 会 301 到新名）｜ 7,452★ ｜ 最后提交 `927299a` **2026-09-28（观测当天）** ｜ release v0.4.0（2026-09-28）｜ issue 61 / PR 43

**我读过的文件：** 【源码·结构】`openevolve/config.py`、`openevolve/evaluator.py`、`openevolve/database.py`（grep 定位）、`tests/test_checkpoint_resume.py`（读测试名与断言行）；`README.md`（grep）。**这些文件的函数体我没有逐行读**，所以下面凡涉及"实现细节"都标了层。

**① 改什么：** 被演化的程序（`EVOLVE-BLOCK` 标记的代码块）；提示词由 `prompt/sampler.py` 从存档里拼。
**② 怎么知道改好了：** 用户提供的 evaluator。
- `config.py:396-397`：`cascade_evaluation: bool = True`、`cascade_thresholds: [0.5, 0.75, 0.9]` —— **级联评估默认开**（分低的候选不进下一级）。
- `evaluator.py:260-302`：超时**不重试**，直接返回 `{"error": 0.0, "timeout": True}`；其余异常重试，全失败才记 error。
**③ 失败怎么退：存档/恢复是有一等公民实现的（这点比 DGM 明确）。**
- `config.py:432` `checkpoint_interval: int = 100`
- `database.py:724` `save(path, iteration)`、`:776` `load(path)`、`:846` `_reconstruct_islands(saved_islands)`、`:940` `_save_program(...)`、`:2696` `_cleanup_old_artifacts(checkpoint_path)`
- `tests/test_checkpoint_resume.py`：有专门测试，例如 `test_checkpoint_resume_skips_initial_program` 断言恢复后 `database.last_iteration == 10` 且**不重复评测初始程序**（`mock_evaluator.call_count == 0`）；另有 `test_fresh_start_adds_initial_program`、`test_duplicate_content_prevention`、`test_multiple_run_calls_no_pollution`。
- `config.py:379` `similarity_threshold = 0.99`（去重）；`novelty_judge.py`（文件名层面，未读）。

**④ 它自己承认的坑（在代码注释里，不在宣传页）：**
- `config.py:283-286`：`use_meta_prompting: bool = False` 上方写着 `# Note: meta-prompting features not implemented` —— **配置项摆着，功能没实现**。
- `evaluator.py:109-137` `_validate_cascade_configuration()`：开了 `cascade_evaluation: true` 但 evaluator 没定义 `evaluate_stage1` 时警告 *"This will fall back to direct evaluation, making the cascade setting useless."* → **静默降级是它自己知道会发生的坑**。
- 最新 issue（我读了标题）里有一条安全报告 **#481**：*"evaluator `exec_module` operator-supplied code in-process; `visualizer` serves checkpoint data with no auth"* —— 评测器**在进程内**执行 operator 提供的代码。（我只读了标题，未读正文。）
- 最新 4 条非 PR issue 是"订阅 token 用法 / evaluator 传参问法 / 与 Google AlphaEvolve 互操作"，**没有一条是"它跑不起来"** → 61 个 open issue 不是失修的信号，而是活跃项目的正常积压。

---

### 2.6 ShinkaEvolve —— 把"提示词本身"也扔进进化池

`https://github.com/SakanaAI/ShinkaEvolve` ｜ 1,417★ ｜ 最后提交 `9912af1` 2026-08-21 ｜ release v0.0.7（2026-06-02）｜ **issue 0 / PR 7**（7 个 open 全是 PR）

**我读过的文件：** 【源码·结构】`shinka/core/prompt_evolver.py`（grep 类/方法/docstring）、【文档】`README.md`（grep）、`CHANGELOG.md`（读前 60 行）。`docs/core_concepts.md` 下载了**没读**。

**① 改什么：两层同时改。** 一层是被演化的程序，另一层是**演化用的系统提示词自己**：
- `prompt_evolver.py:2-4`：*"SystemPromptEvolver and SystemPromptSampler for meta-prompt evolution."*
- `:168-174` `SystemPromptEvolver` 的变异算子分 `diff`（定向局部改）与 `full`（整体重写）。
- `:100-113` `SystemPromptSampler`：**UCB + epsilon-greedy** 从 prompt archive 采样（docstring 解释：c 大偏探索，c 小偏利用），另有 `get_best_prompt()` / `get_archive()`。

**② 怎么知道改好了：** 每个候选跑一个 job 拿 fitness（README：本地 / SLURM / Docker / SLURM+Docker 四种执行后端）；`novelty_judge.py` / `async_novelty_judge.py`（文件名层面）；`max_patch_resamples: 3`（补丁解析失败就重采样）；`max_api_costs`（总预算帽，超了 async runner 停止提新候选）。`docs/` 有 `bandit_selection.md`、`async_evolution.md`（**未读**）。
**③ 失败怎么退：** UCB 存档本身保留次优解；**具体的检查点/回滚实现我没读到依据。**

**④ 它自己承认的坑（CHANGELOG 是富矿，全是真实事故）：**
- *"Fixed diff insertions (empty SEARCH blocks) splicing the payload directly against the EVOLVE-BLOCK-END marker, **which corrupted the marker line, let consecutive insertions merge code lines into invalid programs, and caused marker validation to reject every insertion patch** for block-comment languages such as Wolfram. Reported in issue #183."*
- *"Removed the automatic Claude Code Review pull-request workflow."*（**把自动 PR 审查关掉了**）
- *"bounded candidate queue drops the newest raw event with a rate-limited warning"*（队列满时**丢事件**）
- *"Fixed Anthropic response parsing to dispatch by content-block type, avoiding crashes and truncated output for redacted, thinking-only, and multi-block responses"*（解析脆弱性）

---

### 2.7 AFlow —— "经验沉淀"最直白，也最露怯

`https://github.com/FoundationAgents/AFlow` ｜ 605★ ｜ 最后提交 `3f45721` 2025-12-25 ｜ 无 release ｜ issue 5 / PR 1 ｜ ICLR 2025 Oral

**我读过的文件：** 【源码】`scripts/optimizer_utils/experience_utils.py`（**全文**）、`scripts/optimizer.py`（grep 结构）、【文档】`README.md`（下载未细读）。

**① 改什么：** 用代码表示的 agentic workflow 图（`workspace/<dataset>/workflows/round_N/{graph.py,prompt.py}`）+ **一份可复用的经验库** `processed_experience.json`。
**② 怎么知道改好了：** `optimizer.py:43-45` `initial_round / max_rounds=20 / validation_rounds=5` —— 候选图在验证集上**跑 5 次取均值**；`update_experience` 里 `succeed = bool(avg_score > before)`（跟自己的父节点比）；`optimizer.py:108` 用 `check_convergence(top_k=3)` 判收敛。
**③ 失败怎么退：** 每轮一个 `round_N` 目录 = 天然快照；失败进 `experience["failure"]`，下一轮被渲染成禁令。
**④ ★ 我读源码时**发现的具体缺陷（**不是它承认的，是我读出来的**）：`experience_utils.py:55-67` `format_experience()` —— success 分支和 failure 分支打印**同一句 "Absolutely prohibit"**，且 success 那条丢了分数：

```python
for key, value in experience_data["failure"].items():
    experience += f"-Absolutely prohibit {value['modification']} (Score: {value['score']})\n"
for key, value in experience_data["success"].items():
    experience += f"-Absolutely prohibit {value['modification']} \n"      # ← 成功经验也写成"绝对禁止"
```
再叠加 `experience_utils.py:69-80` `check_modification()`：**成功和失败的修改一律 `return False`**（试过的不能再试）。两处合起来 = 把"曾经成功过的改法"也拉黑，**经验库会反噬成功经验**。

---

### 2.8 live-swe-agent —— "运行时自进化"，但载体是提示词 + 一份 YAML

`https://github.com/OpenAutoCoder/live-swe-agent` ｜ 461★ ｜ 最后提交 `8d7dd86` 2026-01-19 ｜ release v1.0.0（2025-11-17）｜ issue 7 / PR 1

**我读过的文件：** 【文档】`README.md`（读了大半）、【源码】`config/livesweagent.yaml`（**全文 196 行**，读了前 80 行 + 全文 grep 关键词）。

**① 改什么：** 运行时的自身能力 —— 但**实现载体是提示词**：
- `config/livesweagent.yaml:105-137` 有整整一节 **"## Creating your own tools"**：*"You can also create your own tools in Python to help with your workflow... You should at least create a simple edit tool that can help you effectively edit arbitrary files instead of using bash commands"*，并给出 `cat <<'EOF' > /path/to/tool_name.py` 的写法示例。
- `:148`：*"Reflect on the previous trajectories and decide if there are any tools you can create to help you with the current task."* → **反思步骤也写在提示词里**。
- 仓库文件树只有 `README.md` + `config/`（4 个文件）—— 所以 README 说的 *"We built Live-SWE-agent on top of ... mini-swe-agent framework with **very minimal modifications**... simply install mini-swe-agent first ... and use the custom Live-SWE-agent config"* 是实话：**这个仓库自己几乎不含引擎**，"自进化"发生在 agent 的 bash 会话里（造工具→用工具→工具留在工作目录）。
**② 怎么知道改好了：** SWE-bench Verified / Pro 跑分（README 新闻：Opus 4.5 79.2%、Gemini 3 Pro 77.4%、SWE-Bench Pro 45.8%）；v1.0.0 release 附完整 trajectories/patches。
**③ 失败怎么退：未找到依据。** 我读的 config 里没有 checkpoint / rollback。
**④ 它自己承认的坑：** 配置里写死 *"Failure to follow these rules will cause your response to be rejected."*；*"Directory or environment variable changes are not persistent. Every action is executed in a new subshell."*；README 的上手指南链接是**空的**（`[this guide]()`）—— 路径断了。（底座 `SWE-agent/mini-swe-agent`：31 issue / 50 PR，**我没读它的代码**。）

---

### 2.9 babyagi / functionz —— 反面教材价值最高

`https://github.com/yoheinakajima/babyagi` ｜ 22,365★（含老 BabyAGI 历史）｜ 最后提交 `fa8930e` 2026-01-31 ｜ 无 release ｜ issue 18 / PR 12

**我读过的文件：** 【源码】`babyagi/functionz/core/execution.py`（读了 30–60、110–130 行）、`babyagi/functionz/packs/drafts/self_build.py`（前 60 行）、【文档】`README.md`（grep 关键段）、`CODE_READINESS_ANALYSIS.md`（前 80 行）。

**① 改什么：** 自己的函数库（functionz 把函数存进 DB，agent 生成新函数再注册回去）。
**② 怎么知道改好了：基本没有。** 仓内自带分析文档给 **Testing 0/10**（该文档日期 2026-01，verdict：**NOT PRODUCTION READY**，总分 3/10）。
**③ 失败怎么退：** 我看到函数有 `function_version` 与 `log_id` 的历史记录，但**没读到回滚机制**，不作结论。
**④ 它自己承认的坑：**
- README:4：**老版 BabyAGI 已归档**到 `babyagi_archive`（2024-09 快照）。
- README:6-7：*"This is a framework built by Yohei who has never held a job as a developer. The purpose of this repo is to share ideas and spark discussion... **Not meant for production use**. Use with cautioun."*（原文含拼写错误）
- README:247：draft 功能 *"are experimental concepts and **may not function as intended**"*。
- `CODE_READINESS_ANALYSIS.md`：点名 `execution.py:44,122` 用 `exec()` 执行 DB 里的代码、无沙箱 → RCE；还有 SQL 注入、加密 key 打进日志。
  ★ **我核对了 `execution.py`**：第 **44** 行 `exec(dep_data['code'], local_scope)`、第 **122** 行 `exec(function_version['code'], local_scope)` **确实存在**（grep 出来的精确行号），分析文档没冤枉它。

**对 dsh-steward 的含义：** "agent 写代码 → 存进 DB → 执行"这条路上，**没有沙箱 + 没有验证 + 没有回滚**会同时出现；babyagi 是三缺的活样本。

---

### 2.10 agent-zero —— 技能库 + 提示词分段（这次补读了源码）

`https://github.com/agent0ai/agent-zero`（原 `frdel/agent-zero`）｜ 19,326★ ｜ 最后提交 `e3051fb` **2026-09-23** ｜ release v2.13（2026-09-23）｜ issue 64 / PR 77

**我读过的文件：** 【源码】`extensions/python/message_loop_prompts_after/_63_recall_relevant_skills.py`（全文，1.5KB）、`extensions/python/_functions/agent/Agent/prepare_prompt/start/_99_snapshot_settings.py`（全文，328B）、仓库文件树；【文档】`README.md`（grep + 标题）。

**① 改什么（源码级证据）：技能库的召回与提示词注入。**
- `_63_recall_relevant_skills.py`（全文 45 行）：**只在 `loop_data.iteration == 0`**（`:8`，每轮对话开头）触发；用本轮用户指令去 `skills_helper.search_skills(user_instruction, limit=6, agent=self.agent)` 做语义检索（`:23-25`）；命中后把 `名字: 描述`（描述截 220 字）拼进 `agent.system.skills.relevant.md` 模板，塞到 `loop_data.extras_temporary["relevant_skills"]`（`:42-45`）。→ 这是"**经验沉淀 → 检索 → 复用**"在一个成熟产品里的落地形态：**技能不是塞满上下文，而是按需召回前 6 条**。
- `_99_snapshot_settings.py:8-11`（全文 11 行）：在 `prepare_prompt/start` 阶段调用 `settings.begin_prompt_settings_snapshot()` 打快照（配套 `prepare_prompt/end/_00_restore_settings.py` 还原）→ **让提示词装配期间对设置的修改被限制在一次提示词构建内**，不外溢。这是本报告里唯一见到的"**作用域化变更**"机制。
**② 验证 / ③ 回退：未找到依据**（我没读它的评测与自改路径）。
**④ 它自己承认的坑：** README:174 把 *"Memory systems - alternative memory backends, intelligent consolidation strategies, vector recall plugins"* 列在"欢迎贡献"里（= 现状不够）；README:236 *"Every agent can create subordinate agents to break down work. The superior gives tasks and receives reports; subagents keep their own contexts focused and return their findings when done."*（agent 自己拉 agent）。
**⑤ 它的 issue 流（最新几条，我读了标题）：** #1926/#1925 *"tool_execute_before hook cannot modify tool arguments - tool.args is not re-read after the hook"*、#1923 *"Browser plugin: dead worker event-loop thread permanently hangs the agent turn (no timeout in BrowserRuntime.call_for, cancellation absorbed forever)"*、#1921 WebUI 加载占位符永久残留。→ **是"功能级失灵"，不是"项目不动"**：都是 2026-09-26/28 的新 issue，项目明显在活跃维护。

---

### 2.11 Voyager —— 技能库概念的开创样本，但已经死了

`https://github.com/MineDojo/Voyager` ｜ 7,231★ ｜ **最后提交 2024-04-03**（死 2 年半）｜ issue 0 / PR 7

**【文档】我读过的文件：** `README.md`（grep）。**我没读它的源码**，所以只有它自己的说法：
- 三大件（README:22-26）：*"1) an automatic curriculum that maximizes exploration, 2) an **ever-growing skill library of executable code** for storing and retrieving complex behaviors, and 3) a new iterative prompting mechanism that incorporates environment feedback, execution errors, and self-verification"* —— 注意技能是**可执行代码**，不是文本笔记。
- 技能库可迁移：*"Voyager is able to utilize the learned skill library in a new Minecraft world"*（README:35）；也支持"只跑任务分解 + 加载已学技能库"（README:120-141）。
- 自己承认的坑：README:135 *"Notice: Occasionally, the task decomposition may not be logical. If you notice the printed sub-goals are flawed, you can rerun the decomposition."*（**任务分解会不合逻辑，靠人重跑**）；README:164 *"This project is strictly for research purposes, and not an official product from NVIDIA."*
- 硬门槛：要真 Minecraft 实例 + OpenAI GPT-4 API key（README:64-75）。
**活性：死。** 7 个 open 全是 PR，最后一次提交是 2024-04。

### 2.12 SEAL —— 改权重这一层，单机不可行

`https://github.com/Continual-Intelligence/SEAL` ｜ 1,863★ ｜ 最后提交 2025-08-01 ｜ issue 2 / PR 2

**【文档】我读过的文件：** `README.md`（grep + 读了关键两段）。
- README:16：*"SEAL (Self-Adapting LLMs) is a framework for training language models via RL to generate self-edits (finetuning data and other update directives for themselves) in response to new inputs."*
- README:65：*"Before running any shell scripts, make sure to update the SLURM directives... All experiments can be run with **2 A100/H100 GPUs**. Other setups may require refactoring and/or changing model sizes."*
→ **改权重层的真实成本是 2×A100/H100 + SLURM**，对"单机 DeepSeek Harness 自我进化"这个场景不适用。（这是我的判断，依据是上面那行 README。）

---

## 3. 专题：**哪些真的在改自己的代码**（tier 3），它们怎么防跑飞

### 3.1 分层（只按"我读到证据"分）

| 层 | 项目 | 证据 |
|---|---|---|
| **tier 3：改自己的代码/能力** | **DGM**、**SICA**、**live-swe-agent**（提示词级的运行时改能力） | `DGM_outer.py` + `self_improve_step.py` 全文段；`runner.py:777/832` + `base_agent/README.md:10-12`；`config/livesweagent.yaml:105-148` |
| **tier 2：改提示词/工作流（不改自己实现）** | **ShinkaEvolve**（system prompt 进 archive）、**AFlow**（workflow 图 + 经验库）、**openevolve**（被演化程序） | `prompt_evolver.py` 结构；`experience_utils.py` 全文；`config.py:396` |
| **tier 1：改自己的函数库（有执行无验证）** | **babyagi/functionz** | `execution.py:44,122` + `CODE_READINESS_ANALYSIS.md` |
| **不是 tier 3** | SWE-agent reviewer（改被修仓库）、SWE-bench（评测基础设施） | `reviewer.py:559-700`；`grading.py` |

### 3.2 防跑飞机制清单（每条带出处）

1. **沙箱/容器隔离** —— DGM README 要求 Docker（`docker run hello-world` 自检）；SICA README：*"IMPORTANT NOTE: always run the agent in the provided Docker container. Since the agent can execute shell commands, this offers some isolation from your host machine, avoiding inadvertent file system manipulation and similar risks."*；**babyagi 是反面样本**（`exec()` 无沙箱）。
2. **超时（注意 DGM 是两层）** —— 容器内 `timeout 1800`（30 min，`self_improve_step.py:348`）+ 外层 `future.result(timeout=1.5*60*60)` 与 `future.cancel()`（`DGM_outer.py:305-309`）。
3. **自改范围限定** —— SICA：新版本由 `shutil.copytree` 生成到 `archive/agent_<i>/agent_code`（`runner.py:777`），历史 archive **只读挂载**（`runner.py:832` `:/home/agent/archive:ro`）。DGM：自改对象就是 `coding_agent.py` + `tools/` + `prompts/`。
4. **归档可追溯 + 不删** —— DGM：`archive` commit 列表 + 每代 append `dgm_metadata.jsonl`（`DGM_outer.py:324-332`），父代按 `score_child_prop` 选（`:91-100`）；SICA：每代独立目录 + `agent_change_log.md`（`Iteration | Change | Was Successful? pending/yes/no`）。
5. **★ 版本可重建（DGM 独有）** —— 每个版本 = 初始镜像 + 归档补丁链：新容器里 `patch -p1` 重放父代 patch（`self_improve_step.py:293-302`）→ `git commit` → 抠出 hash 当 harness 的 `--base_commit`（`:303-309, 353`）。**但：全文 grep `exit_code` 零命中，补丁应用成败不校验**（`log_container_output` 只看日志）。
6. **准入过滤（改坏的别进来）** —— DGM：`filter_compiled()` 丢编译失败/全空补丁（`:152-165`）；`update_archive(keep_better, noise_leeway=0.1)` 给噪声留 0.1 容差（`:174-190`）；SICA：用 **CI 下界**在噪声带里挑最新版本（`runner.py:88-150`）。
7. **预算闸** —— SWE-agent `cost_limit` / `max_attempts` / `max_accepts` / `min_budget_for_new_attempt`（`reviewer.py:616-655`）；ShinkaEvolve `max_api_costs`（README 配置表）。
8. **级联评估（贵的只在便宜的先过之后才跑）** —— DGM `test_more_threshold=0.4` + `get_full_eval_threshold()` 取归档第二高分且 ≥0.4（`self_improve_step.py:153-155`、`DGM_outer.py:192-219`）；openevolve `cascade_thresholds: [0.5,0.75,0.9]`（`config.py:396-397`）。
9. **作用域化变更** —— agent-zero 的提示词设置"快照-还原"（`prepare_prompt/start/_99_snapshot_settings.py` + 配套 end 还原）：改动被限制在一次提示词构建内，不外溢。

### 3.3 ★ 你问的那个 quote 属于哪一类

> *"this code is not hot-loaded or running at this point: in order to test anything (e.g. a new tool), you must invoke a new test instance of the agent on some test task, and inspect its outputs and logs."* —— `base_agent/README.md:10-12`

它属于 **第 10 类：「进程外验证 + 冷启动」** —— 上面 1–9 条全都在防"改的过程跑飞"，**只有这一条在解决"改完之后谁来判它对"**。三件事：

- **被改的代码不参与本轮运行**（不热加载）。正在跑的进程永远跑旧代码，所以它**没有能力自证新代码的对错**。
- **新版本必须在新实例里、在真实任务上跑**（不是单元测试；`base_agent/README.md:252-254` 明说 *"It is better to write end-to-end tests rather than unit tests with complicated mocking."*）。
- **然后由外部读 logs/traces 下判断**（`:146`：临时输出目录 + log 里的 traces；`--debug` 时还有 `contexts/` 能看到每个 subagent 的 system prompt / core prompt / prefill）。

**它和 SICA 自己的 overseer 是两个不同的环，不能合并：**
- `overseer.py` 是**运行时**监督：看 callgraph 判"这轮有没有跑歪"，它**不判断"改完的代码对不对"**（它连新代码都没在跑）。
- `base_agent/README.md:10-12` + `:146` 是**版本级**验证：新代码冷启动重跑，外部看日志。
SICA 把版本级这一步**留给了人**（主语是 "you must / you should inspect"）；能自动化的部分它放进 benchmark 套件 + `compute_statistics` 的 CI 比较里。**这正是 dsh-steward 要把"人"替换掉的那一格。**

同源旁证：SICA 把这件事的失败模式写进了监督者的提示词（`overseer.py:243-246`）：*"It sometimes gets confused, especially when testing tools, about what code is running: the code it is editing is not the code that is currently running... you MUST intervene."* —— **"我改的代码不是正在跑的代码"这个坑，它用监控者的嘴说出来，而不是写在文档里。**

### 3.4 谁没有回滚（反面对照）

- **DGM**：归档 + 追加日志 + 补丁链重放 = 任一历史版本可重建（恢复点明确，但补丁应用不校验成败）。
- **SICA**：每代独立目录 + 只读 archive = 旧版本永远在（"退" = 换父代）。
- **openevolve**：`ProgramDatabase.save/load` + `_reconstruct_islands` + 专门的 resume 测试（**在我读过的项目里，唯一见到带"恢复"单元测试的**）。
- **SWE-agent**：无 revert，用 `get_best()` 在多份提交里挑最好的（"退" = 不选它）。
- **babyagi**：**无沙箱、无验证、无回滚**三者同时缺（`execution.py:44,122` + `CODE_READINESS_ANALYSIS.md`）。
- **AFlow**：每轮 `round_N` 目录算天然快照，但**我没读到"回滚到某一轮"的代码**。
- **live-swe-agent / agent-zero / Voyager / SEAL / ShinkaEvolve**：**我没找到回滚机制的依据**，不写。

---

## 4. 专题：对照 dsh-steward 的三件事

### 4.1 五层目标队列 ← 别人怎么"找下一个目标"

- **★ DGM 是"按失败类型排队"最干净的样本**（`DGM_outer.py:112-148`）：每代先按**失败类别**决定改进什么 —— `solve_empty_patches`（空补丁 ≥10% 时以 25% 概率）、`solve_stochasticity`（25% 概率）、`solve_contextlength`（检测到同一错误重复且 25% 概率），否则从**未解决实例**里随机挑一个。**这就是 L2「已知缺口」的机器版**，缺口是从评测日志里自动抠出来的，不是人手写 backlog。配套的诊断提示词按类别分开（`prompts/self_improvement_prompt.py`）。
- **AFlow 是"经验库驱赶下一轮"**：失败的修改被渲染进下一轮提示词（`experience_utils.py:55-67`），但如 2.7 所述，它的 success/failure 渲染有 bug。
- **SICA 给的不是队列而是取舍准则**（`base_agent/README.md:262-300`）：简单度层级 prompts > tools > reasoning structures > agents > framework；每个改动先问"能否提高 benchmark / 降时间 / 降成本"。

### 4.2 督促控制器 ← SICA 的 overseer 是最接近的实现

全部来自 `oversight/overseer.py`：

| dsh-steward 的要素 | SICA overseer 的对应物 | 差异 / 可借鉴 |
|---|---|---|
| 另一个 agent 读工作日志判断 | 读 **callgraph 执行树**（`generate_overseer_execution_tree`，`:207`） | 它看结构化事件流，不看文本日志 |
| 输出"下一句推动" | `notification_content` 注入目标 agent 的事件流（`:374-392`，`EventType.OVERSEER_NOTIFICATION`） | 通知是**注入上下文**，不是改写任务 |
| 判"偷懒还是真完成" | `making_progress` / `is_looping` 两个布尔（`:44-50`） | **二值判断，无证据链** ← 可改进点 |
| 跨轮记忆 | `notes_for_next_iteration` → `self._previous_notes`（`:369-372`），下次提示里回填 | **一次只留一段 note** |
| 调度 | `next_check_type=time|events` + `next_check_delay`（钳在 5–500s，`:402-410`） | 让监督者自己决定下次何时看 |
| 终极手段 | `force_cancel_agent`，且**必须先通知过一次**（`:237`） | 它自己写明取消的代价：新 sub-agent 从零开始 |
| 独立性 | **换一个模型**（`:165-172`） | 与主循环模型解耦 |
| 看得比 agent 少 | 提示词自认 *"You can see less than the agent can"*（`:255`） | 纪律是"别急着下负面结论" |

**它承认的两个弱点，dsh-steward 要直接规避：** 判决解析失败会**静默 `return None`**（`:321-330`，且 TODO 自认没记进事件流）；判断只有布尔，没有证据引用。

### 4.3 六不变量 + 差分运行器 ← SWE-bench 的守卫清单（可直接抄）

1. **双向判据**：新增行为必须由失败转通过（F2P），原有行为必须保持通过（P2P）—— `grading.py:236-247`。
2. **跳过 ≠ 通过**：F2P 被 skip 算未解决（`grading.py:101-110`）；P2P 被 skip 不算回归（`:93-98`）。
3. **"跑起来了"必须单独取证**：状态表为空且无 `SUITE_RAN` 证据 ⇒ **判 invalid，不是全过**（`grading.py:153-160` + `:24-45`）。
4. **不信被测方的自报**：日志出现 PASSED 但测试命令退出码非 0 且无任何 FAILED/ERROR ⇒ 判 invalid（`grading.py:164-176`）。
5. **解析器的已知缺陷要显式记账并留 TODO**，不能让它悄悄影响判分（`grading.py:60-77`）。
6. **⚠ 它有一处反面写法**：`compute_fail_to_pass()` 在 `total == 0` 时 `return 1`（`grading.py:288-295`）—— "没有用例"被当成满分。这与第 3 条要防的东西方向相反，抄的时候要反过来写。

---

## 5. 它们自己承认的坑（汇总，按"最有用"排序）

| # | 项目 | 原话 / 位置 | 为什么有用 |
|---|---|---|---|
| 1 | SICA | `base_agent/README.md:10-12`：代码不热加载，必须新起实例跑真实任务再看日志 | 自我修改的自证不可能性 |
| 2 | SICA | `overseer.py:245`：*"the code it is editing is not the code that is currently running"* | 同一个坑的第二处证据（写进监督者提示词） |
| 3 | SWE-bench | `grading.py:29-31`：空状态表 + FAIL_ONLY ⇒ 每个 F2P 都算通过 ⇒ **没跑过的套件变成已解决** | 假 AGREE 的经典成因 |
| 4 | SWE-bench | `grading.py:164-176`：补丁可以自己打印 "PASSED"（conftest hook），必须用退出码交叉校验 | 不能信被测方自报 |
| 5 | DGM | `DGM_outer.py:44-47`：同一错误串连续出现两次 ⇒ 判定"根本没试着修" | "假装在干活"的检测器 |
| 6 | DGM | README safety warning：模型生成的代码可能破坏性地运行 | 自改代码的物理风险 |
| 7 | DGM | issue #31 + 我核对 `DGM_outer.py:103-104, 228`：`best` 父代选择**取到最低分**，且 CLI 因漏逗号不可达 | 论文级项目里"没人用的分支已经坏了" |
| 8 | DGM | issue #35：harness agent 能访问隐藏的 Polyglot 测试与参考解；issue #36：`load_all_tools` 无来源校验地 import 所有 `tools/*.py` | 自评测的污染面 + 自改 agent 的加载面 |
| 9 | SICA | README「Things to work on」：早期改动会污染后续比较，导致方差大 | 自改循环的路径依赖 |
| 10 | SICA | `overseer.py:326-330`：监督者判决解析失败被静默丢弃 | 监督者自己会瞎 |
| 11 | babyagi | README:6-7 + `CODE_READINESS_ANALYSIS.md`：作者自认非开发者、Not meant for production、Testing 0/10、`exec` 无沙箱 | "自建函数库"这条路的三缺样本 |
| 12 | AFlow | （我读出来的）`experience_utils.py:63`：success 分支也写 "Absolutely prohibit"；`check_modification` 成功/失败一律拉黑 | 经验库会反噬成功经验 |
| 13 | openevolve | `config.py:284`：meta-prompting 没实现；`evaluator.py:124-127`：级联配置不当会静默退化成直接评估；issue #481 标题：evaluator 在进程内执行 operator 代码 | 配置项存在 ≠ 功能存在；评测路径自身是安全面 |
| 14 | ShinkaEvolve | CHANGELOG：EVOLVE-BLOCK 标记被腐蚀、连续插入拼坏代码行、Wolfram 全量拒绝；"Removed the automatic Claude Code Review pull-request workflow"；队列满时丢事件 | 文本级改代码的脆弱性 + 自动审查被关掉 |
| 15 | SWE-agent | reviewer 打分靠正则抠最后一个数字，解析失败给 0 分 / 返回全部索引 | 评审器的解析就是薄弱点 |
| 16 | live-swe-agent | 配置里"违反格式就拒绝响应"；README 上手指南链接是空的 | 上手路径本身有断点 |
| 17 | Voyager | README:135：任务分解会不合逻辑，靠人重跑 | "自主课程"的人肉兜底 |

---

## 6. 我没找到答案的问题（诚实清单）

1. **ShinkaEvolve 的失败回退** —— 只读到 UCB 采样与预算帽，没读到检查点/回滚实现。
2. **live-swe-agent 的工具复用** —— 工具在运行中写成文件后，跨轮/跨任务怎么留存与复用，我没读到依据（它依赖的 `mini-swe-agent` 我也没读）。
3. **agent-zero 的验证与回退** —— 补读了技能召回与设置快照两个扩展，但评测/自改路径没读。
4. **★ 有没有项目在做"两条线并行跑、比对 AGREE/DIVERGE"** —— **没找到。** SWE-bench 是"对照 gold patch 的判据"，不是"两条独立运行线互相比对"。**差分运行器这个具体形态，在这批项目里没有先例。**
5. **"编号不变量清单"** —— 除 SWE-bench 的 F2P/P2P 二元结构外，我没在任何项目里找到"写成代码的、带编号的不变量清单"。
6. **"它根本不动"的精确条数** —— 我给了 issue 总数（不含 PR），也读了 4 个项目最新各 ~10 条标题，但**没有逐条读完**所有 issue，所以只能说趋势不能给精确统计。
7. **DGM 的 `is_compiled_self_improve` 判定细节** —— 在 `utils/evo_utils.py`，我下载了但没读。
8. **openevolve 级联评估的函数体** —— 只到"配置 + 存在性校验"这一层，`_cascade_evaluate` 内部没读。

## 7. 排除清单（及理由）

- **纯论文 / 无下载产物**：AlphaEvolve（只有 paper，无开源实现 —— openevolve 是第三方重实现）。
- **纯 prompt 模板**：Cline/Roo 的 "Memory Bank" 之类（无可执行物，排除）。
- **读了但判定"不该算自我改进 agent"的**：SWE-agent reviewer（改的是被修仓库）、SWE-bench（评测基础设施）。作为**机制参考**保留在本报告，已就地标注。
- **只读文档、不给机制结论的**：Voyager、SEAL（在 2.11/2.12 明确标注证据等级）。
- **★ 易踩空提示**：`letta-ai/letta`（24,950★）的默认分支**现在只有文档** —— 根目录 10 个条目全是 `.md`/license，README 自己写明源码已迁到 **`letta-ai/letta-code`**。要找 Letta 的实现别在这条分支上找。（依据：`gh api repos/letta-ai/letta/contents/` 的列表 + `letta-ai/letta/README.md` 原文 *"The current source code lives in `letta-ai/letta-code`... The `archive` branch contains the retired Letta V1 API server."*）
---

## 附录 A（lead 补答）：差分运行器有先例 —— 在编译器圈，不在 agent 圈

报告 §6 的问题 1 问：「两条线并行跑 + AGREE/DIVERGE 这个形态，我在这批项目里没找到先例」。

**答：这个形态有名字，叫 differential testing，1998 年就有论文，而且它在两个圈子里是标准做法 —— 只是不在 agent 研究圈。**

| 出处 | 内容 |
|---|---|
| **McKeeman 1998**, *Differential Testing for Software* | 原始论文。核心主张：**不需要 oracle（知道正确答案），只需要两个实现** |
| **Ada Conformity Assessment Test Suite (ACVC)** | 航空/军工的编译器适航验证。同一份测试套件跑多个编译器实现，不一致处即是问题 |
| **GCC / LLVM / ICC 交叉测试** | 编译器圈的标准实践。Csmith、EMI 这类工具就是干这个的 |
| **数据库 / 文件系统差分测试** | 同一 SQL 跑 PostgreSQL 与 MySQL，结果不一致处往往是 bug（或标准歧义） |

### 为什么这个区别重要

```
测试        绑在实现上     → 改了实现，测试就得改
不变量      绑在性质上     → 性质不变，实现随便改
差分        ★ 不需要知道哪条线对
```

**第三层的价值恰恰在于：它不需要我们预先知道正确答案。** 而我们之所以需要它，是因为 dsh-steward 要改的正是 DSH 自己 —— **没有第三方参照物，也不该有**。

### 但有一条必须先说清的边界

报告自己引的那句注释是对的，值得再抄一次：

> 发散并不自动等于失败的那条线有 bug：它是**一个关于「这个性质究竟要求哪种行为」的问题**。

**差分测试给出的是「这里有个不一致」，不是「哪边错了」。** 在编译器圈，这个不一致要靠人去读标准文档判断。在这里，要靠人去读 cordis 的语义判断。**报告里那条 DIVERGE（`I2.pending-owner-drains`）至今没有被判定谁对** —— 而这正是这个机制诚实的地方。

### 对报告结论的修正

**「六不变量 + 差分运行器没有先例」这一条应改为：**

> 在 agent 圈没有先例；在编译器、数据库、适航认证圈是标准做法。
> **我们不是发明了它，是把它搬过来了** —— 而搬过来这件事本身值得记一笔，
> 因为它意味着 agent 圈在这件事上落后于传统工程二十年。
