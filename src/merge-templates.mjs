#!/usr/bin/env node
/**
 * 把 data/_research/templates-T*.json 合并成 data/18-templates.json
 *
 *   node src/merge-templates.mjs            # 合并
 *   node src/merge-templates.mjs --check    # 只报告，不写盘
 *
 * 产出是一个「非 entries 型」板块：带 templates 数组，由 build.mjs 单独识别。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'data');
const RESEARCH = path.join(DATA, '_research');
const OUT = path.join(DATA, '18-templates.json');
const CHECK = process.argv.includes('--check');

/* 展示顺序：按真题频率与重要性排 */
const ORDER = ['advice', 'notice', 'recommend', 'invite', 'reply', 'apology',
  'apply', 'resign', 'thanks', 'inquiry', 'job', 'complaint', 'congrats',
  'poster', 'memo', 'note'];

const files = fs.existsSync(RESEARCH)
  ? fs.readdirSync(RESEARCH).filter(f => /^templates-T\d+\.json$/.test(f)).sort()
  : [];
if (!files.length) { console.error('✗ data/_research/ 下没有 templates-T*.json'); process.exit(1); }

const bad = [];
const clamped = [];
const collected = [];
const seen = new Map();

for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(RESEARCH, f), 'utf8')); }
  catch (e) {
    bad.push(`${f}: JSON 解析失败 → ${e.message}`);
    continue;                      // 这个文件整个跳过，绝不再二次解析
  }
  if (!Array.isArray(d.templates)) { bad.push(`${f}: 缺少 templates 数组`); continue; }

  for (const t of d.templates) {
    const tag = `${f}/${t && t.id ? t.id : '?'}`;
    if (!t || !t.id) { bad.push(`${tag}: 缺少 id`); continue; }
    if (seen.has(t.id)) { bad.push(`${tag}: id 与 ${seen.get(t.id)} 重复`); continue; }
    for (const k of ['type', 'typeEn', 'scene', 'freq', 'blocks'])
      if (!t[k]) bad.push(`${tag}: 缺少 "${k}"`);
    if (!Array.isArray(t.blocks) || t.blocks.length < 4) { bad.push(`${tag}: blocks 少于 4 块`); continue; }

    let ok = true;
    t.blocks.forEach((b, i) => {
      for (const k of ['name', 'text', 'zh', 'note'])
        if (!b[k] || !String(b[k]).trim()) { bad.push(`${tag} blocks[${i}]: 缺少 "${k}"`); ok = false; }
    });
    if (!ok) continue;

    const words = t.blocks.map(b => String(b.text).trim()).join(' ').split(/\s+/).length;
    if (words < 60 || words > 170) bad.push(`${tag}: 骨架约 ${words} 词，超出 60-170`);

    seen.set(t.id, f);
    t.words = words;
    t.stars = Math.max(1, Math.min(5, Number(t.stars) || 1));
    /* 没有真题背书的题型不应与已考题型同星 —— 封顶 ★★，避免排序误导复习优先级 */
    if (!(Array.isArray(t.realExams) && t.realExams.length) && t.stars > 2) {
      clamped.push(`${t.type}(${t.id}) ${t.stars}★ → 2★`);
      t.stars = 2;
    }
    t.alternatives = Array.isArray(t.alternatives) ? t.alternatives : [];
    t.pitfalls = Array.isArray(t.pitfalls) ? t.pitfalls : [];
    t.realExams = Array.isArray(t.realExams) ? t.realExams : [];
    collected.push(t);
  }
}

collected.sort((a, b) => {
  const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

/* 未被 ORDER 覆盖的 id 提示一下，方便维护 */
const unknown = collected.filter(t => !ORDER.includes(t.id)).map(t => t.id);
if (unknown.length) bad.push(`ORDER 未收录的模板 id（会排到最后）：${unknown.join(', ')}`);

const out = {
  id: 'templates',
  title: '小作文题型模板库',
  emoji: '🧩',
  group: '小作文·应用文语料',
  desc: '16 类应用文的整篇填空模板：结构骨架 + 备用句 + 易错点 + 真题套用。与 14—17 号句库互补——那边背句子，这边背骨架。',
  templates: collected
};

console.log('\n=== 模板合并 ===');
collected.forEach(t => {
  const exams = t.realExams.length ? t.realExams.map(e => e.year).join('/') : '备用';
  console.log(`  ${'★'.repeat(t.stars).padEnd(5)} ${t.type.padEnd(7)} ${String(t.blocks.length).padStart(2)} 块 · 骨架约 ${String(t.words).padStart(3)} 词 · 备选 ${t.alternatives.length} 组 · 易错 ${t.pitfalls.length} 条 · 真题 ${exams}`);
});
console.log(`\n  合计 ${collected.length} 个模板 · 骨架合计 ${collected.reduce((n, t) => n + t.words, 0)} 词`);
if (clamped.length) console.log(`  （无真题年份，星级已封顶 ★★：${clamped.join('，')}）`);

if (bad.length) {
  console.log('\n✗ 问题 ' + bad.length + ' 处：');
  bad.slice(0, 40).forEach(b => console.log('   · ' + b));
  if (bad.length > 40) console.log(`   … 另有 ${bad.length - 40} 处`);
  if (!CHECK) { console.log('\n（未写盘。注意：JSON 解析失败的文件会被整个跳过）\n'); process.exit(1); }
} else {
  console.log('\n✓ 校验全部通过');
}

if (CHECK) { console.log('（--check，未写盘）\n'); process.exit(bad.length ? 1 : 0); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('\n✓ 已写入 ' + OUT + '\n');
