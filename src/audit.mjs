#!/usr/bin/env node
/** 语料内容质量审计：初级词泄漏 / 跨板块重复 / 例句长度 / 编码 / 字段异常 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'data');
const files = fs.readdirSync(DATA).filter(f => /^\d{2}-/.test(f) && f.endsWith('.json') && !f.startsWith('00-')).sort();

const BASIC = ['good', 'bad', 'many', 'much', 'important', 'think', 'happy', 'big', 'small', 'very',
  'get', 'make', 'thing', 'people', 'way', 'a lot of', 'more and more', 'nice', 'ok', 'beautiful', 'difficult'];

const all = [];
const byEn = new Map();
const problems = [];
const stats = {};

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  stats[d.id] = { title: d.title, n: 0, types: {}, noKeyword: 0, shortEx: 0, longEx: 0, basicLeak: 0, badChars: 0, basic: {} };
  const s = stats[d.id];
  for (const e of d.entries) {
    s.n++;
    s.types[e.type] = (s.types[e.type] || 0) + 1;
    if (e.basic) s.basic[e.basic] = (s.basic[e.basic] || 0) + 1;

    const en = e.en.toLowerCase();
    // 初级词泄漏：仅当 en 是单独一个初级词时算问题
    if (BASIC.includes(en.trim())) { s.basicLeak++; problems.push(`[初级词] ${d.id}: "${e.en}"`); }
    // 例句是否包含该表达的核心词
    const kw = e.en.toLowerCase().replace(/[_…]/g, '').split(/[\s/()]+/).filter(w => w.length > 3)[0];
    if (kw && !e.example.toLowerCase().includes(kw.slice(0, Math.min(5, kw.length)))) {
      s.noKeyword++; problems.push(`[例句未含关键词 "${kw}"] ${d.id}: ${e.en} → ${e.example}`);
    }
    const wc = e.example.trim().split(/\s+/).length;
    if (wc < 6) { s.shortEx++; problems.push(`[例句过短 ${wc}词] ${d.id}: ${e.en}`); }
    if (wc > 32) { s.longEx++; problems.push(`[例句过长 ${wc}词] ${d.id}: ${e.en}`); }
    if (/[\uFFFD]/.test(e.en + e.zh + e.example + e.exampleZh + e.note)) { s.badChars++; problems.push(`[乱码] ${d.id}: ${e.en}`); }
    if (/[，。；：（）【】“”]/.test(e.en)) problems.push(`[英文里混入中文标点] ${d.id}: ${e.en}`);
    if (e.exampleZh && !/[\u4e00-\u9fa5]/.test(e.exampleZh)) problems.push(`[译文无中文] ${d.id}: ${e.en}`);

    const k = en.trim();
    if (byEn.has(k)) problems.push(`[跨板块重复] "${e.en}" 同时出现在 ${byEn.get(k)} 和 ${d.id}`);
    else byEn.set(k, d.id);
    all.push({ sid: d.id, ...e });
  }
}

console.log('\n=== 各板块统计 ===');
console.log('  板块'.padEnd(22) + '条数  word phrase pattern proverb  初级词 例句未含词 乱码  替换词种类');
let T = 0;
for (const [id, s] of Object.entries(stats)) {
  T += s.n;
  const t = s.types;
  console.log('  ' + (id + ' ' + s.title).slice(0, 21).padEnd(22) +
    String(s.n).padStart(3) +
    String(t.word || 0).padStart(6) + String(t.phrase || 0).padStart(7) +
    String(t.pattern || 0).padStart(8) + String(t.proverb || 0).padStart(8) +
    String(s.basicLeak).padStart(6) + String(s.noKeyword).padStart(10) +
    String(s.badChars).padStart(5) + String(Object.keys(s.basic).length).padStart(9));
}
console.log('  ' + '合计'.padEnd(22) + String(T).padStart(3));

console.log('\n=== 高级替换词表 basic 分布 ===');
console.log('  ' + Object.entries(stats.upgrade.basic).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join('  '));

console.log('\n=== 问题清单 (' + problems.length + ') ===');
const byKind = {};
problems.forEach(p => { const k = p.slice(1, p.indexOf(']')); (byKind[k] = byKind[k] || []).push(p); });
Object.entries(byKind).forEach(([k, v]) => {
  console.log(`\n  ▸ ${k}  ×${v.length}`);
  v.slice(0, 12).forEach(x => console.log('      ' + x));
  if (v.length > 12) console.log(`      … 另有 ${v.length - 12} 条`);
});

console.log('\n=== 随机抽样（每板块 2 条）===');
for (const [id, s] of Object.entries(stats)) {
  const arr = all.filter(e => e.sid === id);
  for (let i = 0; i < 2; i++) {
    const e = arr[Math.floor(Math.random() * arr.length)];
    console.log(`\n  【${id}】${e.en}  (${e.pos}, ${e.type})${e.basic ? '  ← ' + e.basic : ''}`);
    console.log(`     ${e.zh}`);
    console.log(`     ${e.example}`);
    console.log(`     ${e.exampleZh}`);
    console.log(`     ${e.note}`);
  }
}
