#!/usr/bin/env bash
# vecmem 恢复演练 —— 从备份真的还原一次，并证明还原出来的那份能用。
#
# 为什么需要它：备份存在不等于备份能用。这台机器上所有「能退回」的说法都建立在
# 几个备份文件上，而在 2026-09-28 之前，它们一次都没被验证过。
#
# ★ 判据不是「文件能打开」。是「消费者读它和读线上没区别」—— 同一个查询、
#   同一组分数、同一批文本。少任何一项，都不算验过。
#
# 用法：
#   bash drills/vecmem-restore.sh                      # 用最新的备份
#   bash drills/vecmem-restore.sh <store.json> <vectors.f32>
#
# 退出码：0 全过 · 1 备份自身不自洽 · 2 还原后对不上 · 3 消费者读不了
set -uo pipefail

STORE_DIR="${VECMEM_DIR:-$HOME/.dsh/vecmem}"
PLUGIN="${VECMEM_PLUGIN:-$HOME/.dsh/profiles/web/node_modules/dsh-wsl-vecmem/lib/store.js}"

# ── 找备份 ────────────────────────────────────────────────────────────────────
if [ $# -ge 2 ]; then
  BJ="$1"; BF="$2"
else
  BJ=$(ls -t "$STORE_DIR"/store.bak*.json 2>/dev/null | head -1)
  BF=$(ls -t "$STORE_DIR"/store.vectors.bak*.f32 2>/dev/null | head -1)
fi
[ -n "${BJ:-}" ] && [ -f "$BJ" ] || { echo "找不到备份 json"; exit 1; }
[ -n "${BF:-}" ] && [ -f "$BF" ] || { echo "找不到备份 f32"; exit 1; }

DRILL=$(mktemp -d /tmp/vecmem-restore-drill-XXXXXX)
echo "════ vecmem 恢复演练 ════"
echo "  备份  $(basename "$BJ")"
echo "  隔离  $DRILL"
echo

# ── 第 1 步：备份自身自洽 ─────────────────────────────────────────────────────
echo "──── 1/4 备份自身是否自洽 ────"
python3 - "$BJ" "$BF" <<'PY' || exit 1
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
j, f = sys.argv[1], sys.argv[2]
jsz, fsz = os.path.getsize(j), os.path.getsize(f)
with open(j, encoding='utf-8', errors='surrogatepass') as fh:
    d = json.load(fh)
n, dim = len(d['items']), d['dims']
exp = n * dim * 4
ok = exp == fsz
print(f'  items={n:,}  dims={dim}')
print(f'  期望 {exp:,} 字节  实际 {fsz:,}  {"✓" if ok else "★ 不一致"}')
if not ok:
    print('  ★ 备份本身就不自洽 —— 它不能用。恢复演练在此终止。')
    sys.exit(1)
PY
echo

# ── 第 2 步：隔离目录还原 ─────────────────────────────────────────────────────
echo "──── 2/4 隔离目录还原（不碰线上） ────"
cp "$BJ" "$DRILL/store.json" && cp "$BF" "$DRILL/store.vectors.f32"
echo "  ✓ 两个文件已复制（$(du -sh "$DRILL" | cut -f1)）"
echo

# ── 第 3 步：读回对账 ─────────────────────────────────────────────────────────
echo "──── 3/4 读回对账 ────"
python3 - "$DRILL" <<'PY' || exit 2
import json, os, struct, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
D = sys.argv[1]
with open(f'{D}/store.json', encoding='utf-8', errors='surrogatepass') as f:
    d = json.load(f)
sz = os.path.getsize(f'{D}/store.vectors.f32')
n, dim = len(d['items']), d['dims']
ok = n * dim * 4 == sz
print(f'  条目 {n:,}  dims {dim}  字节一致 {ok}')
# 首末条向量必须非零 —— 一个全零的向量区能让所有检查通过，而检索全废
with open(f'{D}/store.vectors.f32', 'rb') as f:
    head = struct.unpack(f'{dim}f', f.read(dim * 4))
    f.seek(-dim * 4, 2)
    tail = struct.unpack(f'{dim}f', f.read(dim * 4))
nh, nt = sum(1 for v in head if v), sum(1 for v in tail if v)
print(f'  首条非零维 {nh}/{dim}   末条非零维 {nt}/{dim}')
if not ok or nh < dim * 0.9 or nt < dim * 0.9:
    print('  ★ 还原后对不上，或向量区可疑（可能全零）')
    sys.exit(2)
PY
echo

# ── 第 4 步：消费者真的读它 ───────────────────────────────────────────────────
# ★ 这一步才是关键。前三步只证明「文件是对的」，这一步证明「系统还原后能用」。
echo "──── 4/4 消费者（插件）读还原的那份，并与线上对比 ────"
Q="${DRILL_QUERY:-跨平台注音输入法}"
probe() {
  node --input-type=module -e "
import { createVecmem } from '$PLUGIN';
const v = createVecmem({ embedModel: 'qwen3-embedding:8b'$( [ -n "${1:-}" ] && echo ", dir: '$1'" ) });
const st = await v.status();
const r = await v.search({ query: $(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$Q"), topK: 3 });
console.log(JSON.stringify({count: st.count, dims: st.dims, hits: r.hits.map(h => [Number(h.score.toFixed(4)), h.text.slice(0,40)])}));
" 2>/dev/null
}
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
A=$(probe "$DRILL"); B=$(probe "")
if [ -z "$A" ]; then echo "  ★ 插件读不了还原的那份"; exit 3; fi
python3 - "$A" "$B" <<'PY' || exit 3
import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
a, b = json.loads(sys.argv[1]), json.loads(sys.argv[2])
print(f'  还原  count={a["count"]}  dims={a["dims"]}')
print(f'  线上  count={b["count"]}  dims={b["dims"]}')
same = a == b
print(f'  ★ 两者一致：{same}')
for s, t in a['hits'][:3]:
    print(f'      [{s}] {t}')
if not same:
    print('  ★ 还原出来的那份与线上行为不同 —— 备份不可用')
    sys.exit(3)
PY
echo
echo "════ 演练通过 —— 这个备份能用 ════"
echo "  隔离目录 $DRILL（可删）"
rm -rf "$DRILL"
exit 0
