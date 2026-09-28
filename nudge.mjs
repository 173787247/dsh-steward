#!/usr/bin/env node
/**
 * nudge — a controller that reads what a worker just did and pushes it forward.
 *
 * A loop needs something that notices when the worker has gone quiet. This is a
 * second agent whose only job is to read the tail of the first one's log.
 *
 * Three rules, and the reasoning behind each:
 *
 *   The controller may not tell the worker to stop.
 *   The controller may not declare the task done on the worker's behalf.
 *   The controller may not evaluate the task -- it pushes, it does not grade.
 *
 * The second and third are the load-bearing ones. If the controller could say
 * "done", it would confuse "looks finished to me" with "is finished", and the
 * worker would stop on a guess. And a judge that can also grade drifts into
 * grading instead of pushing.
 *
 * **Stop is a field, not an absence.** A text-tag protocol signals stop by
 * emitting nothing, which makes a parse failure and a decision the same signal --
 * the one signal that must not be ambiguous. Here the verdict is JSON with an
 * explicit boolean, and an unparseable reply exits 3 rather than 1. That choice is
 * this repository's first constraint applied to its own parser.
 *
 * Runs against a local model by default. A loop that needs an external API to
 * keep running dies when the API is cut, and this one is meant to run for hours.
 *
 *   node nudge.mjs --objective "..." --log /tmp/worker.log
 *   node nudge.mjs --objective "..." --log w.log --model qwen3.8:27b
 *   node nudge.mjs --objective "..." --log w.log --dry     print the prompt only
 *   node nudge.mjs --selftest                              prove the parser can fail
 */
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = arg("--model", process.env.NUDGE_MODEL ?? "qwen3.8:27b-q4_K_M");
const TAIL_LINES = Number(arg("--tail", "80"));

/**
 * The controller's instruction. Three prohibitions, and the reasoning for each is
 * in the header: it may not stop the worker, may not declare the task done, and may
 * not grade.
 */
function buildPrompt(objective, tail) {
  return `你是监督者，不是执行者。下面是一个 agent 最近的工作输出。

用户的 loop 诉求：<objective>${objective}</objective>

<worker_output>
${tail}
</worker_output>

判断这个 agent 是偷懒了、还是真的完成了诉求。然后输出一句**追加给它的指令**。

规则（违反任何一条即失败）：
1. 不允许促使 agent 停止。
2. 不允许代替它宣告任务完成。
3. 不允许评价原任务本身（不说"做得好""方向不对"），只催促。
4. 指令要短。复述诉求，或一句督促。判据是**这句话有没有带来新信息** ——
   没有新信息的重复催促等于没有催促。
   反例（不要这样）：加油 / 继续努力 / 做得不错
   ★ 只有当你能指出**具体哪里还没做**或**哪一步没验**时才给指令。

★ 如果你判断它**确实已经完成**了诉求，就不要给指令 —— 停止是用沉默表示的，不是用一句话表示的。

只输出 JSON，不要任何其他文字：
{"continue": true, "nudge": "你的督促"}
或
{"continue": false, "why": "简述为什么可以停"}`;
}

/** Pull a JSON object out of whatever the model wrapped it in. */
function parseVerdict(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, why: "empty response" };
  // Fenced blocks, prose preambles, and trailing commentary are all common.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const obj = JSON.parse(c.slice(start, end + 1));
      if (typeof obj.continue !== "boolean") continue;
      if (obj.continue && (typeof obj.nudge !== "string" || !obj.nudge.trim())) continue;
      return { ok: true, verdict: obj };
    } catch { /* try the next candidate */ }
  }
  return { ok: false, why: "no valid verdict object" };
}

// ── selftest ────────────────────────────────────────────────────────────────
//
// The dangerous failure here is a parser that reads garbage as "stop", because
// stop is silence and silence is what a broken parse looks like. So the parse
// must return ok:false on anything malformed, and the caller must treat that as
// an error rather than as a decision.
if (args.includes("--selftest")) {
  const probes = [
    ['{"continue": true, "nudge": "L2.3 还没做"}',                    true,  "plain json"],
    ['```json\n{"continue": true, "nudge": "x"}\n```',               true,  "fenced"],
    ['好的：\n{"continue": true, "nudge": "先验 L1.2"}\n以上。',        true,  "prose wrapper"],
    ['{"continue": false, "why": "done"}',                           true,  "explicit stop"],
    ['{"continue": true}',                                           false, "continue with no nudge"],
    ['{"continue": true, "nudge": "   "}',                           false, "blank nudge"],
    ['{"continue": "yes", "nudge": "x"}',                            false, "continue not boolean"],
    ['我判断它已经完成了。',                                           false, "prose only, no json"],
    ['',                                                             false, "empty"],
    ['{"continue": true, "nudge": "换行\\n也要能过"}',                true,  "escaped newline"],
  ];
  let bad = 0;
  for (const [input, want, why] of probes) {
    const got = parseVerdict(input).ok;
    const pass = got === want;
    if (!pass) bad++;
    console.log(`  ${pass ? "OK  " : "FAIL"}  parse(${JSON.stringify(input.slice(0, 42))}) ok=${got} want=${want}   ${why}`);
  }
  console.log(`\n  ${probes.length - bad}/${probes.length} probes behaved as required`);
  if (bad) { console.log("  Refusing to run: a parser that reads garbage as a verdict would stop the loop silently."); process.exit(9); }
  process.exit(0);
}

// ── run ─────────────────────────────────────────────────────────────────────
const objective = arg("--objective");
const logPath = arg("--log");
if (!objective || !logPath) {
  console.error("usage: node nudge.mjs --objective <text> --log <file> [--model m] [--dry]");
  process.exit(2);
}
if (!existsSync(logPath)) { console.error(`no such log: ${logPath}`); process.exit(2); }

const all = readFileSync(logPath, "utf8").split("\n");
const tail = all.slice(-TAIL_LINES).join("\n");
const prompt = buildPrompt(objective, tail);

if (args.includes("--dry")) {
  console.log(prompt);
  process.exit(0);
}

let raw;
try {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.3 } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status} ${res.statusText}`);
  raw = (await res.json()).response;
} catch (e) {
  console.error(`nudge: model call failed: ${e.message}`);
  console.error(`nudge: this is an ERROR, not a stop. The worker keeps its state.`);
  process.exit(3);
}

const parsed = parseVerdict(raw);
if (!parsed.ok) {
  // Deliberately exit 3, the same as a transport failure, and never 0. A parse
  // failure that reads as "stop" would end the loop on a malformed reply.
  console.error(`nudge: unparseable verdict (${parsed.why})`);
  console.error(`nudge: raw: ${String(raw).slice(0, 300)}`);
  process.exit(3);
}

const v = parsed.verdict;
if (v.continue) {
  console.log(JSON.stringify({ action: "nudge", nudge: v.nudge }));
  process.exit(0);
}
console.log(JSON.stringify({ action: "stop", why: v.why ?? "(no reason given)" }));
process.exit(1);
