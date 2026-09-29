#!/usr/bin/env node
/**
 * steward — walk the goal queue and report what is next.
 *
 * Reads goals/L*.json in layer order, runs each goal's `evidence` as a shell
 * command, and reports. It does not change anything. Phase one holds no write
 * authority at all, for the reason in README section 4.3: a supervisor with
 * restart authority and a check with a hole is a machine for restarting things
 * for the wrong reason. The hole is not hypothetical -- the pkill check in
 * check-recovery.sh passed a deliberately broken script for a while, because it
 * grepped the whole file instead of the line that mattered.
 *
 * Two rules it holds itself to.
 *
 * Every command it runs is printed, so any number in the output can be
 * reproduced. That comes from GA-FAILURE-CASES.zh.md: claims checkable against a
 * file were all right, claims that could only be read were all wrong, and both
 * were printed in the same shape.
 *
 * And every check here has been run against a known-bad input before it counted.
 * See --selftest.
 *
 *   node steward.mjs              report
 *   node steward.mjs --quiet      exit code only
 *   node steward.mjs --layer L0   one layer
 *   node steward.mjs --selftest   prove the checks can fail
 *
 * Exit codes
 *   0  nothing outstanding
 *   1  L0 has a failure        <- nothing else matters
 *   2  L1 has a failure
 *   3  L0 and L1 clean, L2 has work
 *   4  L0..L2 clean, L3/L4 is the supply
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOALS = join(HERE, "goals");
const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const only = args.includes("--layer") ? args[args.indexOf("--layer") + 1] : null;

const LAYERS = ["L0", "L1", "L2", "L3", "L4"];
const say = (...a) => { if (!quiet) console.log(...a); };

/**
 * Run one evidence command. Returns true when the goal is satisfied.
 *
 * A command that cannot run at all -- missing shell, syntax error -- counts as
 * NOT satisfied rather than as satisfied. The tempting default is the other way
 * round and it is the one that hid every defect on 2026-09-28: a check that
 * silently does nothing looks exactly like a check that passed.
 */
/**
 * Commands that succeed unconditionally, so any evidence built on them is empty.
 *
 * The rule comes from the survey, and it has three samples behind it now. The first
 * was this file's own first version: it reported L2, L3 and L4 as fully satisfied
 * because every evidence command ended in `echo`. The second and third are in the
 * verification survey, which reproduced the forms on this machine and cited the bash
 * manual: the status of an AND-OR list is the status of the last command in it, so
 * `test ... && echo yes || echo no` always returns zero.
 *
 * A goal whose evidence is empty is not satisfied. It is also not failed -- nothing
 * was learned. It is UNDECIDED, and saying so is the whole point.
 */
const VACUOUS = [
  [/\becho\b/,   'echo succeeds whatever the condition was'],
  [/\bprintf\b/, 'printf succeeds whatever the condition was'],
  [/^\s*true\s*$/, 'true succeeds by definition'],
];

/**
 * The AND-OR form, but only where it is a shell construct.
 *
 * `a && b || c` returns the status of c, so when c is echo the whole thing always
 * succeeds. That is the form worth flagging. But `(a || b) && c` inside a quoted
 * JavaScript or Python expression is not the same thing at all, and the first
 * version of this detector fired on it -- it flagged a perfectly good evidence
 * command that happened to contain both operators inside a string.
 *
 * So: strip quoted regions first, then look. A detector that cries wolf gets
 * switched off, which is worse than not having one.
 */
function andOrAlwaysSucceeds(cmd) {
  const unquoted = cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  return /&&[^|]*\|\|/.test(unquoted)
    ? 'a && b || c returns the status of c, which is usually success'
    : null;
}

function vacuous(cmd) {
  for (const [re, why] of VACUOUS) if (re.test(cmd)) return why;
  return andOrAlwaysSucceeds(cmd);
}

function holds(cmd) {
  try {
    execSync(cmd, { shell: "/bin/bash", stdio: "pipe", timeout: 60_000, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function load(layer) {
  const f = join(GOALS, `${layer}-${layer === "L0" ? "survival"
    : layer === "L1" ? "integrity"
    : layer === "L2" ? "known-gaps"
    : layer === "L3" ? "expansion" : "exploration"}.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8"));
}

// ── selftest ────────────────────────────────────────────────────────────────
//
// A check that has not been shown to fail is not a check. Two probes, both of
// which must return the expected verdict, or the runner refuses to report at all
// -- because a runner that cannot tell pass from fail is worse than no runner.
if (args.includes("--selftest")) {
  const probes = [
    ["true",  true,  "a command that succeeds must read as satisfied"],
    ["false", false, "a command that fails must read as not satisfied"],
    ["exit 7", false, "a non-zero exit must read as not satisfied"],
    ["nonexistent-command-xyz", false, "a command that cannot run must read as not satisfied"],
    ["grep -q zzz /etc/hostname", false, "a grep that finds nothing must read as not satisfied"],
  ];
  let bad = 0;
  for (const [cmd, want, why] of probes) {
    const got = holds(cmd);
    const ok = got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? "OK  " : "FAIL"}  holds(${JSON.stringify(cmd)}) = ${got}  (want ${want})`);
    if (!ok) console.log(`        ${why}`);
  }
  console.log(`\n  ${probes.length - bad}/${probes.length} probes behaved as required`);
  if (bad) { console.log("  The runner cannot tell pass from fail. Refusing to report."); process.exit(9); }
  process.exit(0);
}

// ── walk ────────────────────────────────────────────────────────────────────
const layers = only ? [only] : LAYERS;
const result = {};

for (const layer of layers) {
  const doc = load(layer);
  if (!doc) { say(`  ${layer}  (no goals file)`); continue; }
  const rows = [];
  for (const g of doc.goals) {
    // ★ 空检查先于执行：不跑一个明知会通过的检查
    const vac = vacuous(g.evidence);
    const ok = vac ? null : holds(g.evidence);
    rows.push({ ...g, ok });
  }
  result[layer] = { doc, rows };
}

// ── report ──────────────────────────────────────────────────────────────────
let firstBlocking = null;
let nextWork = null;

for (const [layer, { doc, rows }] of Object.entries(result)) {
  const failed = rows.filter(r => !r.ok);
  say(`\n  ${layer}  ${doc.name}   ${rows.length - failed.length}/${rows.length} 满足`);
  for (const r of rows) {
    say(`    ${r.ok === true ? "ok  " : r.ok === false ? "FAIL" : "????"}  ${r.id}  ${r.objective}`);
    if (r.ok !== true) {
      // The command is printed so the result can be reproduced. A number
      // without its command is not evidence.
      say(`          evidence: ${r.evidence}`);
      say(`          why:      ${r.why}`);
    }
  }
  if (failed.length && !firstBlocking && (layer === "L0" || layer === "L1")) {
    firstBlocking = { layer, failed };
  }
  if (!nextWork && layer === "L2" && failed.length) nextWork = { layer, goal: failed[0] };
}

// ── verdict ─────────────────────────────────────────────────────────────────
say("");
if (firstBlocking) {
  say(`  BLOCKED at ${firstBlocking.layer}: ${firstBlocking.failed.length} failing.`);
  say(`  Nothing below ${firstBlocking.layer} matters until these are fixed.`);
  process.exit(firstBlocking.layer === "L0" ? 1 : 2);
}

const l2 = result["L2"];
const undecided = Object.values(result).flatMap(l => l.rows).filter(r => r.ok === null);
const l2open = l2 ? l2.rows.filter(r => r.ok !== true) : [];
if (l2open.length) {
  say(`  Next: ${l2open[0].id}  ${l2open[0].objective}`);
  say(`  ${l2open.length} of ${l2.rows.length} in L2 still open.`);
  process.exit(3);
}

const supply = ["L3", "L4"].flatMap(l => (result[l]?.rows ?? []).filter(r => r.ok !== true));
say(`  L0-L2 clean. ${supply.length} open in L3/L4 -- that is the supply.`);
if (supply.length) say(`  Next: ${supply[0].id}  ${supply[0].objective}`);
process.exit(4);
