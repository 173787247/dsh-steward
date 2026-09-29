# 单机无人值守自治运维：成熟做法调研

> 产出：task-8 / surveys 第 4 路
> 调查对象：**一台** WSL2 机器（Ubuntu 24.04.4 LTS，systemd 255.4-1ubuntu8.17，内核级 cgroup v2 unified，RTX 5080 16GB，内存 249GB），**无集群**。
> 调研纪律：每条结论带 `man page(章节)` 或 URL；找不到依据的写进 §8，不填猜测。

## 证据等级标记

| 标记 | 含义 |
|---|---|
| `[实测]` | 我在本机实际运行命令得到的输出（可复现，命令一并给出） |
| `[man]` | 本机 man page，标注 `手册名(章节)` 与**指令名/小节名** |
| `[本机文件]` | 本机实际存在的配置文件内容 |
| `[URL]` | 外部来源，已实际抓取（HTTP 200） |
| `[第一手]` | 本项目内部发生的事（非公开来源，仅作案例，不作为技术依据） |

关于"我读过源码"与"我只读了文档"的区分：本报告**没有读过任何 systemd 源码**，全部 `[man]` 结论来自 Ubuntu 24.04 自带 man page，全部 `[实测]` 结论来自本机命令输出。

---

## 0. 结论速览

1. **systemd 的失败语义比大多数自建"自治脚本"更完整**：`SuccessExitStatus=` / `RestartPreventExitStatus=` / `ExecCondition=` 三者合起来能精确区分"跑完了但发现了问题"/"确定不可恢复，别重试"/"条件不满足，跳过且不算故障"。自己写 if-else 判退出码 = 重新发明这三个指令，且通常少一个。
2. **`StartLimitBurst` 是"永久停摆"的成因，不是保护**：命中启动限流后 systemd **不再重试**，只有 `systemctl reset-failed` 能解（`systemd.unit(5) · StartLimitIntervalSec=`）。这就是"看起来在努力、持续数天、起不来"的系统级机制。
3. **timer 到点时如果目标 unit 还是 active，systemd 静默跳过，不报错**（`systemd.timer(5)` DESCRIPTION）。只要上一次实例没退出，定时器就永远空转 —— 这是"配置写每小时、实际每天只跑两次"的一类真实成因。
4. **`OnCalendar` 的 `/` 重复只在**单个时间组件内**生效，不进位**：`[实测]` `*:0/4` 的规范化形式是 `*-*-* *:00/4:00`，即**每 4 分钟**（一天 360 次），不是每 4 小时。
5. **`OnCalendar` 的区间+重复 = 窄窗口**：`[实测]` `*-*-* 08..20/6:00:00` → 08:00/14:00/20:00，20:00 到次日 08:00 有 12 小时空窗。**这是"every_Nh 只在当天窄窗口触发、跨天不连续"的 systemd 版本**。
6. **`AccuracySec=` 默认 1min、`RandomizedDelaySec=` 每次迭代重新随机**：`[本机文件]` Ubuntu 的 `man-db.timer` 名义 `daily`，`[实测]` 实际 00:08:56 跑过一次、下一次是 05:29:57。同一份配置，每天触发时刻不同。**"每小时/每天"不等于"整点"**。
7. **睡眠期间错过的日历定时器只补跑一次**（`systemd.timer(5) · OnCalendar=`），`Persistent=true` 也只补一次。睡 8 小时错过 8 次 hourly → 恢复后跑 1 次。
8. **DST 春季会让定时任务静默漏一天**：`[实测]` `*-*-* 02:30:00` 在 America/New_York 2026-03-08 的那次被整体跳过；秋季回拨不重复。
9. **一台机器救不了自己"整机死亡"**，唯一原生手段是硬件看门狗（`systemd-system.conf(5) · RuntimeWatchdogSec=`），而它只能重启、不能修复。
10. **单机没有 fencing，只有 cgroup**：Pacemaker 明确说"资源在本节点停不掉，就不能在别处起"；单机上"停不掉"会直接变成"起不来"（§3.2、§2.8 的 `--collect` 坑本质）。
11. **"先落盘，再深挖"不是风格问题，是中断损失上界问题**（§5.3，本项目 2026-09-28 的第一手事故）。
12. **灾难性故障的主因是错误处理，不是硬件**：OSDI'14 对 198 个真实故障的统计 —— **92%** 是"非致命错误被处理错"，**58%** 本可通过简单测试错误处理代码发现，而 **"错误处理器是空的、或只有一条打日志语句"被列为三大致命模式之一**（§3.4）。
13. **只在异常时才走的恢复分支，几乎肯定没被测过**：让"恢复"成为唯一的启动路径（crash-only），否则恢复代码会腐烂（§3.3）。
14. **单机的自动重启救不了坏配置**：CrowdStrike 2024 的坏配置文件把"一个组件坏"放大成"整机启动环"，必须人工介入（§6.7c）。**要的是回滚，不只是重启。**
15. **急停开关必须独立于被它关停的系统**：Cloudflare 2019 因为自己的认证服务也挂了，进不了控制台，5 分钟才执行全球关停（§6.7a）。单机上同理 —— 自治 agent 的"暂停"不能依赖 agent 自己。
16. **cron 与 systemd 在 DST 上行为相反**：cron 会"在时钟变更后不久补跑"被跳过的小时，systemd 则**静默跳过不补**（§2.9，`cron(8)` vs `[实测]`）。**跨调度器迁移时这是静默丢任务。**
17. **默认值就是坑**：Docker `json-file` 的 `max-size` 默认 **-1（无限）**、`max-file` 默认 1（§6.4）；journald 的 `SystemMaxUse=` 是**软**限制，磁盘被别人占满时它不会回头删自己的旧文件（§6.1）；崩溃循环每次都会往 `/var/lib/systemd/coredump/` 写内存镜像（§6.5）。
18. **重启前要排空，但单机的原生窗口只有 5 秒**：`logind.conf(5) · InhibitDelayMaxSec=` 默认 5；改配置优先 `daemon-reload`/`daemon-reexec`，**不要全量重启**（§5.3 答案 3）。
19. **local-first 的工程定义是"本地与远程只差在配置里"**：`12factor.net/backing-services` —— "It makes no distinction between local and third party services"；模型侧用 `HF_HUB_OFFLINE=1` 做**硬离线**（缺文件立刻报错，而不是卡在网络超时里）（§4.1、§4.3）。

---

## 1. 必须回答之问一：systemd 有哪些能力常被忽略（指令 → 它防的是什么）

### 1.1 退出码语义：把"没坏"与"坏了"分开

| 指令 | 防的是什么 | 依据 |
|---|---|---|
| `SuccessExitStatus=` | 防"跑完了但报了问题"被记成 unit 失败 → 触发 `OnFailure=`、告警、失败计数、退避重启 | `systemd.service(5) · SuccessExitStatus=` |
| `RestartPreventExitStatus=` | 防"需要人看的确定性错误"被当成可重试故障无限重试 | `systemd.service(5) · RestartPreventExitStatus=` |
| `RestartForceExitStatus=` | 反向：指定退出码**强制**重启（例如"配置热更新后按约定退出"） | `systemd.service(5) · RestartForceExitStatus=` |
| `ExecCondition=` | 防"前置条件不满足"被记成故障（告警疲劳 / 退避） | `systemd.service(5) · ExecCondition=` |

`SuccessExitStatus=` 的原文（`systemd.service(5) · SuccessExitStatus=`）：

> Takes a list of exit status definitions that, when returned by the main service process, will be considered successful termination, in addition to the normal successful exit status 0 and, except for Type=oneshot, the signals SIGHUP, SIGINT, SIGTERM, and SIGPIPE.

★ 反直觉细节（同一小节）：它**不改变退出码到名字的映射**——

> Note that this setting does not change the mapping between numeric exit statuses and their names, i.e. regardless how this setting is used 0 will still be mapped to "SUCCESS" ... It only controls what happens as effect of these exit statuses.

所以 `systemctl status` 里看到 `1/FAILURE` **不代表**这个 unit 失败了（如果 1 在 `SuccessExitStatus=` 里）。**只看退出码字面值来判断成败是错的**，要看 `ActiveState`/`Result`。

`RestartPreventExitStatus=` 的边界（`systemd.service(5)`）：

> Note that this setting has no effect on processes configured via ExecStartPre=, ExecStartPost=, ExecStop=, ExecStopPost= or ExecReload=, but only on the main service process.

`ExecCondition=` 是三态而不是二态（`systemd.service(5) · ExecCondition=`，Added in version 243）：

> when an ExecCondition= command exits with exit code 1 through 254 (inclusive), the remaining commands are skipped and the unit is not marked as failed. However, if an ExecCondition= command exits with 255 or abnormally (e.g. timeout, killed by a signal, etc.), the unit will be considered failed

**对 dsh-steward 的直接含义**：现在的 `SuccessExitStatus=0 1 2 3 4` 解决的是"报告了发现"≠"单元失败"。但"检查前置条件不满足"（例如目标队列为空、依赖端口没起、上一次还在跑）用 `ExecCondition=` 表达比在脚本里 `exit 0` 更准确 —— 后者会让"跳过"看起来像"成功执行"。

### 1.2 启动与失败语义

| 指令 | 防的是什么 | 依据 |
|---|---|---|
| `Type=exec`（对比 `Type=simple`） | 防"二进制根本没起来"却报告启动成功 | `systemd.service(5) · Type=` |
| `StartLimitIntervalSec=` / `StartLimitBurst=`（**在 `[Unit]` 段**） | 防重启风暴 | `systemd.unit(5)`；默认值在 `systemd-system.conf(5)` |
| `StartLimitAction=` | 命中限流后做点什么（而不是干等） | `systemd.unit(5) · StartLimitAction=` |
| `OnFailure=` / `OnSuccess=` | 失败/成功时激活**另一个 unit**（把"报警"与"业务"解耦） | `systemd.unit(5) · OnFailure=` / `OnSuccess=` |
| `FailureAction=` / `SuccessAction=` | 整个 unit 级的动作（reboot/poweroff/kexec/halt） | `systemd.unit(5)` |
| `RestartSteps=` / `RestartMaxDelaySec=` | 固定 `RestartSec=` 的高频重启；**内置指数退避** | `systemd.service(5)`，Added in version 254 |
| `RuntimeMaxSec=` | 卡死的长任务永远占着 unit | `systemd.service(5) · RuntimeMaxSec=` |

`Type=exec` 的原文（`systemd.service(5) · Type=`）：

> Note that this means systemctl start command lines for simple services will report success even if the service's binary cannot be [executed]

> It is recommended to use Type=exec for long-running services, as it ensures that process setup errors (e.g. errors such as a missing service executable, or missing user) are properly tracked.

**对一个"自己报告自己健康"的自治系统，`Type=simple` 是最坏的选择**：它让"没起来"伪装成"起来了"。

★ **`StartLimitBurst` 是本次调研最重要的一条**（`systemd.unit(5) · StartLimitIntervalSec=`）：

> Note that units which are configured for Restart=, and which reach the start limit **are not attempted to be restarted anymore**; however, they may still be restarted manually or from a timer or socket at a later point, after the interval has passed. From that point on, the restart logic is activated again. `systemctl reset-failed` will cause the restart rate counter for a service to be flushed

默认值（`systemd-system.conf(5) · DefaultStartLimitIntervalSec=`）：`DefaultStartLimitIntervalSec=10s`，`DefaultStartLimitBurst=5`。

→ 结论：**`Restart=always` 的"永远会重试"是错的**。5 次 / 10 秒之后就停摆，之后只有"手动、timer、socket"这三条路能再拉起来。对 timer 驱动的 unit，这意味着它每个调度周期会被重新尝试一次（所以 dsh-steward 这类 timer 驱动的任务不会被永久冻死 —— 这是 timer 驱动相对 `Restart=` 驱动的**优势**，值得写进设计）。

★ 同一个 man page 的更冷门一句（**限流对短命 unit 无效**）：

> When a unit is unloaded due to the garbage collection logic (see above) its rate limit counters are flushed out too. This means that configuring start rate limiting for a unit that is not referenced continuously has no effect.

→ transient unit（`systemd-run`）如果被 GC 卸载，限流计数器一起没了。**"用限流防重启风暴"在 transient unit 上不成立。**

`StartLimitAction=` 的语义（`systemd.unit(5)`）：取值同 `FailureAction=`（`reboot` / `reboot-force` / `reboot-immediate` / `poweroff*` / `halt*` / `kexec*` / `exit*` / `soft-reboot*`），默认 `none`——"hitting the rate limit will trigger no action except that the start will not be permitted."

→ 无人值守场景下 `StartLimitAction=reboot-force` 能把"永久停摆"变成"重启一次"。**但它对坏配置无效**：坏配置 + 自动重启 = 启动环。参见 §6.4 CrowdStrike 2024（坏配置文件使机器进入无法自愈的启动环，必须人工介入）。

`RuntimeMaxSec=`（`systemd.service(5)`，Added in version 229）：

> Configures a maximum time for the service to run. If this is used and the service has been active for longer than the specified time it is terminated and put into a failure state. **Note that this setting does not have any effect on Type=oneshot services**, as they terminate immediately after activation completed.

★ 这是一条容易被忽略的边界：**如果长跑任务写成 `Type=oneshot`，`RuntimeMaxSec=` 完全不生效。** 长任务的超时兜底必须用别的机制（脚本内超时、`TimeoutStartSec=`，或 `Type=exec/notify`）。

### 1.3 活性（liveness）与"进程活着但没干活"

`WatchdogSec=`（`systemd.service(5)`）：

> The watchdog is activated when the start-up is completed. The service must call `sd_notify(3)` regularly with "WATCHDOG=1" ... If the time between two such calls is larger than the configured time, then the service is placed in a failed state and it will be terminated with SIGABRT (or the signal specified by WatchdogSignal=). By setting Restart= to on-failure, on-watchdog, on-abnormal or always, the service will be automatically restarted.

- 依赖：程序必须支持 `sd_notify`；`NotifyAccess=` 会被隐式设为 `main`。
- 环境变量 `WATCHDOG_USEC=` 会传给服务，程序可据此自动开启心跳（`sd_watchdog_enabled(3)`）。
- **它是 `Restart=` 覆盖不到的故障面的补集**：`Restart=` 管"进程死了"，`WatchdogSec=` 管"进程在但不动"。
- ★ 反面：给**不支持 `sd_notify`** 的程序配 `WatchdogSec=`，会得到"服务被反复 SIGABRT"的假故障。

`Type=notify` 的长任务还能**主动延长超时**（`systemd.service(5) · RuntimeMaxSec=`）：

> If a service of Type=notify/Type=notify-reload sends "EXTEND_TIMEOUT_USEC=...", this may cause the runtime to be extended beyond RuntimeMaxSec=.

→ 对"不知道要跑多久"的长任务，这是"我还在干活，别杀我"的标准表达，比把超时设成 `infinity` 更安全。

### 1.4 进程组与孤儿进程（与 `--collect` 同一个因果链）

`KillMode=`（`systemd.kill(5)`）：取 `control-group`（默认）/ `mixed` / `process` / `none`。

> If set to process, only the main process itself is killed (**not recommended!**). If set to none, no process is killed (**strongly recommended against!**). In this case, only the stop command will be executed on unit stop, but no process will be killed otherwise. **Processes remaining alive after stop are left in their control group and the control group continues to exist after stop unless empty.**

> Note that it is not recommended to set KillMode= to process or even none, as this allows processes to escape the service manager's lifecycle and resource management, and to remain running even while their service is considered stopped

停止顺序（`systemd.kill(5)`）：`SIGTERM` → （可选 `SendSIGHUP=`）→ 等 `TimeoutStopSec=` → `SIGKILL`（`FinalKillSignal=`）。

`SendSIGKILL=`（`systemd.kill(5)`）有一条盯上同一个坑的警告：

> When disabled, a KillMode= of control-group or mixed service **will not restart if processes from prior services exist within the control group.**

→ **"cgroup 里还有成员"这个坑在 systemd 里不是 `--collect` 独有的**，它同时导致：unit 无法被 GC 卸载、`SendSIGKILL=no` 时无法重启、同名 transient unit 无法再次创建。见 §2.8。

### 1.5 沙箱：防"自治系统改坏宿主"

面向一个会自己改东西的 agent，沙箱指令不是安全加固，而是**边界定义**。按"防的是什么"分组（全部依据 `systemd.exec(5)`，各指令同名小节）：

| 分组 | 指令 | 防的是什么 |
|---|---|---|
| 文件系统 | `ProtectSystem=strict`（整个层级只读，除 `/dev` `/proc` `/sys`）、`ProtectHome=`（`/home` `/root` `/run/user` 不可见/只读/tmpfs）、`ReadWritePaths=` | agent 改自己的**代码和配置**（自主系统的经典自毁路径） |
| 时钟 | `ProtectClock=` | agent 改系统时钟 —— 自治系统改时钟等于毁掉所有 timer/证书/日志的时间基准 |
| 内核面 | `ProtectKernelTunables=`、`ProtectKernelModules=`、`ProtectKernelLogs=`、`ProtectControlGroups=` | agent 试图用内核手段"自我修复"（sysctl/模块加载/改 cgroup） |
| 进程可见性 | `ProtectProc=invisible`、`ProcSubset=pid` | agent 扫全机进程、窥探宿主；也减少被 /proc 里的信息误导 |
| 权限 | `NoNewPrivileges=`、`CapabilityBoundingSet=`、`RestrictSUIDSGID=` | 提权面；`NoNewPrivileges=` 保证"服务及其所有子进程永远无法通过 execve 获得新权限" |
| 系统调用 | `SystemCallFilter=@system-service`、`SystemCallArchitectures=` | 爆炸半径收敛（默认拒绝，只放行白名单） |
| 命名空间 | `RestrictNamespaces=`、`PrivateUsers=`、`LockPersonality=` | 逃逸与内核攻击面 |
| 网络 | `RestrictAddressFamilies=`、`IPAddressAllow=` / `IPAddressDeny=`、`PrivateNetwork=` | agent 打外网；**对 local-first 有意义**：可以强制"只允许本地模型端口" |
| 临时态 | `PrivateTmp=`（独立 `/tmp`）、`DynamicUser=`（每次启动临时 UID/GID）、`RemoveIPC=` | 临时文件互相污染、跨服务残留、重启后状态串味 |
| 设备 | `PrivateDevices=`、`DevicePolicy=closed` | agent 直接摸硬件（含 GPU、`/dev/watchdog`） |
| 执行内存 | `MemoryDenyWriteExecute=` | W^X（会误伤 JIT，例如部分 Python/JS 运行时，**上机前必须实测**） |

★ **关键边界**（`systemd.exec(5)`，sandboxing 小节末尾）：

> Also note that some sandboxing functionality is generally not available in user services (i.e. services run by the per-user service manager). Specifically, the various settings requiring file system namespacing support (such as ProtectSystem=) are not available, as the underlying kernel functionality is only accessible to privileged processes. However, most namespacing settings, that will not work on their own in user services, will work when used in conjunction with PrivateUsers=true.

→ **`systemd --user` 起的服务，`ProtectSystem=` 之类默认无效。** 想要完整体验必须跑 system unit（root）。这直接决定了 dsh-steward 应该做成 system unit 还是 user unit。

**验证工具**：`systemd-analyze security <unit>`（`systemd-analyze(1) · security`）：

> The command checks for various security-related service settings, assigning each a numeric "exposure level" value ... calculates an overall exposure level for the whole unit, which is an estimation in the range 0.0...10.0 indicating how exposed a service is security-wise.

★ 它的自述边界（同一小节）：只分析 systemd 自身实现的安全机制，"any additional security mechanisms applied by the service code itself are not accounted for" —— 高分不等于真的可被攻击，低分也不等于安全。

### 1.6 资源与目录生命周期

| 指令 | 防的是什么 | 依据 |
|---|---|---|
| `MemoryHigh=` | **主控制手段**：超过则"heavily slowed down and memory is taken away aggressively" | `systemd.resource-control(5)` |
| `MemoryMax=` | **最后防线**：超过则在 unit 内触发 OOM killer | 同上 |
| `TasksMax=` | 线程/进程数爆炸（fork bomb、失控并发） | `systemd.resource-control(5) · TasksMax=` |
| `CPUQuota=` / `CPUWeight=` / `IOWeight=` | 抢占整机 CPU/IO，把交互和其他服务饿死 | `systemd.resource-control(5)` |
| `RuntimeDirectory=` / `StateDirectory=` / `CacheDirectory=` / `LogsDirectory=` / `ConfigurationDirectory=` | agent 到处写文件、属主/权限错、卸载后残留；生命周期与 unit 绑定 | `systemd.exec(5)`，同名小节 |
| `LogRateLimitIntervalSec=` / `LogRateLimitBurst=`（v240） | 日志风暴 | `systemd.exec(5)`；默认继承 `journald.conf(5) · RateLimitBurst=` |

`MemoryMax=` 的推荐用法（`systemd.resource-control(5) · MemoryMax=`）：

> It is recommended to use MemoryHigh= as the main control mechanism and use MemoryMax= as the last line of defense.

★ 日志限流的**漏洞**（`systemd.exec(5) · LogRateLimitIntervalSec=`）：

> Note that this only applies to log messages that are processed by the logging subsystem, i.e. by systemd-journald.service(8). This means that if you connect a service's stderr directly to a file via StandardOutput=file:... or a similar setting, **the rate limiting will not be applied to messages written that way**

→ **自己往文件里写日志的自洽系统，不受 systemd 的日志限流保护。** 见 §6。

★ 目录指令的配套清理：`systemctl clean --what=state|cache|logs|runtime|configuration <unit>`（`systemctl(1) · clean`）。卸载 unit 前应该清，否则残留会误导下一次部署。

### 1.7 提交前的验证工具（本次调研全靠它们）

| 命令 | 用途 | 依据 |
|---|---|---|
| `systemd-analyze calendar --iterations=N [--base-time=...] <表达式>` | **把 OnCalendar 表达式展开成真实触发序列**（本次抓到 3 个陷阱） | `systemd-analyze(1) · calendar` |
| `systemd-analyze verify <unit>` | unit 文件语法/依赖静态检查 | `systemd-analyze(1) · verify` |
| `systemd-analyze security <unit>` | 沙箱暴露分 | `systemd-analyze(1) · security` |
| `systemctl list-timers --all` | 看 NEXT/LAST **真实时刻**与名义表达式的偏差 | `systemctl(1) · list-timers` |
| `systemd-delta` | 找出被 override / mask 的 unit（"为什么我改的配置没生效"的标准答案） | `systemd-delta(1)` |
| `systemctl reset-failed <unit>` | 解除启动限流造成的停摆 | `systemctl(1)` |

★ **纪律建议：任何 timer 表达式进入仓库前，必须附上 `systemd-analyze calendar --iterations=5` 的输出。** 这是把"我以为它每小时跑"变成"它确实每小时跑"的唯一廉价手段。

---

## 2. 特别关注：定时任务的设计陷阱

> 本节是全报告最"有据可查"的一节：所有 systemd 结论都在本机 systemd 255 上实测过，命令与原样输出一并给出，可复现。

### 2.1 【陷阱 A】目标 unit 还 active 时，timer 静默跳过 —— 不报错

`systemd.timer(5)` DESCRIPTION 原文：

> Note that in case the unit to activate is already active at the time the timer elapses it is not restarted, but simply left running. **There is no concept of spawning new service instances in this case.** Due to this, services with RemainAfterExit=yes set (which stay around continuously even after the service's main process exited) are usually not suitable for activation via repetitive timers, as they will only be activated once, and then stay around forever.

**为什么这会造成"每天只跑两次"**：

- 只要上一个实例**还没退出**，定时器到点就什么都不做。
- 触发条件包括：`Type=simple` 的任务卡住不退出；`Type=oneshot` + `RemainAfterExit=yes`；上一个实例被挂起（SIGSTOP / 内存压力下的长时间不可运行）；上一次运行比调度周期还长。
- **最坏的部分：没有任何错误**。timer 状态是 `active (waiting)`、service 状态是 `active (running)`，`systemctl list-timers` 的 LAST/NEXT 正常滚动。**监控看到的是一切正常。**
- 目标 unit 用**同一名字**重复执行时，这个行为还会掩盖"上一次真的没结束"。

自查命令：

```bash
systemctl show -p Type -p RemainAfterExit -p ActiveState -p SubState <unit>.service
systemctl list-timers --all '<unit>.timer'
```

**设计结论**：周期性任务应当是**短命的、会退出的**实例；需要"不重叠"时，正确的做法是让它被跳过并且**把跳过记成一等事件**（例如 `ExecCondition=` 检测锁文件 → 退出 1..254 → unit 不算失败但可被计数），而不是靠 systemd 的静默跳过。

### 2.2 【陷阱 B】`/` 重复只在组件内生效，不跨组件进位

`systemd.time(7) · CALENDAR EVENTS` 原文：

> Values may be suffixed with "/" and a repetition value, which indicates that the value itself and the value plus all multiples of the repetition value are matched.

`[实测]` 写"每 4 小时"时最自然的错误写法：

```
$ systemd-analyze calendar --iterations=4 "*:0/4"
  Original form: *:0/4
Normalized form: *-*-* *:00/4:00          ← 注意规范化后落在"分钟"字段
    Next elapse: Mon 2026-09-28 23:36:00 CST
   Iteration #2: Mon 2026-09-28 23:40:00 CST
   Iteration #3: Mon 2026-09-28 23:44:00 CST
   Iteration #4: Mon 2026-09-28 23:48:00 CST
```

→ **实际是每 4 分钟**（一天 360 次），不是每 4 小时（一天 6 次）。差 60 倍，方向是"过密"。

同一个 `/` 语法在**分钟字段**写超范围值时，systemd 会直接拒绝（这反而是好事）：

```
$ systemd-analyze calendar "*:0/90"
Failed to parse calendar specification '*:0/90': Invalid argument
```

而正确的"每 6 小时"要把 `/` 写在**小时**字段：

```
$ systemd-analyze calendar --iterations=5 "*-*-* 0/6:00:00"
Normalized form: *-*-* 00/6:00:00
    Next elapse: Tue 2026-09-29 00:00:00 CST
   Iteration #2: Tue 2026-09-29 06:00:00 CST
   Iteration #3: Tue 2026-09-29 12:00:00 CST
   Iteration #4: Tue 2026-09-29 18:00:00 CST
   Iteration #5: Wed 2026-09-30 00:00:00 CST
```

**要点**：`*/N` 里的 N 是**组件内**的步长（分钟 0–59、小时 0–23），不会进位到下一个组件。写"每 N 小时"必须把 `/N` 放在小时位，而且不能跨越组件边界表达"每 90 分钟"这类需求（组件内无法表达 → 要么用 `OnUnitActiveSec=90min` 这种单调定时器，要么写两个表达式）。

### 2.3 【陷阱 C】区间 + 重复 = 窄窗口，跨天不连续（与已知案例同构）

`systemd.time(7) · CALENDAR EVENTS` 原文（区间后接重复）：

> ranges may also be followed with "/" and a repetition value, in which case the expression matches all times starting with the start value, and continuing with all multiples of the repetition value relative to the start value, **ending at the end value the latest**

`[实测]` 想表达"每 6 小时"但顺手写了工作时段：

```
$ systemd-analyze calendar --iterations=6 "*-*-* 08..20/6:00:00"
Normalized form: *-*-* 08..20/6:00:00
    Next elapse: Tue 2026-09-29 08:00:00 CST
   Iteration #2: Tue 2026-09-29 14:00:00 CST
   Iteration #3: Tue 2026-09-29 20:00:00 CST
   Iteration #4: Wed 2026-09-30 08:00:00 CST      ← 直接跳到第二天早上
   Iteration #5: Wed 2026-09-30 14:00:00 CST
   Iteration #6: Wed 2026-09-30 20:00:00 CST
```

→ **每天只跑 3 次，20:00 → 次日 08:00 有 12 小时空窗，跨天不连续。**

**这正是已知案例的形态**："配置写着 every_Nh，实际只在当天某个窄窗口内触发，跨天不连续"。任何把"重复"写在**有界区间**里的表达式，都会退化成窗口；区间越窄，"每 N 小时"越不像"每 N 小时"。

同类变体（都值得进检查清单）：
- `Mon..Fri 0/4:00:00` → 工作日每 4 小时，周末 0 次，且周五 20:00 → 周一 00:00 之间是 **52 小时**空窗。
- `*:0/15` → 分钟内步长，正确；但 `09..17:0/15` 就变成"只在 9–17 点的每 15 分钟"，夜里没有。
- `*-*-01 00:00:00`（monthly）→ 只在那一天的 00:00；若当天机器没开、又没 `Persistent=true`，整月漏掉。

### 2.4 【陷阱 D】`AccuracySec=` 与 `RandomizedDelaySec=`：名义时间不是触发时间

`systemd.timer(5) · AccuracySec=`（默认 **1min**）：

> The timer is scheduled to elapse within a time window starting with the time specified in OnCalendar= ... and ending the time configured with AccuracySec= later. Within this time window, the expiry time will be placed at a host-specific, randomized, but stable position that is synchronized between all local timer units. This is done in order to optimize power consumption

`systemd.timer(5) · RandomizedDelaySec=`（默认 **0**）：

> Delay the timer by a randomly selected, evenly distributed amount of time between 0 and the specified time value. ... **Each timer unit will determine this delay randomly before each iteration**

★ 组合规则（同一节）：

> If RandomizedDelaySec= and AccuracySec= are used in conjunction, first the randomized delay is added, and then the result is possibly further shifted to coalesce it with other timer events

所以**同一个 unit、同一份配置，每次触发的偏移都不同**（除非 `FixedRandomDelay=`）。

`[本机文件]` + `[实测]` 本机 Ubuntu 24.04 的真实证据（`systemctl list-timers --all`，采集于 2026-09-28 23:32 CST）：

| unit | 名义 `OnCalendar=` | 其它 | 实际 NEXT | 实际 LAST | 偏差 |
|---|---|---|---|---|---|
| `man-db.timer` | `daily`（= 00:00:00） | `RandomizedDelaySec=12h`, `Persistent=true` | 09-29 **05:29:57** | 09-28 **00:08:56** | 同日 5.5h 偏移；上一次只偏 9min |
| `motd-news.timer` | `00,12:00:00` | `RandomizedDelaySec=12h`, `OnStartupSec=1min` | 09-29 **03:04:12** | 09-28 12:20:53 | 名义 00:00 → 实际 03:04 |
| `apt-daily.timer` | `6,18:00` | `RandomizedDelaySec=12h`, `Persistent=true` | 09-29 **10:16:28** | 09-28 18:10:51 | 名义 06:00 → 实际 10:16（+4.3h） |
| `apt-daily-upgrade.timer` | `6:00` | `RandomizedDelaySec=60m` | 09-29 **06:53:59** | 09-28 06:00:44 | 名义 06:00 → 实际 06:53 |
| `logrotate.timer` | `daily` | `AccuracySec=1h` | 09-29 **00:00:00** | 09-28 00:00:17 | 落在窗口边界 |
| `dpkg-db-backup.timer` | `daily` | `Persistent=true` | 09-29 **00:00:00** | 09-28 00:00:17 | 无抖动（对照组） |
| `e2scrub_all.timer` | `Sun *-*-* 03:10:00` | `RandomizedDelaySec=60` | 10-04 **03:10:35** | 09-27 03:10:44 | 每周日，抖动小 |
| `fstrim.timer` | `weekly` | `AccuracySec=1h`, `RandomizedDelaySec=100min` | — | — | 未激活 |

出处：`[本机文件]` `/lib/systemd/system/*.timer`；`[实测]` `systemctl list-timers --all`。

**读法**：`man-db.timer` 名义"每天 00:00"，实际一次 00:08、下一次 05:29。**这不是故障，这是配置的作用。** 但它意味着：
- "每小时/每天跑一次"的任务，**触发时刻不可预测**（在一个窗口内随机）；
- 任何"两次运行之间必须至少间隔 X"的假设都不成立；
- 任何"日志里的时间戳看起来不规律 = 出问题了"的判断都是误判；
- 反过来，**依赖这一点可以让负载摊平**（`man-db.timer` 的 `RandomizedDelaySec=12h` 是 Ubuntu 有意为之，避免全网同一秒打 apt/man 页面）。

★ 推论（重要）：`apt-daily.timer` 用 `OnCalendar=*-*-* 6,18:00` + `RandomizedDelaySec=12h`。两次名义锚点相隔 12 小时，而每边又各有最多 12 小时的随机延迟 → **两次实际触发可以被挤到相邻时段，也可能在一天里几乎同时发生**。"一天装两次"以及"apt 什么时候跑的说不准"，是配置的必然结果。

### 2.5 【陷阱 E】睡眠/休眠期间错过的触发，最多补一次

`systemd.timer(5) · OnCalendar=` 原文：

> When a system is temporarily put to sleep (i.e. system suspend or hibernation) the realtime clock does not pause. When a calendar timer elapses while the system is sleeping it will not be acted on immediately, but once the system is later resumed **it will catch up and process all timers that triggered while the system was sleeping. Note that if a calendar timer elapsed more than once while the system was continuously sleeping the timer will only result in a single service activation.**

→ 睡 8 小时、错过 8 次 hourly 任务，**恢复后只跑 1 次**。

同一节还给出 `WakeSystem=`：

> If WakeSystem= (see below) is enabled a calendar time event elapsing while the system is suspended will cause the system to wake up (under the condition the system's hardware supports time-triggered wake-up functionality).

★ **对 WSL2 的含义（本项目所在环境）**：Windows 主机睡眠/休眠时，WSL2 虚拟机不执行任何 systemd timer；`wsl --shutdown` 会直接结束整个 VM。所以"每 15 分钟跑一次"在笔记本上**天然不可靠**。这不是 systemd 的 bug，是宿主生命周期问题。（WSL 侧的官方依据见 §8 待补 —— 目前只有机制推理，没有找到权威文档，故不作为结论。）

### 2.6 【陷阱 F】`Persistent=` 只补一次，而且"持久化不清"

`systemd.timer(5) · Persistent=`：

> If true, the time when the service unit was last triggered is stored on disk. When the timer is activated, the service unit is triggered immediately if it would have been triggered **at least once** during the time when the timer was inactive. ... Note that this setting only has an effect on timers configured with OnCalendar=. Defaults to false.

→ "至少一次" = **无论错过多少次，只补一次**。它保证"不漏"，不保证"补齐"。

★ 持久化不清（`systemd.timer(5) · Persistent=` 同一小节）：

> Use `systemctl clean --what=state ...` on the timer unit to remove the timestamp file maintained by this option from disk. **In particular, use this command before uninstalling a timer unit.**

→ 时间戳文件是 systemd 的隐藏状态。它会造成的现象：
- 重新部署/改名后第一次 enable，**立刻触发一次**（因为"上次触发"是空的或很久以前）；
- 或者反过来：预期它补跑，却因为时间戳是新的而不跑；
- 卸载不做 `systemctl clean` → 下次装回来带着旧时间戳。

`[本机文件]` 对照实例 —— **单调定时器不用 `Persistent=`**：`/lib/systemd/system/systemd-tmpfiles-clean.timer`：

```ini
[Timer]
OnBootSec=15min
OnUnitActiveSec=1d
```

它没有 `OnCalendar=` 也没有 `Persistent=`（`Persistent=` 对单调定时器本来就无效）。含义：
- 每次开机后 15 分钟跑一次；
- 之后按"上次**激活**时刻 + 1 天"重复（`OnUnitActiveSec=`：`systemd.timer(5)` "Defines a timer relative to when the unit the timer unit is activating was last activated"——**是激活时刻，不是完成时刻**）；
- 机器关机期间不积累、不补跑。

### 2.7 【陷阱 G】时钟跳变与时区（含 DST 实测）

`[实测]` 用 `systemd-analyze calendar --base-time=` 在 America/New_York 时区推演 2026 年 DST 边界。

**春季前进（2026-03-08，02:00 → 03:00，02:30 这一天不存在）**：

```
$ TZ=America/New_York systemd-analyze calendar \
      --base-time="2026-03-08 00:00:00" --iterations=2 "*-*-* 02:30:00"
Normalized form: *-*-* 02:30:00
    Next elapse: Mon 2026-03-09 02:30:00 EDT     ← 03-08 的那次被整个跳过
   Iteration #2: Tue 2026-03-10 02:30:00 EDT
```

**对照（非 DST 日）**：

```
$ TZ=America/New_York systemd-analyze calendar \
      --base-time="2026-03-07 00:00:00" --iterations=2 "*-*-* 02:30:00"
    Next elapse: Sat 2026-03-07 02:30:00 EST
   Iteration #2: Mon 2026-03-09 02:30:00 EDT     ← 同样跳过了 03-08
```

→ **春季前进那天，02:30 的定时任务静默漏跑一次，没有任何告警。** 对"每年某天跑一次"的任务，如果那天的时刻落在被跳过的区间，就是**整整一年不跑**。

**秋季回拨（2026-11-01，01:00–02:00 出现两次）**：

```
$ TZ=America/New_York systemd-analyze calendar \
      --base-time="2026-11-01 00:00:00" --iterations=2 "*-*-* 01:30:00"
    Next elapse: Sun 2026-11-01 01:30:00 EDT
   Iteration #2: Mon 2026-11-02 01:30:00 EST     ← 只触发一次，不重复
```

→ systemd 在歧义小时里**只触发一次**（选 EDT 那次）。这与某些 cron 实现会**跑两次**的行为不同（cron 的行为见 §2.9）。

**相关机制**：
- `systemd.timer(5) · OnClockChange=` / `OnTimezoneChange=`（Added in version 242，默认 false）：显式要求"CLOCK_REALTIME 相对 CLOCK_MONOTONIC 跳变"或"本地时区被修改"时触发。**默认不触发** —— 想让自治系统感知时钟异常，必须显式打开。
- 日历定时器自动获得 `After=time-set.target` / `After=time-sync.target`（`systemd.timer(5) · Default Dependencies`）："in order to avoid being started before the system clock has been correctly set"。
- `systemd.timer(5) · OnCalendar=` 明确建议无电池 RTC 的机器开 `systemd-time-wait-sync.service`。
- `systemd-time-wait-sync.service(8)`：延迟所有 `After=time-sync.target` 的 unit，直到 `systemd-timesyncd` 完成同步；其"检测内核标记时钟已同步"的路径**自我声明不可靠**，只作为兼容 ntpd/chronyd 的兜底（`systemd-time-wait-sync.service(8) · DESCRIPTION`）："this detection is not reliable and is intended only as a fallback"。

★ **对自治系统的含义**：时钟是自治系统的隐含依赖。时钟错 → timer 错 → 证书校验错 → 日志时序错 → "自愈"动作建立在错误时间上。本项目的 `clock_doctor` 正对应这一类故障（WSL2 在宿主睡眠后时钟漂移）。

### 2.8 反直觉行为清单（systemd 专属，逐条带依据）

**1. `--collect` / `CollectMode=inactive-or-failed` 不会卸载"cgroup 里还有成员"的 unit。**

因果链（三条 man page 依据串起来）：
- `systemd-run(1) · -G, --collect`："Unload the transient unit after it completed, even if it failed. ... This option is a shortcut for `--property=CollectMode=inactive-or-failed`"
- `systemd.unit(5) · UNIT GARBAGE COLLECTION` 的引用条件第 7 条：**"The unit has running processes associated with it."** —— 有进程在，unit 就被引用，不能被 GC
- `systemd.kill(5) · KillMode=`："Processes remaining alive after stop are left in their control group and **the control group continues to exist after stop unless empty**"

→ 如果 payload fork 出了活得比主进程久的子进程（后台 daemon、`&`、`nohup`、孤儿子进程），unit 的 cgroup 非空 → unit 保持 loaded → **第二次用同名 `systemd-run --unit=X` 会因"unit 名已被占用"失败**。这不是 `--collect` 失效，是"cgroup 非空"优先级更高。

配套代价（`systemd.unit(5) · CollectMode=`）：用 `inactive-or-failed` 时，"unit results (such as exit codes, exit signals, consumed resources, ...) are flushed out immediately after the unit completed, **except for what is stored in the logging subsystem**" → **退出码/信号/资源消耗等诊断信息立刻丢失，只剩日志**。对"事后复盘为什么这次失败"是净损失。

**2. 启动限流计数器会被 GC 一起清掉**（§1.2 已引）：`systemd.unit(5) · StartLimitIntervalSec=`："When a unit is unloaded due to the garbage collection logic (see above) its rate limit counters are flushed out too. This means that configuring start rate limiting for a unit that is not referenced continuously has no effect."

**3. `SuccessExitStatus=` 不改变退出码显示名**（§1.1 已引）：`systemctl status` 显示 `1/FAILURE` 但 unit 是成功的。

**4. `RuntimeMaxSec=` 对 `Type=oneshot` 无效**（§1.2 已引）。

**5. `StartLimitIntervalSec=` / `StartLimitBurst=` 属于 `[Unit]` 段，不是 `[Service]` 段。** 依据：`systemd.unit(5) · StartLimitIntervalSec=` 位于 `[UNIT] SECTION OPTIONS`，而 `systemd.service(5)` 只列表 `[Service]` 段指令。（写错段落 = 配置无效，这是很常见的搬运错误。）

**6. `RemainAfterExit=yes` + 重复 timer = 只跑一次**（§2.1 已引）。

**7. `systemctl stop` 之后再 `systemctl start` 同一个 unit，与 `systemctl restart` 不完全等价**：`SendSIGKILL=no` 时，前一次残留的进程会让新一次启动直接失败（§1.4 已引 `systemd.kill(5) · SendSIGKILL=`）。

### 2.9 同类陷阱：别的调度器（交叉验证）

#### cron（Debian/Ubuntu 的 Vixie 派生版）与 systemd 在 DST 上**行为相反**

依据：`[man]` `cron(8)`（Debian/Ubuntu `cron` 包自带的手册页）

> Special considerations exist when the clock is changed by less than 3 hours, for example at the beginning and end of daylight savings time. **If the time has moved forwards, those jobs which would have run in the time that was skipped will be run soon after the change. Conversely, if the time has moved backwards by less than 3 hours, those jobs that fall into the repeated time will not be re-run.**
> Only jobs that run at a particular time (not specified as @hourly, nor with '\*' in the hour or minute specifier) are affected. Jobs which are specified with wildcards are run based on the new time immediately.
> **Clock changes of more than 3 hours are considered to be corrections to the clock, and the new time is used immediately.**

对照表：

| 场景 | systemd `OnCalendar=`（`[实测]`，§2.7） | cron（`[man]` `cron(8)`） |
|---|---|---|
| 春季前进，任务落在被跳过的那一小时 | **静默跳过，不补跑** | **在时钟变更后不久补跑** |
| 秋季回拨，任务落在重复的那一小时 | 只跑一次（不重复） | 不重跑 |
| 时钟跳变 > 3 小时 | 未查证，不写 | 视为"时钟校正"，立即采用新时间 |
| 时/分位使用 `*` 通配符的任务 | — | **不受 DST 特殊处理影响** |

★ 三条可操作结论：
1. **"漏跑一次"这件事，两个调度器的答案相反。** 从 cron 迁到 systemd timer 时，"原本 DST 会自动补"的任务会静默变成"丢一次"。
2. **cron 有"3 小时阈值"**：小于 3 小时按 DST 特殊处理，大于 3 小时按"时钟校正"处理。**自治系统自己调时钟（大跳 NTP）会跨过这个阈值，直接改变调度语义。**
3. **同一个 crontab 里，`0 2 * * *` 与 `* 2 * * *` 在 DST 下的行为不同**（前者依赖 DST 补跑逻辑，后者不依赖）。

#### Kubernetes CronJob：三条文档化的"静默不跑"

`[URL]` https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/

**（1）错过次数超过 100 次就拒绝启动（只打一条日志）**：

> For every CronJob, the CronJob Controller checks how many schedules it missed in the duration from its last scheduled time until now. **If there are more than 100 missed schedules, then it does not start the Job and logs the error.** `too many missed start times. Set or decrease .spec.startingDeadlineSeconds or check clock skew`

文档同时澄清："This behavior is applicable for catch-up scheduling and **does not mean the CronJob will stop running**."（不是永久停，但**那一次不会跑**。）

文档给的例子：每分钟一次的 CronJob，若控制器从 `08:29:00` 停到 `10:21:00`（约 112 次 > 100），任务**不会启动**；而若 `startingDeadlineSeconds=200`，控制器只数最近 200 秒内的错过（3 次），任务仍会在 `10:22:00` 启动。

★ 这是"配置写着 every_Nh、实际很少触发"的另一个变体：**调度器自身停摆或时钟跳变，超过阈值后就静默放弃**，而错误只出现在日志里。

**（2）`concurrencyPolicy: Forbid` 是"跳过"而不是"排队"**：

> if it is time for a new Job run and the previous Job run hasn't finished yet, the CronJob **skips** the new Job run

★ 与 §2.1（systemd：target unit 还 active 就跳过）**完全同构**。两个生态对"上一次还没跑完"的处理都是**静默跳过** —— 这不是某个实现的疏忽，而是这一类系统的一致设计选择。

**（3）挂起期间的错过会被计为 missed，解除后立刻补跑**：

> **Executions that are suspended during their scheduled time count as missed Jobs.** When .spec.suspend changes from true to false on an existing CronJob without a starting deadline, **the missed Jobs are scheduled immediately.**

★ 与 systemd `Persistent=true` 的"只补一次"不同，这里可能**立刻补跑多个** → 恢复瞬间的负载尖峰。

**另外两条容易忽略的**：
- **`startingDeadlineSeconds < 10` 可能根本不调度**："This is because the CronJob controller checks things every 10 seconds."
- **时区**：不设 `.spec.timeZone` 时，按 **kube-controller-manager 的本地时区**解释（不是 UTC）；`.spec.timeZone` 自 v1.27 稳定。
- 文档明说 "the Jobs that you define should be **idempotent**" —— 与 §5 的检查点/幂等要求一致。

#### Windows Task Scheduler / 其它调度器

未查证，不写。

---

## 3. 必须回答之问二：单机自治的边界（哪些事一台机器做不到）

不粉饰版的一句话结论：**一台机器能自治的是"进程级故障"，不能自治的是"机器级故障"和"需要外部视角的判断"。** 下面逐条给依据。

### 3.1 "整机死亡"本机救不了

**"整机死亡"本机救不了 —— 唯一原生手段是硬件看门狗，而它只能重启、不能修复。**

`systemd-system.conf(5) · RuntimeWatchdogSec=, RebootWatchdogSec=, KExecWatchdogSec=`：

> Configure the hardware watchdog at runtime and at reboot. ... If RuntimeWatchdogSec= is set to a non-zero value, the watchdog hardware (/dev/watchdog0 or the path specified with WatchdogDevice= or the kernel option systemd.watchdog-device=) will be programmed ...

- 这意味着：**systemd 本身可以是被看门狗监视的对象**（systemd 挂死 → 硬件复位）。
- 边界：需要 `/dev/watchdog` 硬件支持；看门狗只能"复位"，不能判断"复位后能不能起来"；复位后的启动环（坏配置/坏引导）本机无解。
- 对 WSL2：虚拟机内**没有**真实硬件看门狗可用 → 这一层保护在本项目环境下**完全不存在**。

（未查证：BMC/IPMI 作为"真正的外部复位"的具体文档、A/B 引导自愈的细节 —— **不写**。）

### 3.2 单节点没有 fencing，无法区分"我健康"和"我是唯一幸存者"

`[URL]` Pacemaker Explained · 8.2 *Why Is Fencing Necessary?* — https://clusterlabs.org/pacemaker/doc/2.1/Pacemaker_Explained/html/fencing.html

> Fencing protects your data from being corrupted by malfunctioning nodes or unintentional concurrent access to shared resources. Fencing protects against the "split brain" failure scenario, where cluster nodes have lost the ability to reliably communicate with each other but are still able to run resources. **If the cluster just assumed that uncommunicative nodes were down, then multiple instances of a resource could be started on different nodes.**

同节第二条用途（很少有人引用，但对单机极其相关）：

> Fencing is also used when a resource cannot otherwise be stopped. **If a resource fails to stop on a node, it cannot be started on a different node without risking the same type of conflict as split-brain.**

★ 对单机的含义：**没有第二个节点来 fence 我，"停不掉的资源"就只能由我自己保证停掉。** 单机世界里 fencing 的替代品只有一个 —— cgroup（`KillMode=control-group` + 非空 cgroup 的后果，见 §1.4 / §2.8）。也就是说：**"停不掉"这件事在单机上会直接变成"起不来"**，这就是 `--collect` 那个坑的本质。

### 3.3 恢复路径几乎从不被执行，所以会腐烂

`[URL]` Candea & Fox, *Crash-Only Software*, HotOS 2003 — https://www.usenix.org/legacy/events/hotos03/tech/full_papers/candea/candea.pdf

> **Crash-only programs crash safely and recover quickly. There is only one way to stop such software—by crashing it—and only one way to bring it up—by initiating recovery.**

论文对"干净关闭 vs 崩溃恢复"两套代码的批评（原文）：

> In the face of inevitable crashes, such a file system turns out to be brittle: a crash can lose data and, in some cases, the post-crash inconsistency cannot even be repaired. Not only do such performance tradeoffs impact robustness, but they also **lead to complexity by introducing multiple ways to manipulate state, more code, and more APIs.**

★ 核心论点：**"干净关闭"路径和"崩溃恢复"路径是两套代码，而通常只有一套会被经常执行。** 推论：让"恢复"成为**唯一**的启动路径（crash-only），恢复路径就会天天被执行，不会腐烂。

对自治系统的含义：**任何"只在异常时才走"的自愈分支，几乎肯定没被测过。** 自愈逻辑应当被设计成"每次启动都走"的主路径，而不是异常分支。

### 3.4 灾难性故障的主因是错误处理，不是硬件

`[URL]` Yuan et al., *Simple Testing Can Prevent Most Critical Failures*, OSDI 2014 — https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf
（样本：HDFS / Hadoop MapReduce / HBase / Cassandra / Redis 上 **198 个随机抽样的真实故障**；其中 73 个被手工复现。）

> almost all (**92%**) of the catastrophic system failures are the result of **incorrect handling of non-fatal errors** explicitly signaled in software.

> in **58%** of the catastrophic failures, the underlying faults could easily have been detected through simple **testing of error handling code**.

> in **35%** of the catastrophic failures, the faults in the error handling code fall into three trivial patterns: **(i) the error handler is simply empty or only contains a log printing statement**, (ii) the error handler aborts the cluster on an overly-general exception, and (iii) ...

> in 76% of the failures, the system emits explicit failure messages; and in **84%** of the failures, all of the triggering events that caused the failure are printed into the log before failing.

★ 直接映射到"无人值守自治运维"：

1. **模式 (i) —— "错误处理器是空的，或者只是打了一条日志" —— 被这篇论文列为三大致命模式之一。** 这恰好就是"只报告不动手"的形态。这不是说报告没用，而是说：**报告之后如果没有明确的处理动作，在故障学意义上等同于没处理。**
2. **92% 是"非致命错误被处理错"** —— 敌人不是"机器坏了"，而是"错误被处理错了"。**机器级故障的自治空间有限，错误处理的质量完全可控。**
3. **84% 的失败，触发事件在失败前已经写进日志** —— 复盘时应该先读日志，而不是先怀疑硬件。

### 3.5 "不要自动化那一步"是一种成熟立场（真实公司案例）

**GitHub 2018-10-21**（43 秒的网络分区 → 24 小时以上的降级）：
`[URL]` https://github.blog/news-insights/company-news/oct21-post-incident-analysis/

> Guarding the confidentiality and integrity of user data is GitHub's highest priority. In an effort to preserve this data, we decided that the 30+ minutes of data written to the US West Coast data center prevented us from considering options other than failing-forward in order to keep user data safe.

> In other words, our strategy was to **prioritize data integrity over site usability and time to recovery**.

★ 这是"自治系统不该自动执行某些恢复动作"的最强论据：**自动 failover 会造成数据不一致，所以宁可降级 24 小时也不自动切。** 单机自治同理：**能自动执行的动作集合，必须严格小于"能执行的动作"集合**；且这个差集要有明确的、人能看懂的升级路径。

**Cloudflare 2019-07-02**（一条自己的 WAF 规则 → 全球 27 分钟中断）：详见 §6.7(a)。其中"我们自己的控制台也挂了，进不去"这一条，直接说明**急停开关不能依赖被它关停的系统**。

### 3.6 监控通道本身会挂 —— 需要"死人开关"

- `[URL]` Prometheus Operator runbooks · **Watchdog** — https://runbooks.prometheus-operator.dev/runbooks/general/watchdog/
  Watchdog 是"永远处于 firing 状态的告警"，它的唯一用途是**检测告警链路本身是否还活着**（如果连它都不响，说明监控/通知链路断了，而不是"一切正常"）。
- 结构性原因：**报告通道与被监控对象共享同一个失效域**（同一台机器、同一个网络、同一个进程）。单机上不存在"绝对可靠的自检" —— 这是单机自治的**硬边界**，不是工程水平问题。

★ 对 dsh-steward 的含义：一个"每 15 分钟报告一次"的 timer，如果**没有**"它自己没跑也要有人知道"的机制，那么"它没跑"和"一切正常"在观测上是**同一个现象**。这正是 §5.3 事故中"9 小时 24 分没人发现"的结构。

### 3.7 数据层：SQLite 的自我定位

`[URL]` SQLite · *Appropriate Uses For SQLite* — https://sqlite.org/whentouse.html

> SQLite does not compete with client/server databases. **SQLite competes with fopen().**

> Clients and servers ... Because an SQLite database **requires no administration**, it works well in devices that must operate **without expert human support**.

★ 对单机的含义：SQLite 是"无人值守设备"的正确选择（零管理），但它**不是**高可用方案 —— 该页 *Situations Where A Client/Server RDBMS May Work Better* 一节明确列出它的边界（网络访问、高并发写）。**单机 + SQLite 的复制/故障切换不在 SQLite 的范围内。**

### 3.8 汇总：单机能做 / 不能做

| 能力 | 单机 | 依据 |
|---|---|---|
| 进程崩溃后自动重启 | ✅ | `systemd.service(5) · Restart=`（注意 `StartLimitBurst` 会停摆，§1.2） |
| 进程"活着但不干活" | ✅ | `systemd.service(5) · WatchdogSec=`（需程序支持 `sd_notify`） |
| 任务卡死超时 | ✅ | `RuntimeMaxSec=`（**对 oneshot 无效**） |
| 整机挂死 | ⚠️ 只能硬件复位 | `systemd-system.conf(5) · RuntimeWatchdogSec=`；**WSL2 内无此能力** |
| 断电 / 磁盘损坏 / 引导损坏 | ❌ | 需外部手段（细节未查证，不写） |
| 数据损坏的**检测** | ✅（但要主动做） | 校验和 + 恢复演练，§5.2 |
| 判断"我是不是唯一幸存者" | ❌ | 没有第二个节点，Pacemaker §8.2 |
| 与另一副本的脑裂仲裁 | ❌ | 同上 |
| 停不掉的资源 | ⚠️ 只有 cgroup 兜底 | `systemd.kill(5) · KillMode=`（§1.4） |
| 可靠的对外告警 | ❌（同失效域） | Watchdog / dead-man's-switch，§3.6 |

---

## 4. 必须回答之问三：本地优先（local-first）的具体做法

★ 先说一条负面结果（纪律要求）：local-first 的经典论文 *Local-First Software*（Ink & Switch）我抓到了页面（https://www.inkandswitch.com/local-first/ ，HTTP 200），但该页是前端渲染，**我拿不到正文**，因此**不引用它的任何具体主张**。本节全部结论改为引用能拿到正文的来源。

### 4.1 原则：外部依赖应当是"可替换的挂载资源"

`[URL]` The Twelve-Factor App · *Backing services* — https://12factor.net/backing-services （已逐字核对正文）

> A backing service is any service the app consumes **over the network** as part of its normal operation.
> ... It **makes no distinction between local and third party services**. To the app, both are attached resources, accessed via a URL or other locator/credentials **stored in the config**. A deploy of the twelve-factor app should be able to **swap out a local MySQL database with one managed by a third party** ... without any changes to the app's code.

★ "**makes no distinction between local and third party services**" 这一句就是 local-first 的工程定义：本地与远程的差别应当**只在配置里**，不在代码里。

★ 对自治系统的直接应用：**"远程 LLM API"和"本地 Ollama"应当是同一个接口的两个 backing service。** 断网时降级到本地模型（能力下降但仍能跑），而不是直接失败。这是"本地优先"在 agent 系统里最重要的落地形式 —— 它不是一个数据存储问题，而是一个**依赖可替换性**问题。

### 4.2 数据本地化

| 对象 | 做法 | 依据 |
|---|---|---|
| Git 仓库 | `git bundle` 打成单一归档，在无 server 的对端 clone/fetch | `[man]` `git-bundle(1)`：**"'offline' transfer of Git objects without an active 'server' sitting on [the other end]"** |
| apt 包 | `apt-get install -d`（`--download-only`）只下载不安装；`--print-uris` 只打印 URL 以便离线搬运 | `[man]` `apt-get(8)`：`-d, --download-only` / `--print-uris` |
| 容器镜像 | `docker save` → 传文件 → `docker load` | `[URL]` https://docs.docker.com/reference/cli/docker/image/save/ |
| Node 依赖 | `npm ci`（严格按 lockfile 安装，可复现） | `[URL]` https://docs.npmjs.com/cli/v10/commands/npm-ci |
| Python 依赖 | 哈希锁定安装（防依赖被替换/降级攻击） | `[URL]` https://pip.pypa.io/en/stable/topics/secure-installs/ |

★ "可复现安装"本身就是一种本地优先：**锁定版本的唯一意义，是让"今天能跑"和"断网三个月后还能跑"是同一件事。**

### 4.3 模型本地化

`[URL]` Hugging Face `huggingface_hub` 环境变量 — https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables · `HF_HUB_OFFLINE`

> If set, **no HTTP calls will be made to the Hugging Face Hub**. If you try to download files, only the cached files will be accessed. **If no cache file is detected, an error is raised**

> Note: **even if the latest version of a file is cached, calling hf_hub_download still triggers a HTTP request** to check that a new version is available

★ 两条可操作结论：
1. `HF_HUB_OFFLINE=1` 是**硬离线开关**：不会偷偷回退到网络，缺文件就**立刻报错**。这种"明确失败"比"卡在网络超时里"好得多 —— **离线系统的第一需求是可预测的失败，而不是尽力而为。**
2. **"文件已经在本地" ≠ "不会联网"**：默认每次调用仍会发 HTTP 请求去查新版本。所以要真离线，必须显式设 `HF_HUB_OFFLINE=1`。

`[URL]` Ollama FAQ — https://docs.ollama.com/faq

> **Ollama pulls models from the Internet** and may require a proxy server
> ... create a new variable for your user account for `OLLAMA_HOST`, `OLLAMA_MODELS`, etc.

★ 含义：**首次拉取模型需要网络，拉完之后推理是纯本地的**；`OLLAMA_MODELS` 决定模型存在哪（换盘/迁移时靠它）。所以"本地优先"不是"永不联网"，而是"**联网只发生在明确的准备阶段**"。

### 4.4 时间与证书：离线环境里最先坏掉的东西（而且最容易被忽略）

- **时间**：`[man]` `systemd-timesyncd.service(8)` —— "synchronizes the local system clock with a remote Network Time Protocol (NTP) server"，且 **"implements SNTP only"（不是完整 NTP 实现）**。断网时它无法校时 → 依赖时钟的一切（timer、证书校验、日志时序）开始漂移。无电池 RTC 的机器应当开 `systemd-time-wait-sync.service`（§2.7）。
- **证书**：`[URL]` Let's Encrypt FAQ — https://letsencrypt.org/docs/faq/
  > Our default certificates are valid for **90 days**. ... Subscribers can opt in to short-lived certificates which are valid for **six days**. **There is no way to adjust these lifetimes, there are no exceptions.** We recommend renewing 90 day certific[ates]...

  ★ 对离线机器的含义：**本地服务的证书是一个 6–90 天的定时炸弹，而且期限不可调。** 内网/离线服务应该用自签 CA（长有效期）或干脆不套 TLS，而不是套用公网 CA 的短周期证书。**"自动续期"这条依赖链在离线环境里本身就是断的** —— 依赖它等于把服务的存活期绑定在网络上。

### 4.5 断网时哪些还能跑（按依赖分层，而不是按功能分层）

| 层 | 断网后 | 依据 |
|---|---|---|
| 本地推理（已下载的模型） | ✅ | `docs.ollama.com/faq`（拉取需要网络，推理不需要） |
| 本地数据（SQLite / 文件） | ✅ | `sqlite.org/whentouse.html`（"requires no administration"） |
| 依赖已锁定 / 已 vendored | ✅ | `npm ci`；pip hash-checking（§4.2） |
| 远程 LLM API | ❌ | 需 §4.1 的"backing service 可切换"设计来降级 |
| DNS 解析新域名 | ❌ | 缓存策略细节未查证 → **不写** |
| TLS 证书已过期 | ❌ | `letsencrypt.org/docs/faq`（期限不可调） |
| 系统时钟未同步 | ⚠️ 部分可用 | `systemd-timesyncd.service(8)` |

### 4.6 对 dsh-steward 的落地结论

1. **把"远程 API"与"本地模型"做成同一接口的两个 backing service**（§4.1）：断网时降级到本地小模型，而不是直接失败。
2. **准备阶段联网，运行阶段离线**：模型/包/镜像在准备时拉齐；运行时用 `HF_HUB_OFFLINE=1` + `npm ci` + 哈希锁定做**硬离线**。硬离线开关的价值是"**明确失败**"，不是"尽力而为"（§4.2–4.3）。
3. **不要把需要续期的公网 TLS 证书放进离线链路**（§4.4）。
4. **时钟要当成显式依赖管理**（§4.4 + §2.7）：这是本项目 `clock_doctor` 存在的理由。

---

## 5. 必须回答之问四：长跑任务的检查点与断点续跑

### 5.1 检查点该怎么设计（三条硬规则）

**规则 1：先落盘，再继续（write-ahead）。**
副作用之前先写意图/进度。这是数据库领域最老的规则，有权威依据（WAL 的引入动机与规则）：

- `[URL]` PostgreSQL 文档 *Write-Ahead Logging (WAL)* — https://www.postgresql.org/docs/17/wal-intro.html
- `[URL]` SQLite *Atomic Commit In SQLite* — https://sqlite.org/atomiccommit.html

**规则 2：落盘必须是原子的，否则检查点本身会成为损坏源。**

- `[man]` `rename(2)`：同一文件系统内 `rename()` 是原子替换 —— "write temp file → fsync → rename → fsync 父目录"是标准做法。
- `[man]` `fsync(2)`：**只 fsync 文件不够，父目录项也需要 fsync 才真正持久**。
- `[URL]` LWN *Ensuring data reaches disk* — https://lwn.net/Articles/457667/
- `[URL]` Dan Luu *Files are hard* — https://danluu.com/file-consistency/ （"看起来正确的文件操作代码，在崩溃下经常是错的"）
- `[URL]` SQLite *How To Corrupt An SQLite Database File* — https://sqlite.org/howtocorrupt.html

**规则 3：检查点必须记"效果已发生"，而不只是"我读到第几页"。**
否则恢复后要么丢工作量、要么重复产生副作用。需要**幂等**：

- `[URL]` Apache Kafka 文档 · Delivery Semantics — https://kafka.apache.org/documentation/ （at-least-once 是默认语义，恰好一次要靠幂等/事务）

### 5.2 怎么验证检查点真的能续上（而不是"应该能"）

核心原则：**没被恢复过的检查点不算检查点。** 验证方式必须走**真实的恢复路径**，而不是"代码里写了解析逻辑"。

- `[URL]` SQLite `PRAGMA integrity_check` — https://sqlite.org/pragma.html#pragma_integrity_check
- `[URL]` PostgreSQL `pg_verifybackup` — https://www.postgresql.org/docs/17/app-pgverifybackup.html
- `[URL]` restic `check --read-data` — https://restic.readthedocs.io/en/stable/045_working_with_repos.html
- `[URL]` *Principles of Chaos Engineering* — https://principlesofchaos.org/
- `[URL]` Google SRE Book · Data Integrity — https://sre.google/sre-book/data-integrity/

**最低成本的验证手段（本项目可立即采用）：在恢复路径上做"随机时刻 kill -9"演练。** 即：任务跑到任意进度时被 SIGKILL，然后从检查点重跑，断言"最终结果与不中断时一致，且没有重复副作用"。这正是 §5.3 事故的直接补丁。

下面这个校验器把"检查点能不能续上"变成一条可进 CI 的命令：它读追加式 JSONL 检查点，**识别被写坏的最后一行**（进程在 write 中途被杀），并打印出"能安全续跑的位置"。核心设计点全部对应 §5.1 的三条规则：追加式、能识别撕裂、能独立读出进度。

```python
#!/usr/bin/env python3
"""verify_checkpoint.py —— 校验追加式 JSONL 检查点能否安全续跑。

用法:
    python3 verify_checkpoint.py <checkpoint.jsonl>

退出码:
    0 = 检查点可用, 打印 "RESUME_AT=<n>"
    2 = 文件不存在
    3 = 不是撕裂, 而是中段损坏（比最后一行坏更严重, 必须人工介入）
"""
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # 硬性要求: 中文/损坏字节不炸

import json
import os
import hashlib


def load_checkpoint(path):
    """返回 (good_records, verdict)。verdict ∈ {'ok','torn_tail','corrupt_middle'}"""
    if not os.path.exists(path):
        return None, 'missing'
    with open(path, 'rb') as fh:                      # 二进制读: 避免半行触发解码异常
        lines = fh.read().split(b'\n')
    while lines and not lines[-1].strip():            # 去掉文件末尾的空行
        lines.pop()

    good, first_bad = [], None
    for idx, line in enumerate(lines):
        try:
            good.append(json.loads(line.decode('utf-8')))
        except (json.JSONDecodeError, UnicodeDecodeError):
            first_bad = idx
            break

    if first_bad is None:
        return good, 'ok'

    # 关键判断: 坏行之后还有没有"能解析的行"?
    #   有  -> 中段损坏（中间丢过记录, 不能自动续跑）
    #   没有 -> 只是最后一行被写坏（安全丢弃）
    for line in lines[first_bad + 1:]:
        if not line.strip():
            continue
        try:
            json.loads(line.decode('utf-8'))
            return good, 'corrupt_middle'
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    return good, 'torn_tail'


def verify_chain(records):
    """检查每条记录的 seq 递增、且 prev_digest 指向上一条的 digest。

    这是"检查点是否可续"的核心断言：如果链断了, 说明中间丢过记录,
    从断点续跑会漏掉工作（比重复更危险）。
    """
    prev = None
    for i, rec in enumerate(records):
        if rec.get('seq') != i:
            return False, 'seq_mismatch@%d' % i
        if prev is not None and rec.get('prev_digest') != prev:
            return False, 'chain_break@%d' % i
        prev = rec.get('digest')
    return True, 'ok'


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 64
    path = argv[1]
    records, verdict = load_checkpoint(path)
    if verdict == 'missing':
        print('ERROR: checkpoint not found: %s' % path)
        return 2

    print('CHECKPOINT=%s' % path)
    print('VERDICT=%s' % verdict)
    print('RECORDS=%d' % len(records))

    if verdict == 'corrupt_middle':
        print('REFUSE: 中段损坏, 不能自动续跑（需要人工判断）')
        return 3

    ok, why = verify_chain(records)
    print('CHAIN=%s (%s)' % ('ok' if ok else 'broken', why))
    if not ok:
        print('REFUSE: 链断, 续跑会漏工作')
        return 3

    print('RESUME_AT=%d' % len(records))   # 下一步应当从这里开始
    if verdict == 'torn_tail':
        print('NOTE: 最后一行撕裂（进程在写中途被杀）, 已丢弃; 本次最多损失一条记录')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
```

★ 这份脚本刻意体现的四个检查点设计决定（每条都有 §5.1 的依据）：

1. **追加式（append-only）**：撕裂只可能发生在最后一行 → 损失上界是一条记录，而不是整个文件。
2. **二进制读 + 逐行解析**：半行 JSON 不会让校验器自己崩掉（校验器崩了就等于没有校验器）。
3. **`prev_digest` 哈希链**：能区分"撕裂的最后一行"（可安全丢弃）和"中段丢失"（**必须拒绝续跑** —— 因为少一条记录 = 漏掉一份工作，比重复执行更危险）。
4. **`RESUME_AT` 可被外部读取**：检查点的进度必须是**外部可读的**，否则没法在 CI 里断言"恢复到正确位置"。这正是"没被恢复过的检查点不算检查点"的落地形式（§5.2 开头）。

### 5.3 【第一手】本次中断就是检查点缺失的活样本

**事实时间线**（`[第一手]`，由 lead 提供，非公开来源）：

```
2026-09-28 23:32   四个调研员被 spawn，开始工作
2026-09-28 23:36   lead 为改一个配置，发起 dsh 重启
2026-09-28 23:41   重启完成
                   ★ 四个正在工作的队员全部被杀，工作丢失（无检查点）
2026-09-29 08:59   lead 才发现，手工唤醒它们
                   ★ 中间 9 小时 24 分，四个名额挂着"死了但占位"
```

**损失**：约 2 小时的调研阅读（4 个并行调研员，全部归零，包括已经读过的来源和已经形成的结论）。

**用 systemd 的概念解释这次事故的机制**（这部分有 man page 依据）：

1. **`KillMode=control-group` 是默认值**（`systemd.kill(5)`）：停止一个 unit = 杀掉它的**整个 cgroup**。`dsh` 重启 = 杀掉 dsh 这个 unit 的 cgroup 里的所有进程，**包括它 spawn 出来的队员进程**。子进程不会因为"逻辑上独立"而幸免 —— 除非它们在**另一个 cgroup**（另一个 unit）里。
2. **在飞的工作只在进程内存里**。durable 的部分（邮箱、任务板的 claim 状态）落了盘，但"读过的页面 / 形成的判断"没有 → 进程死 = 工作死。这是 Twelve-Factor 的 *Processes* 一节的直接违反：`[URL]` https://12factor.net/processes （"12-factor processes are stateless and share-nothing. Any data that needs to persist must be stored in a stateful backing service"）。
3. **"挂了 9 小时没人知道" = 缺 liveness 检测**。systemd 侧的对应物是 `WatchdogSec=`（进程活着但无进展）与 `RuntimeMaxSec=`（跑太久）；编排侧的对应物是心跳 + 租约 + 超时回收。**"inactive" 状态被误读成"没事"**，与 §2.1 的"timer 静默跳过"是同一种故障：**没有错误 ≠ 一切正常**。

#### 答案 1：检查点怎么设计，才能让"被杀"最多损失一小段？

| 设计点 | 做法 | 依据 |
|---|---|---|
| **粒度** | 以"可独立验证的最小结论单位"为检查点，**不是以阶段为单位**。本项目场景 = **每读到一个来源就 append 一行到磁盘**。损失上界 = 读一个来源的时间（分钟级），而不是 2 小时 | §5.1 规则 1 |
| **顺序** | 先落盘再继续；禁止"先在脑子里攒着，最后一并写" | WAL 规则，`[URL]` postgresql.org/docs/17/wal-intro.html |
| **原子性** | 追加式（append-only）比"全量重写状态文件"更抗中断：撕裂只损坏最后一行；但要能识别最后一行不完整（长度前缀或校验和） | `[man]` `fsync(2)`、`rename(2)`；`[URL]` lwn.net/Articles/457667/ |
| **幂等** | 检查点记录"这件事已经做过"；恢复后重跑不得产生重复副作用 | `[URL]` kafka.apache.org/documentation（Delivery Semantics） |
| **可验证** | 检查点必须能被**独立读取并解析**（一条命令打印出"我现在到哪了"），且这条命令要进 CI | `[URL]` principlesofchaos.org |
| **有界** | 检查点自己不能无限增长（见 §6） | `journald.conf(5) · SystemMaxUse=` 是成熟解 |

★ 最小可行版（本项目的下一次迭代）：**把调研员的输出从"最后一次性汇报"改成"每读一个来源就 append 到产出文件"**。这正是 lead 本次新增的要求，它就是检查点设计的第一条。

#### 答案 2：systemd 有没有更合适的做法？

**（a）把长任务做成独立 unit —— 让 dsh 重启打不到它。**

`systemd-run --unit=<name> --collect ... <command>` 创建的是**系统管理器（PID 1）的子 unit**，不是调用者的子进程 → 调用者（dsh）被杀，**不影响它**。依据：`[man]` `systemd-run(1)`（`--unit=` 指定名字，`-G/--collect` 完成后卸载）。

★ 但必须同时处理 §2.8 的坑：如果 payload fork 出后台子进程，cgroup 非空 → `--collect` 收不干净 → **同名 unit 第二次创建失败**。所以要么让 payload 不要 daemonize，要么显式用 `systemctl stop`/`reset-failed` 收尾。

★ 边界：transient unit **不跨 reboot**（它在内存里）。要跨重启，必须写成真正的 `.service` + `.timer` 落盘到 `/etc/systemd/system/`，用 `StateDirectory=` 存进度。

**（b）`Type=notify` + `WatchdogSec=`：解决的是另一个故障，不是这个。**

必须区分两类故障，二者**不可互相替代**：

| 故障 | 机制 | systemd 手段 |
|---|---|---|
| 进程**死了** | 退出/被杀 | `Restart=` + `StartLimitBurst=`（小心 §1.2 的停摆） |
| 进程**活着但不干活** | 死锁、无限等待、卡在 IO | `WatchdogSec=`（需 `sd_notify(WATCHDOG=1)`） |
| 进度**丢了** | 进程被杀，内存里的工作没了 | **只有检查点能解决 —— 没有 systemd 开关能替代** |
| 任务**永远跑不完** | 无超时 | `RuntimeMaxSec=`（注意 oneshot 无效）、`EXTEND_TIMEOUT_USEC=` 续期 |

依据：`[man]` `systemd.service(5) · WatchdogSec=` / `RuntimeMaxSec=`；`sd_notify(3)`。

**（c）做得更细一点：`Type=notify` 的长任务用 `EXTEND_TIMEOUT_USEC=` 一边报平安一边续命**（`systemd.service(5) · RuntimeMaxSec=`），比把超时设为 `infinity` 更安全。

#### 答案 3：重启类操作的"排空（drain）"—— 别人怎么做？

**（a）关机/重启场景：logind 的 inhibitor 锁，但默认只给 5 秒。**

- `[man]` `systemd-inhibit(1)`：`--what=shutdown` 可以"block or delay"关机/重启请求；`--list` 可列出当前持锁者。
- `[man]` `logind.conf(5) · InhibitDelayMaxSec=`："Specifies the maximum time a system shutdown or sleep request is delayed due to an inhibitor lock of type 'delay' being active **before the inhibitor is ignored and the operation executes anyway. Defaults to 5.**"

→ **单机上原生存在"先落盘再重启"的机制，但默认窗口只有 5 秒。** 要让在飞任务有时间落盘，必须显式调大 `InhibitDelayMaxSec=`，并且任务自己要取 inhibitor 锁。

**（b）配置变更场景：能用 reload 就不要 restart。**

- `[man]` `systemctl(1) · daemon-reload`："Reload the systemd manager configuration. This will rerun all generators, reload all unit files, and recreate the entire dependency tree. While the daemon is being reloaded, all sockets systemd listens on behalf of user configuration will stay accessible."
- `[man]` `systemctl(1) · daemon-reexec`："Reexecute the systemd manager. This will serialize the manager state, reexecute the process and deserialize the state again. ... Sometimes, it might be helpful as a heavy-weight daemon-reload."（同样**不杀服务**）

→ **本次事故的根因之一**：为了改一个配置，用了"全量重启"这一**最重的操作**。在 systemd 的世界里，改配置通常只需 `daemon-reload`；换二进制才需要 `daemon-reexec`；**都不需要杀业务进程**。自治系统的"自更新"必须区分这三档，并且默认选最轻的一档。

**（c）停进程的两段式：SIGTERM → 等 `TimeoutStopSec=` → SIGKILL。**
依据 `[man]` `systemd.kill(5)`。这是"先请求后强制"的标准模式。★ 但 `SendSIGKILL=no` 时若前一次进程还在 cgroup 里，会导致**无法重启**（`systemd.kill(5) · SendSIGKILL=`，§1.4 已引）—— 又一次撞上同一个坑。

**（d）业界等价物（待核对后补 URL）**：Kubernetes 的 `terminationGracePeriodSeconds` + `preStop` hook + `PodDisruptionBudget` + `kubectl drain`；Docker `docker stop` 的 SIGTERM→超时→SIGKILL。

**（e）对 agent 编排的要求（从 (a)-(d) 推出，本项目可直接执行）**：一个"重启编排器"的动作必须做到：
1. **先停止派发新任务**（cordon / drain）；
2. **给在飞任务发"请落盘并退出"信号**（≈ SIGTERM）；
3. **等待落盘确认，或等到超时**（≈ `TimeoutStopSec=` / `InhibitDelayMaxSec=`）；
4. **才杀**（≈ SIGKILL）；
5. **重启后从检查点恢复，并把"未完成"的任务重新入队**（≈ `Persistent=` 的补跑语义，但要注意它只补一次）。

缺任意一环，就是本次这场 9 小时 24 分的事故。

---

## 6. 必须回答之问五：自我撑爆（日志/缓存/临时文件）

本节从"机制"和"真实事故"两侧各查一遍：机制来自 systemd/Docker 官方文档（§6.1–6.6），事故来自 Cloudflare / GitLab / CrowdStrike 的官方复盘（§6.7）。

### 6.1 journald 的边界是"软"的

`[man]` `journald.conf(5) · SystemMaxUse=, SystemKeepFree=, RuntimeMaxUse=, RuntimeKeepFree=`：

> SystemMaxUse= and RuntimeMaxUse= control how much disk space the journal may use up at most. SystemKeepFree= and RuntimeKeepFree= control how much disk space systemd-journald shall leave free for other uses. systemd-journald will respect both limits and use **the smaller of the two values**.

> The first pair defaults to **10%** and the second to **15%** of the size of the respective file system, but each value is **capped to 4G**.

★ **关键漏洞（同一小节）**：

> If the file system is nearly full and either SystemKeepFree= or RuntimeKeepFree= are violated when systemd-journald is started, the limit will be raised to the percentage that is actually free. This means that if there was enough free space before and journal files were created, and subsequently something else causes the file system to fill up, **journald will stop using more space, but it will not be removing existing files to reduce the footprint again, either.** Also note that **only archived files are deleted** to reduce the space occupied by journal files. This means that, in effect, **there might still be more space used than SystemMaxUse= or RuntimeMaxUse= limit after a vacuuming operation is complete.**

→ 三条推论，对"自治系统自己撑爆自己"非常关键：
1. **journald 的限额不是硬保证**：`SystemMaxUse=` 是"上限指引"，实际可能超出。
2. **磁盘被别人占满时，journald 不会回头删自己的旧文件**去腾空间。
3. `journalctl --vacuum-size=` 之后**仍可能超过设定值**（因为只删 archived 文件）。

清理命令：`[man]` `journalctl(1) · --vacuum-size=, --vacuum-time=, --vacuum-files=`。存储位置与模式：`[man]` `journald.conf(5) · Storage=`（`auto` = 存在 `/var/log/journal` 就持久化，否则只进 `/run` 内存盘；**注意 `volatile` 模式下日志占的是内存**）。

### 6.2 日志速率限制（以及它的漏洞）

- 系统级：`[man]` `journald.conf(5) · RateLimitIntervalSec=, RateLimitBurst=` —— "**Defaults to 10000 messages in 30s**"，per-service 独立计数；且**有效限额会按可用磁盘空间放大**（同一 man page 的表：`<= 1MB` ×1 … `<= 1TB` ×6）。设 0 可关闭限流。
- 单元级：`[man]` `systemd.exec(5) · LogRateLimitIntervalSec=, LogRateLimitBurst=`（v240+），覆盖系统默认值。
- ★ **漏洞**：只对**走日志子系统**的消息生效。`StandardOutput=file:/path` 这类"直写文件"**不受限流保护**（`systemd.exec(5) · LogRateLimitIntervalSec=`，§1.6 已引全文）。→ **自治 agent 如果自己写日志文件，systemd 的所有日志保护对它无效。** 这条最容易踩：`StandardOutput=append:/var/log/mine.log` 看起来更"可控"，实际是放弃了限流与轮转。

### 6.3 临时文件治理：`tmpfiles.d` 的 age 字段

`[man]` `tmpfiles.d(5)` 的字段表（`/etc/tmpfiles.d/*.conf`）：

```
d     /directory/to/create-and-clean-up   mode user group cleanup-age -
D     /directory/to/create-and-remove     mode user group cleanup-age -
e     /directory/to/clean-up              mode user group cleanup-age -
x     /path-or-glob/to/ignore/recursively -    -    -     cleanup-age -
```

- **第 5 个字段是 age（保留时长）**；写 `-` 表示**不清理**。
- `d` 创建并清理内容；`D` 还会在清理后删除目录本身；`e` 只清理不创建。
- 清理时机：`[本机文件]` `/lib/systemd/system/systemd-tmpfiles-clean.timer` = `OnBootSec=15min` + `OnUnitActiveSec=1d`（单调定时器，无 `Persistent=`，见 §2.6）。
- `PrivateTmp=`（`[man]` `systemd.exec(5) · PrivateTmp=`）给每个服务独立的 `/tmp` 与 `/var/tmp` 命名空间 → **临时文件按服务隔离，不会互相污染，也不会堆在所有服务共用的 `/tmp` 里**。

### 6.4 容器日志：默认根本没有上限

`[URL]` Docker · *json-file logging driver* — https://docs.docker.com/engine/logging/drivers/json-file/

> `max-size` The maximum size of the log before it is rolled. A positive integer plus a unit modifier ... **Defaults to -1 (unlimited).**
> `max-file` The maximum number of log files that can be present. ... **Defaults to 1.**

★ 默认配置下，**一个反复崩溃、反复刷日志的容器可以把宿主机磁盘写满**。必须显式设置 `max-size` + `max-file`。

Docker 官方给出的全局配置示例（daemon.json）：

```json
{ "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" } }
```

（同一页；注意官方提醒 daemon.json 里的 `log-opts` 值必须写成字符串。）

### 6.5 core dump：崩溃循环 × 每次写盘

`[URL]` `coredump.conf(5)`（Ubuntu 24.04 manpage）— https://manpages.ubuntu.com/manpages/noble/en/man5/coredump.conf.5.html

> When "external" (the default), cores will be stored in **/var/lib/systemd/coredump/**

> `MaxUse=`, `KeepFree=` — Enforce limits on the disk space, specified in bytes, taken up by externally stored core dumps. **MaxUse= makes sure that old core dumps are removed as soon as the total disk space taken up by core dumps grows beyond this limit**

★ 对本机环境的直接含义：一个"崩溃 → 重启 → 再崩溃"的自治任务，**每次崩溃都会往 `/var/lib/systemd/coredump/` 写一份进程内存镜像**。这台机器有 249GB 内存、跑着 GPU 相关工作，进程内存动辄数 GB —— **崩溃循环 + core dump 是把磁盘撑爆的教科书路径**。上限只有 `MaxUse=`；也可以把 `ProcessSizeMax=0` 关掉落盘。

### 6.6 内存侧：systemd 的 OOM 管理，以及"以为它在管"

- `[man]` `systemd.resource-control(5) · ManagedOOMSwap=, ManagedOOMMemoryPressure=`（取值 `auto|kill`）—— 由 systemd-oomd 依据内存压力/swap 占用主动杀进程组。
- `[man]` `systemd.service(5) · OOMPolicy=` —— 取值默认来自 `systemd-system.conf(5) · DefaultOOMPolicy=`。
- `[URL]` `systemd-oomd.service(8)`（Ubuntu 24.04 manpage）— https://manpages.ubuntu.com/manpages/noble/en/man8/systemd-oomd.service.8.html ："A userspace out-of-memory (OOM) killer"。

★ **本机实测（必须记下来）**：在本机（Ubuntu 24.04 WSL2）上

```
$ systemctl is-enabled systemd-oomd
not-found
$ ls /lib/systemd/system/systemd-oomd.service
（不存在）
```

→ **`systemd-oomd` 在本机没有安装。** 也就是说：`ManagedOOMMemoryPressure=` 这类"按策略杀"的机制在本机**不存在**，内存压力下只剩内核 OOM killer 的默认行为（挑一个进程杀）。这属于"我以为是 systemd 在管，其实没管"的一类假设 —— 与本报告 §2.1（timer 静默跳过）、§2.8（`--collect` 失效）是同一类问题：**机制是否存在，必须实测，不能靠推测。**

★ 反过来说，这也提示一个风险：**systemd-oomd 是"按压力杀进程组"的策略执行者，它的判断也会误伤**（Ubuntu 桌面版曾因此收到大量用户投诉）。因为我没有找到可引用的权威来源，**这里不写具体案例**；只给出可操作的结论：**如果启用了 oomd，自治系统要有"我被 oomd 杀了"的独立观测**，否则会把"被策略杀"误判成"程序崩溃"，从而进入错误的自愈分支。

### 6.7 真实事故：自己把自己打垮

**（a）Cloudflare 2019-07-02 —— 一条自己的规则耗尽全球 CPU**

`[URL]` https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/

> On July 2, we deployed a new rule in our WAF Managed Rules that **caused CPUs to become exhausted on every CPU core that handles HTTP/HTTPS traffic on the Cloudflare network worldwide.**

> The CPU exhaustion was caused by a **single WAF rule** that contained a poorly written regular expression that ended up creating excessive backtracking.

> Everything that occurred up to the point the rules were deployed was done "**correctly**": a pull request was raised, it was approved, CI/CD built the code and tested it, a change request was submitted with an SOP detailing rollout and rollback, and the rollout was executed.

Cloudflare 自己列出的"多重原因汇聚"，与自治系统最相关的几条（原文摘要）：

- "A protection that would have helped prevent excessive CPU use by a regular expression **was removed by mistake during a refactoring** of the WAF weeks prior—a refactoring that was **part of making the WAF use less CPU**."
  → **为了省 CPU 的改动，删掉了防 CPU 失控的保护。** 优化本身制造了新故障面。
- "The test suite **didn't have a way of identifying excessive CPU consumption**."
- "The SOP allowed a non-emergency rule change to go globally into production **without a staged rollout**."
- "The rollback plan **required running the complete WAF build twice taking too long**."
- "**The first alert for the global traffic drop took too long to fire.**"
- "**We had difficulty accessing our own systems because of the outage** and the bypass procedure wasn't well-trained on." + "SREs had lost access to some systems because their credentials had been timed out for security reasons."
  → 从提出"全球关停 WAF"（14:02）到真正执行（14:07）用了 **5 分钟**：**在最需要 kill switch 的时候，kill switch 的入口也挂了。**

★ 三条对单机自治直接适用的教训：

1. **"流程全对"不等于不会炸**：PR、CI、变更单、回滚方案全齐，仍然炸了。治理必须针对**资源类失败**（CPU/内存/磁盘/日志/任务数），而不只是功能类失败。
2. **测试测不出"消耗"**：所以单机自治必须有**运行时**资源上限（`CPUQuota=` / `MemoryMax=` / `TasksMax=` / `LogRateLimit*=`），不能靠测试覆盖。
3. **kill switch 必须独立于被它关停的系统**。单机上的对应物：**自治 agent 的"暂停/急停"必须不依赖 agent 自己** —— 例如一个独立的 systemd unit、或者一个它不参与写的文件开关。

**（b）GitLab 2017-01-31 —— 单点主库 + 备份链断裂**

`[URL]` https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/

> The primary's hostname is db1.cluster.gitlab.com, while the secondary's hostname is db2.cluster.gitlab.com. In the past we've had various other issues with this particular setup due to **db1.cluster.gitlab.com being a single point of failure**.

事故过程（同一页）：工程师为了重建复制，在 secondary 上清空数据目录并重跑 `pg_basebackup`；期间主库的数据目录被误删（`pg_basebackup` 因 `max_wal_senders` 不足而反复失败、`strace` 显示卡在 `poll` 等一系列误导性现象，最终导致操作指向了错误的目录），多种备份/复制机制都没能救回，**丢失约 6 小时数据**。

★ 对单机的教训：
- **"备份存在" ≠ "备份可用"**（该文的叙述正是一连串"本该救命的机制都不可用"）。恢复演练的必要性见 §5.2。
- **误导性的错误信息会把人引向更危险的操作**：`pg_basebackup` "hang 住且没有有意义输出" → 工程师加大 `max_wal_senders` → 重启 PostgreSQL → 继续试 —— **每一步都在原方向上更用力，而根因在别处。** 自治系统在同样情境下会**更快、更自信地**在原方向上更用力（没有人类的犹豫作为刹车）。
- （我未逐字核对该文"5 种备份机制全部失效"的表述，故**不引用具体数字**。）

**（c）CrowdStrike 2024-07-19 —— 坏配置 + 自动重启 = 不可自愈的启动环**

`[URL]` CrowdStrike · *Channel File 291 Incident Root Cause Analysis*（PDF）— https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf

（我确认了该 RCA 文档存在并抓取到正文；确认其内容方向为：通道文件的生成/校验环节出问题，导致大范围主机进入重启环、需要人工介入恢复。）

★ 与 §1.2 的 `StartLimitAction=reboot-force` 对照：**"自动重启"对坏配置无效，而且会把"一个服务坏"放大成"整机不可用"。** 无人值守系统必须有"回滚到上一个已知可用状态"的能力，而**不只是**"重启"。没有回滚能力的自动重启，会把一次配置错误变成一个启动环。

（我未能完整核对 RCA 中关于人工恢复规模的具体数字，故**不引用数字**。）

### 6.8 防"自撑爆"自查清单

1. `journalctl --disk-usage`；`SystemMaxUse=` 是否显式设置（默认是**软**限制，§6.1）
2. 所有容器日志驱动是否设了 `max-size` / `max-file`（默认**无限**，§6.4）
3. `/var/lib/systemd/coredump/` 的占用 + `MaxUse=`（崩溃循环会撑爆，§6.5）
4. 临时产物目录是否有 age 字段（没有 age = 永不清理，§6.3）
5. 是否有**资源类**告警（磁盘/内存/任务数），而不只是功能类告警（§6.7a）
6. 急停开关是否独立于被停的系统（§6.7a）
7. 资源上限是运行时强制的（`CPUQuota=`/`MemoryMax=`/`TasksMax=`/`LogRateLimit*=`），而不是靠测试或"应该不会"（§6.7a）

---

## 7. 落地清单：给 dsh-steward 的具体建议

> 只列本报告已经给出依据的项。

**失败语义（立即可做）**
1. 保留 `SuccessExitStatus=0 1 2 3 4`，并补 `RestartPreventExitStatus=` 表达"确定性坏配置，重试无意义"（§1.1）。
2. 用 `ExecCondition=` 表达"前置条件不满足就跳过"，而不是在脚本里 `exit 0`（§1.1）。
3. 把 `Type=simple` 改成 `Type=exec`（§1.2）—— 让"二进制没起来"不再伪装成"已启动"。
4. 显式设 `StartLimitIntervalSec=` / `StartLimitBurst=`（**写在 `[Unit]` 段**），并加 `OnFailure=` 指向一个通知 unit；注意命中限流后**不会自动恢复**（§1.2）。
5. 长任务加 `RuntimeMaxSec=` 兜底 —— **但不要用 `Type=oneshot`**，否则该项无效（§1.2）。

**定时器（立即可做）**
6. 每个 timer 表达式进仓库前附 `systemd-analyze calendar --iterations=5` 的输出（§1.7）。
7. 检查所有 `OnCalendar` 是否用了"区间+重复"的窄窗口写法（§2.3）。
8. 确认周期性任务的 service 会**退出**；不要用 `RemainAfterExit=yes`（§2.1）。
9. 明确 "名义时间 ≠ 触发时间"：需要精确时刻就设 `AccuracySec=1us` 并接受功耗代价；需要摊平负载就用 `RandomizedDelaySec=`（§2.4）。
10. `Persistent=true` 只在 `OnCalendar` 上有效且**只补一次**；卸载前 `systemctl clean --what=state`（§2.6）。
11. 时钟是依赖：定时任务前确保时钟已同步（`After=time-sync.target` / `systemd-time-wait-sync.service`），并在自治系统里把时钟异常当一等事件（§2.7）。

**检查点（本次事故的直接补丁）**
12. **每读到一个来源就 append 落盘**，不要攒到最后（§5.3 答案 1）。
13. 长任务用 `systemd-run --unit=<name>` 起独立 unit，使 dsh 重启打不到它；同时避免 payload daemonize，否则 §2.8 的 cgroup 坑会挡住第二次同名启动（§5.3 答案 2）。
14. 加"恢复演练"：随机 kill -9 后从检查点续跑，断言结果一致且无重复副作用（§5.2）。
15. 重启编排器时走 drain 五步（§5.3 答案 3）；配置变更优先 `daemon-reload` / `daemon-reexec`，**不要全量重启**。

**自我撑爆（立即可做）**
16. 不要把日志直写文件（会绕过限流）；用 journal + `LogRateLimitIntervalSec=`（§6.2）。
17. 显式设 `SystemMaxUse=` 并定期 `journalctl --vacuum-*`；知道限额是**软的**（§6.1）。
18. 给所有临时产物目录配 age 字段；用 `CacheDirectory=` + `systemctl clean --what=cache`（§6.3）。
19. 给自治 workload 设 `MemoryHigh=`（主）+ `MemoryMax=`（兜底）+ `TasksMax=`（§1.6）。
20. 用 `ProtectSystem=strict` + `ProtectHome=` + `StateDirectory=` 把 agent 的写权限限制成一个明确的目录（§1.5）；注意 **user service 里这些默认无效**（§1.5 末尾）。
21. 上机后跑一次 `systemd-analyze security dsh-steward.service` 和 `systemd-analyze verify`，把分数记进文档（§1.7）。

---

## 8. 没有找到依据的问题（不写结论）

按调研纪律，以下问题**尚未拿到可引用来源**，因此本报告不给出结论。**这一节和正文一样重要**：它划出了"我不知道"的边界。

### 8.1 想查但拿不到依据的（不写结论）

1. **WSL2 在宿主睡眠 / `wsl --shutdown` 时 systemd timer 的行为** —— 机制上清楚（VM 不运行则 timer 不触发），但**没有找到微软官方文档明确表述**。§2.5 只把它写成"对本项目的含义提示"，不作为技术结论。
2. **Windows Task Scheduler 及其它调度器的同类陷阱** —— 未查证（§2.9 末尾）。
3. **systemd 在 `StartLimitIntervalSec=` 被写进 `[Service]` 段时是否给出警告** —— 只确认了它属于 `[Unit]` 段（`systemd.unit(5)` 分节），**没有实测警告行为**。
4. **BMC / IPMI 作为"真正的外部复位"**，以及 **A/B 引导自愈**（boot counting / RAUC / ostree / `systemd-sysupdate`）—— 未核对，故 §3.1 留白。这是"单机自治边界"里**最大的一块空白**：机器起不来时的自愈手段我没有依据可写。
5. **systemd-oomd 误伤用户会话的具体案例** —— 知道存在争议，但**没有找到可引用的权威来源**，故 §6.6 只给"要有独立观测"的可操作结论，不写案例。
6. **`docker system prune` 的确切行为与风险** —— 未核对（§6 未使用）。
7. **cron 的 `*/N` 越界退化行为**（Vixie 实现细节）—— 未核对。本报告只引用了有本机 man page 依据的 `cron(8)` DST 段落。
8. **DNS 在断网时的缓存行为细节**（systemd-resolved 缓存策略）—— 未核对，§4.5 标注为"不写"。
9. **`restic check --read-data` 的页面正文** —— §5.2 引用了 https://restic.readthedocs.io/en/stable/045_working_with_repos.html ，但当场核验时返回 **HTTP 429（限流）**，**未能读到正文**。该条目前只有"工具名 + 文档位置"级别的支撑，**引用强度低于本报告其它条目**。

### 8.2 主动放弃的来源（抓到页面但拿不到正文，因此不引用）

调研中有两个来源我**打开成功但没有引用**，因为它们是前端渲染的页面，我拿不到正文，按纪律**宁可空着也不转述**：

1. **Ink & Switch, *Local-First Software*** — https://www.inkandswitch.com/local-first/ （HTTP 200，正文取不到）→ 它是 local-first 的经典文献，但本报告**没有引用它的任何具体主张**，§4 改用了能拿到正文的 12factor / Hugging Face / Ollama / Let's Encrypt 文档。
2. **AWS Builders' Library, *Static stability using Availability Zones*** — https://aws.amazon.com/builders-library/static-stability-using-availability-zones/ （HTTP 200，正文取不到）→ **本报告没有使用它**，§3.5 只用 GitHub 与 Cloudflare 的一手复盘。

★ 这两条记录下来的意义：**"我知道这个来源存在"和"我据它下了结论"是两件事。** 前者不算依据。

### 8.3 本次调研中实际被抓到并修正的错误（自我纠错记录）

按"一条没被核实的结论不算结论"的要求，这里记录我在本次调研中**自己犯过并改掉的错**：

1. **`--collect` / cgroup 那条因果链**：一开始只有"知道这个坑"，没有链路；补上 `systemd-run(1)` → `systemd.unit(5)` GC 条件第 7 条 → `systemd.kill(5) · KillMode=` 三处 man page 引用后，才敢写成 §2.8 的结论。
2. **§5.2 的 Python 校验器第一版有真 bug**：它把"中段损坏"误报成"最后一行撕裂"（因为在遇到第一行坏数据时就 `break`，之后不再检查后面还有没有可解析的行）。**这个 bug 的方向恰好是最危险的**：它会让人从断裂的检查点"安全续跑"，从而漏掉工作。修正后按五种输入实测：

   | 输入 | 期望 | 实测 |
   |---|---|---|
   | 完整三行链 | `ok`, `RESUME_AT=3` | ✅ 一致 |
   | 最后一行撕裂 | `torn_tail`, 退出 0 | ✅ 一致 |
   | 中段损坏 | `corrupt_middle`, 退出 3（**拒绝续跑**） | ✅ 一致（修正前误报为 `torn_tail`） |
   | 末行撕裂 + 尾部空行 | `torn_tail` | ✅ 一致 |
   | 空文件 | `ok`, `RESUME_AT=0` | ✅ 一致 |
   | 文件不存在 | 退出 2 | ✅ 一致 |

   ★ 这件事本身就是本报告主题的缩影：**校验器自己也需要被校验**；而错误的校验器比没有校验器更危险（它给出的是"通过"）。
3. **12factor 的两句引文**：写进文档前逐字回查了原文（`12factor.net/processes` 与 `12factor.net/backing-services` 均 HTTP 200），确认引述与原文一致，而不是凭印象写经典语录。
