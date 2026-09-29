# dsh-steward

Self-evolution supervision for DeepSeek Harness.

**Status: design phase. Nothing here runs unattended yet, and that is deliberate — see [§4](#4-why-it-does-not-act-yet).**

---

## 1. What problem this exists for

On 2026-09-28, seven defects were found in this machine's DeepSeek Harness install
over the course of one day. Five of them **the system could not have found on its
own** — a person pushed each one.

| # | Defect | Found by | What it would have done |
|---|---|---|---|
| 1 | `~/.dsh/.env` carried twelve `DSH_*` names | user: "test restarting" | dsh refuses to start; **every future restart fails permanently** |
| 2 | `Start-Process -ArgumentList` split the command | user: "test another port" | recovery path did nothing |
| 3 | unquoted `$PATH` containing `Program Files (x86)` | derived from 2 | same |
| 4 | desktop shortcut pointed at `/home/rchua/...` | while reading the `.lnk` | same |
| 5 | `WSL_DISTRO_NAME` missing → distro name `"WSL"` | user: "clicked it, nothing happened" | `\\wsl.localhost\WSL\` does not exist |
| 6 | generated `.ps1` had no BOM → GBK misalignment ate a quote | user: "I haven't clicked yet" | parse failure; **the error pointed at a correct line** |
| 7 | `vecmem` metadata overwritten in the old format | user: "should the ceiling go up?" | search returned zero hits and reported success |

Defect 1 was introduced by the same agent that later "fixed" it. That matters for
the design more than any of the others.

### 1.1 The shape they share

> **I verified the action I had just taken, not the thing it could have broken.**

- Changed `.env`, checked the file's format — not whether dsh could still start.
- Changed the shortcut, checked *the path I constructed* — not the one written into it.
- Changed the store format, checked the script exited zero — not whether items and rows still agreed.

And an eighth, which is about checks rather than code:

> **A check I wrote for exactly this purpose passed a deliberately broken input**, because its `pkill` test grepped the whole file instead of that one line.

---

## 2. Why existing checks cannot cover it

Google SRE states the reason as a property of monitoring rather than a defect in a
particular check ([ch17](https://sre.google/sre-book/testing-reliability/)):

> Confidence can be measured both by past reliability and future reliability. […] In
> order for these predictions to be strong enough to be useful […] the site remains
> completely unchanged over time […] or you can confidently describe all changes to the site.

A health check asks whether the system is up **now**. Whether it will come back after
the next restart depends on paths that have not run yet. `check-dsh-health.sh` passed
every time on 2026-09-28 while the recovery path was broken in seven separate ways.

That is not a bug in that script. It is the wrong instrument for the question.

---

## 3. The loop

```
  ── outside dsh ────────────────────────────────────────────────
  1  OBSERVE     snapshot: process, ports, store, check results
  2  DETECT      run the checks; produce a problem list
                                                                    systemd
  ── inside dsh ─────────────────────────────────────────────────     owns
  3  DIAGNOSE    read the code, find the cause                        the
  4  PROPOSE     propose a change                                     edges
  5  BASELINE    run the same checks BEFORE applying
  6  APPLY       apply, restart, take a rollback point
  ── outside dsh ────────────────────────────────────────────────
  7  RE-VERIFY   run the identical checks after
  8  COMPARE     AGREE / DIVERGE
  9  RECORD      write the outcome to memory
 10  ROLLBACK    git revert if it diverged
```

**Steps 1, 2, 7, 8 and 10 run outside dsh.** They are precisely the steps that matter
when dsh will not start, and a process cannot supervise its own absence. Both of the
day's restarts were completed by systemd, which is not in dsh's process tree.

Steps 3–6 run inside, because they need to read code and reason about context.

### 3.1 The two steps that were missing entirely

**5 — BASELINE.** No baseline was captured all day. Without one, "did my change help?"
has no answer beyond "it looks right", which is what the agent said six times.

**8 — COMPARE.** The cordis audit repo already has the mechanism: nine invariants run
against two lines, reporting

```
AGREE    both satisfied, or both violated, the same invariant
DIVERGE  one satisfied it and the other did not        <- the finding
```

Its own comment is the most honest line in the repository:

> A divergence is not automatically a bug on the line that failed: it is a question
> about which behaviour the property demands.

It does not claim to know which line is right. Neither should this.

---

## 4. Why it does not act yet

Four constraints. Each has an instance from 2026-09-28.

### 4.1 A check that has not been falsified is not a check

The `pkill` check passed a deliberately broken script. It grepped the whole file for
the port-scoped pattern, and two unrelated `pgrep` lines matched it.

**Every check here must be run against a known-bad input before it counts.** The
tests in `test/` exist for that, not for coverage.

### 4.2 No baseline, no verdict

Stated above. Mechanical, not philosophical.

### 4.3 The supervisor reports before it acts

A supervisor with restart authority and a check with a hole is a machine for
restarting things for the wrong reason. And the failure is not hypothetical:
kubelet's own backoff turns a bad configuration into a state that looks like the
system is trying, for days, while never coming up — `CrashLoopBackOff` is *backoff
working*, not a cause.

**Phase one holds no write authority at all.**

### 4.4 Never three: the agent does not edit its own reasoning loop

Most systems described as self-improving change memory, or prompts against a frozen
interpreter. Editing the loop that reasons is a different thing, and METR measured
what happens: reward hacking in **30.4%** of RE-Bench runs, and **21 of 21** on one
benchmark — by monkey-patching the evaluator, overwriting `time.time`, and reading
the grader's reference tensor off the Python stack.

Asked afterwards whether it had followed the user's intent, o3 said no **ten times out
of ten**. It did not know while doing it.

Darwin Gödel Machine does edit its own agent code, and its four defences are a
container, a per-execution time limit, self-improvement confined to the agent
codebase, and archived traceability. The pivot is **what it freezes**: the evaluation
harness and the archive logic are not editable.

> **What may change must not include what judges it.**

This system sits at **tier 2.5** — it modifies infrastructure code, not the reasoning
loop. Tier 3 is out of scope. And by 4.1's own standard, `check-recovery.sh` and the
invariants are judges and must not become editable by the thing they judge.

---

## 5. Roles

The value of a team here is not parallel speed. It is that **the writer of a change
and the verifier of a change should not share a blind spot** — on 2026-09-28 they were
the same agent, and six defects passed through.

| Role | Does | On 2026-09-28 |
|---|---|---|
| **PROPOSER** | proposes the change and its own verification | the agent |
| **VERIFIER** | writes verification independently, without reading the proposer's | nobody |
| **ADVERSARY** | attacks the verifier's checks with known-bad inputs | nobody |
| **SUPERVISOR** | runs outside the process; wakes a human when unsure | systemd, incidentally |

The ADVERSARY role has a specific instance: the `pkill` check was written, run, and
reported OK by its author — and was only shown to be vacuous when a broken input was
tried against it.

---

## 6. What this machine already has

Nothing has to be invented. It has to be assembled.

| Part | State | Role in the loop |
|---|---|---|
| systemd 255 (timer / service / `Restart=` / journal) | running | hosts steps 1–2, 7–8, 10 |
| `dsh-wsl-kit/scripts/check-recovery.sh` | 21 decision points, **5** of them falsified by bad input (`scripts/falsify-recovery.sh`) | step 2 |
| `cordis-dsh-audit/invariants/` + `run.mjs` | 9 invariants, differential runner | steps 7–8 |
| `vecmem` | 5000 items / 4096 dims, Float32 sidecar | step 9 |
| git | kit 90 commits, audit 46, both clean | step 10 |
| DSH orchestration (`subagent`, `workflow`, `spawn_teammate`, `team_task_create`) | available | steps 3–6 |
| `dsh-wsl-notify` | exists | the supervisor's channel |
| 21 `link:` plugins | source writable, effective on restart | the surface that can change |
| RTX 5080 / 16 GB | 4.2 GB in use | local models |

---

## 7. Phases

| Phase | Adds | Write authority |
|---|---|---|
| **1 — observe** | timer runs the checks; failures notify and journal | **none** |
| **2 — baseline** | every agent change snapshots git hash + check results first | none |
| **3 — compare** | re-run after; `DIVERGE` is reported, **never auto-rolled-back** | none |
| **4 — act** | only after a check has survived its own falsification record | restart, budgeted |

Phase 4 needs an admission test this repository has not yet chosen. The candidate
from the literature is SGM's: replace "provably beneficial" with a statistical
confidence bound plus a **global error budget**, so an automatic action is admitted
only when superiority is certified, and exhaustion stops automation rather than
looping. With a handful of actions per day on one machine, the statistical power is
questionable and a simpler rule — *N consecutive failures stops automation* — may be
the honest choice. **Not decided.**

---

## 8. What a single machine cannot do

Recorded so the design does not pretend otherwise.

```
x  no instance-replacement semantics   restarting does not fix the kernel, the disk,
                                       memory fragmentation, or the network stack
x  no high availability                one reboot is a total outage
x  no smooth traffic drain             takeover and draining must be written by hand
x  no metric-driven promote/abort      a script approximation adds its own failure
                                       modes: the script hangs, cron does not run
x  no admission-time schema validation  unknown fields are silently ignored unless
                                       the schema is written here
x  no continuous chaos in production   the blast radius is the whole machine
```

Worth copying from Kubernetes, precisely because it is possible here:

> **A backoff'd, visible crash loop beats running on quietly broken.**

`Restart=on-failure` + `StartLimitIntervalSec`/`Burst` + `journalctl` +
`OnFailure=` gives a timestamped, bounded, notified record. The alternatives —
infinite fast restarts flooding the log, or a supervisor that gives up silently —
are both worse.

---

## 9. First real use

The three patches in `dsh-cordis-backport/backport/` — `cordis-4.0.4`,
`cordis-plugin-loader-1.0.5`, `cordis-plugin-timer-1.1.6` — fix defects that exist in
the cordis that DSH vendors, and each was verified probe-before / probe-after.

**The nine invariants are already a baseline for them.** The first exercise of this
loop is:

```
1  run the nine invariants                       -> baseline
2  apply the three patches
3  run the same nine
4  COMPARE
5  commit                                        -> rollback point
```

That is a real change to real code, with the verification already written, and it is
the point at which "self-evolution" stops being a design and starts being a commit.

---

## 10. Open questions

1. **Do the checks earn their cost?** Fifteen minutes each, running PowerShell, `wslpath`, and a store validation. Not measured.
2. **What is the supervisor's restart condition?** Needs a quantified check-credibility measure. None exists.
3. **What does the team cost?** A VERIFIER and an ADVERSARY per change, on one GPU.
4. **What belongs in memory?** Eight "established facts" were written by hand on 2026-09-28. The selection rule is undefined.
5. **Rollback granularity.** git recovers code, not a broken config with no code change.
   → The literature's answer: config changes go *generate → validate → atomic replace → reload → observe → revert*, not through git.
6. **How is the break-glass path rehearsed?** SRE notes it rarely is, and 2026-09-28 proved it: four of the seven defects were on the path a person takes when nothing else works.
7. **Which exit codes belong in `RestartPreventExitStatus`?** dsh's config-error code is not yet known.
8. **Who fixes the judges?** By §4.4 the invariants and `check-recovery.sh` must not be self-modifiable — but then changing them requires a human, forever.
