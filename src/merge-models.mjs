#!/usr/bin/env node
/**
 * 把 data/_research/models-*.json 里的原创范文合并进 data/00-index.json
 *
 *   node src/merge-models.mjs            # 合并
 *   node src/merge-models.mjs --check    # 只报告，不写盘
 *
 * fragment 格式：
 * {
 *   "part": "B" | "A",
 *   "models": {
 *     "2005": { "en": "...", "zh": "...", "outline": ["首段…","主体…","结尾…"] }
 *   }
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'data');
const RESEARCH = path.join(DATA, '_research');
const IDX = path.join(DATA, '00-index.json');
const CHECK = process.argv.includes('--check');

if (!fs.existsSync(IDX)) { console.error('✗ 找不到 ' + IDX); process.exit(1); }
const idx = JSON.parse(fs.readFileSync(IDX, 'utf8'));

/* 收集 fragment */
const frags = fs.existsSync(RESEARCH)
  ? fs.readdirSync(RESEARCH).filter(f => /^models-.*\.json$/.test(f)).sort()
  : [];
if (!frags.length) { console.error('✗ data/_research/ 下没有 models-*.json'); process.exit(1); }

const byPart = { A: new Map(), B: new Map() };
const bad = [];
for (const f of frags) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(RESEARCH, f), 'utf8')); }
  catch (e) { bad.push(`${f}: JSON 解析失败 → ${e.message}`); continue; }
  const part = d.part;
  if (!['A', 'B'].includes(part)) { bad.push(`${f}: part 必须是 "A" 或 "B"`); continue; }
  if (!d.models || typeof d.models !== 'object') { bad.push(`${f}: 缺少 models 对象`); continue; }
  for (const [yr, m] of Object.entries(d.models)) {
    if (!/^\d{4}$/.test(yr)) { bad.push(`${f}: 年份 "${yr}" 非法`); continue; }
    if (!m || !String(m.en || '').trim()) { bad.push(`${f}: ${part} ${yr} 范文 en 为空`); continue; }
    if (!String(m.zh || '').trim()) { bad.push(`${f}: ${part} ${yr} 范文 zh 为空`); continue; }
    if (byPart[part].has(yr)) { bad.push(`重复年份：${part} ${yr} 在多个分片里出现（${f}）`); continue; }
    byPart[part].set(yr, {
      en: String(m.en).trim(),
      zh: String(m.zh).trim(),
      outline: Array.isArray(m.outline) ? m.outline.map(x => String(x).trim()) : []
    });
  }
}

/* 合并 */
const report = [];
for (const part of ['A', 'B']) {
  const P = idx['part' + part];
  if (!P) { bad.push(`00-index.json 缺少 part${part}`); continue; }
  const want = P.years.map(y => y.year);
  const have = [...byPart[part].keys()].map(Number).sort((a, b) => a - b);
  const missing = want.filter(y => !byPart[part].has(String(y)));
  const extra = have.filter(y => !want.includes(y));
  if (extra.length) bad.push(`part${part} 范文里有索引中不存在的年份：${extra.join(', ')}`);

  P.years.forEach(y => {
    const m = byPart[part].get(String(y.year));
    if (!m) return;
    const words = m.en.split(/\s+/).length;
    const isA = part === 'A';
    const lo = isA ? 85 : 150, hi = isA ? 130 : 220;
    if (words < lo || words > hi) bad.push(`part${part} ${y.year} 范文 ${words} 词，超出 ${lo}-${hi} 区间`);
    y.model = m;
    y.model.words = words;
    y.model.paras = m.en.split(/\n\s*\n/).length;
  });

  report.push({
    part, label: P.title,
    需要: want.length, 已有范文: want.length - missing.length,
    缺失: missing, 平均词数: Math.round(
      P.years.filter(y => y.model).reduce((n, y) => n + y.model.words, 0) /
      Math.max(1, P.years.filter(y => y.model).length))
  });
}

console.log('\n=== 范文合并 ===');
report.forEach(r => {
  console.log(`  ${r.label}`);
  console.log(`      需要 ${r.需要} 篇 · 已合并 ${r.已有范文} 篇 · 平均 ${r.平均词数} 词`);
  if (r.缺失.length) console.log(`      缺：${r.缺失.join(', ')}`);
});

if (bad.length) {
  console.log('\n✗ 问题 ' + bad.length + ' 处：');
  bad.slice(0, 40).forEach(b => console.log('   · ' + b));
  if (bad.length > 40) console.log(`   … 另有 ${bad.length - 40} 处`);
  if (!CHECK) { console.log('\n（未写盘。修好后重跑，或加 --check 只看报告）'); process.exit(1); }
} else {
  console.log('\n✓ 校验全部通过');
}

if (CHECK) { console.log('（--check 模式，未写盘）\n'); process.exit(bad.length ? 1 : 0); }

fs.writeFileSync(IDX, JSON.stringify(idx, null, 2) + '\n', 'utf8');
console.log('\n✓ 已写回 ' + IDX + '\n');
