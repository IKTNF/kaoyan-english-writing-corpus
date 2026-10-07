#!/usr/bin/env node
/**
 * 考研英语一 · 作文语料库 构建脚本
 *
 *   node src/build.mjs
 *
 * 1. 读取 data/NN-*.json，做结构与去重校验
 * 2. 读取 data/00-index.json（历年真题主题索引）
 * 3. 把全部数据内联进 src/template.html，产出可双击直接打开的 index.html
 * 4. 同时导出 markdown/<板块>.md 与 markdown/全部语料.md（便于打印 / 复制到 Anki）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'data');
const MDDIR = path.join(ROOT, 'markdown');
const TPL = path.join(HERE, 'template.html');
const OUT = path.join(ROOT, 'index.html');

const GROUP_ORDER = ['大作文·主题语料', '大作文·通用工具箱', '小作文·应用文语料'];
const TYPES = new Set(['word', 'phrase', 'pattern', 'proverb']);
const REQ = ['en', 'zh', 'pos', 'type', 'example', 'exampleZh', 'note'];

const errors = [];
const warns = [];
const die = m => errors.push(m);

/* ---------------- load ---------------- */
if (!fs.existsSync(DATA)) { console.error('✗ 找不到 data 目录: ' + DATA); process.exit(1); }

const files = fs.readdirSync(DATA)
  .filter(f => /^\d{2}-[a-z0-9-]+\.json$/i.test(f) && !f.startsWith('00-'))
  .sort();

if (!files.length) { console.error('✗ data 目录里没有 NN-*.json 数据文件'); process.exit(1); }

const sections = [];
for (const f of files) {
  const full = path.join(DATA, f);
  let raw;
  try { raw = fs.readFileSync(full, 'utf8'); }
  catch (e) { die(`${f}: 无法读取 (${e.message})`); continue; }

  let d;
  try { d = JSON.parse(raw); }
  catch (e) { die(`${f}: JSON 解析失败 → ${e.message}`); continue; }

  for (const k of ['id', 'title', 'emoji', 'group', 'desc', 'entries'])
    if (d[k] === undefined || d[k] === null || d[k] === '') die(`${f}: 缺少字段 "${k}"`);

  if (!Array.isArray(d.entries)) { die(`${f}: entries 必须是数组`); continue; }
  if (!GROUP_ORDER.includes(d.group)) warns.push(`${f}: group "${d.group}" 不在预设分组里`);

  const seen = new Set();
  const entries = [];
  d.entries.forEach((e, i) => {
    const tag = `${f}#${i + 1}(${e && e.en ? e.en : '?'})`;
    if (!e || typeof e !== 'object') { die(`${tag}: 不是对象`); return; }
    for (const k of REQ) if (!e[k] || !String(e[k]).trim()) die(`${tag}: 缺少/为空 "${k}"`);
    if (e.type && !TYPES.has(e.type)) die(`${tag}: type "${e.type}" 非法`);
    if (!e.en || !e.zh) return;
    const key = String(e.en).trim();
    if (seen.has(key.toLowerCase())) { warns.push(`${tag}: 重复条目，已跳过`); return; }
    seen.add(key.toLowerCase());
    /* pos 若被写成 "pattern" 会与 type 徽章重复，统一归一为占位符 */
    const pos0 = String(e.pos || '—').trim();
    entries.push({
      en: String(e.en).trim(),
      basic: e.basic ? String(e.basic).trim() : '',
      zh: String(e.zh).trim(),
      pos: /^(pattern|句式|—|-|)$/i.test(pos0) ? '—' : pos0,
      type: String(e.type).trim(),
      example: String(e.example).trim(),
      exampleZh: String(e.exampleZh).trim(),
      note: String(e.note).trim()
    });
  });

  sections.push({ id: d.id, title: d.title, emoji: d.emoji, group: d.group, desc: d.desc, entries, file: f });
}

/* sort: group order, then filename (NN- prefix) */
const fi = f => files.indexOf(f);
sections.sort((a, b) => {
  const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
  return g !== 0 ? g : fi(a.file) - fi(b.file);
});

/* duplicate ids across files */
const idSeen = new Set();
sections.forEach(s => {
  if (idSeen.has(s.id)) die(`板块 id 重复: ${s.id}`);
  idSeen.add(s.id);
});

/* ---------------- index ---------------- */
let examIndex = null;
const idxFile = path.join(DATA, '00-index.json');
if (fs.existsSync(idxFile)) {
  try {
    examIndex = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
    const ids = new Set(sections.map(s => s.id));
    examIndex.stats = { partA: 0, partB: 0, modelA: 0, modelB: 0, wordsA: 0, wordsB: 0 };

    for (const part of ['partA', 'partB']) {
      const p = examIndex[part];
      if (!p) { die(`00-index.json: 缺少 "${part}"`); continue; }
      for (const k of ['title', 'subtitle', 'years'])
        if (p[k] === undefined) die(`00-index.json: ${part} 缺少 "${k}"`);
      if (!Array.isArray(p.years)) { die(`00-index.json: ${part}.years 必须是数组`); continue; }

      const seenYear = new Set();
      p.years.forEach(y => {
        const tag = `${part} ${y.year}`;
        if (!y.year) die(`00-index.json: ${tag} 缺少 year`);
        if (seenYear.has(y.year)) die(`00-index.json: ${tag} 年份重复`);
        seenYear.add(y.year);
        (y.sections || []).forEach(sid => {
          if (!ids.has(sid)) warns.push(`00-index.json: ${tag} 引用了不存在的板块 id "${sid}"`);
        });
        if (!y.model) { warns.push(`00-index.json: ${tag} 没有范文`); return; }
        const m = y.model;
        if (!String(m.en || '').trim()) { die(`00-index.json: ${tag} 范文缺少 en`); return; }
        if (!String(m.zh || '').trim()) { die(`00-index.json: ${tag} 范文缺少 zh`); return; }
        m.words = String(m.en).trim().split(/\s+/).length;
        m.paras = String(m.en).trim().split(/\n\s*\n/).length;
      });

      const ys = p.years.map(y => y.year);
      examIndex.stats[part] = ys.length;
      examIndex.stats['model' + part.slice(-1)] = p.years.filter(y => y.model).length;
      examIndex.stats['words' + part.slice(-1)] = p.years.reduce((n, y) => n + (y.model ? y.model.words : 0), 0);
    }
  } catch (e) { die(`00-index.json: JSON 解析失败 → ${e.message}`); }
} else {
  warns.push('未找到 data/00-index.json，真题索引将不显示');
}

/* ---------------- report ---------------- */
const total = sections.reduce((n, s) => n + s.entries.length, 0);
if (warns.length) { console.log('\n⚠  警告'); warns.forEach(w => console.log('   · ' + w)); }
if (errors.length) {
  console.log('\n✗  校验未通过（' + errors.length + ' 处）:');
  errors.slice(0, 80).forEach(e => console.log('   · ' + e));
  if (errors.length > 80) console.log(`   … 另有 ${errors.length - 80} 处`);
  process.exit(1);
}

/* ---------------- write html ---------------- */
if (!fs.existsSync(TPL)) { console.error('✗ 找不到模板 src/template.html'); process.exit(1); }
const corpus = { sections, examIndex, builtAt: new Date().toISOString() };
/* 防止数据里出现 </script> 提前闭合标签 */
const payload = JSON.stringify(corpus).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, m => m === '\u2028' ? '\\u2028' : '\\u2029');
const html = fs.readFileSync(TPL, 'utf8').replace('__CORPUS_DATA__', () => payload);
fs.writeFileSync(OUT, html, 'utf8');

/* ---------------- write markdown ---------------- */
fs.mkdirSync(MDDIR, { recursive: true });
const TL = { word: '单词', phrase: '词伙', pattern: '句式', proverb: '金句' };
const mdOf = s => {
  let o = `# ${s.title}\n\n> ${s.desc}\n>\n> 共 ${s.entries.length} 条 · 板块 id \`${s.id}\`\n\n`;
  let last = '';
  s.entries.forEach((e, i) => {
    if (e.type !== last) { o += `\n## ${TL[e.type] || e.type}\n\n`; last = e.type; }
    o += `**${i + 1}. ${e.en}**${e.pos && e.pos !== '—' ? `  \`${e.pos}\`` : ''}${e.basic ? `  ← 替换 \`${e.basic}\`` : ''}\n\n`;
    o += `- 释义：${e.zh}\n`;
    o += `- 例句：${e.example}\n`;
    o += `- 译文：${e.exampleZh}\n`;
    o += `- 用法：${e.note}\n\n`;
  });
  return o;
};
sections.forEach(s => fs.writeFileSync(path.join(MDDIR, `${s.id}.md`), mdOf(s), 'utf8'));

let all = `# 考研英语一 · 作文语料库（全量）\n\n共 ${sections.length} 个板块，${total} 条语料。\n\n## 目录\n\n`;
sections.forEach((s, i) => { all += `${i + 1}. [${s.title}](#${s.id}) — ${s.entries.length} 条\n`; });
all += '\n---\n';
sections.forEach(s => { all += `\n<a id="${s.id}"></a>\n\n` + mdOf(s) + '\n---\n'; });
fs.writeFileSync(path.join(MDDIR, '全部语料.md'), all, 'utf8');

/* ---- 真题索引导出 ---- */
if (examIndex && examIndex.partA && examIndex.partB) {
  const partMd = (p, isA) => {
    let o = `# ${p.title}\n\n> ${p.subtitle}\n>\n> 共 ${p.years.length} 套 · 原创范文 ${p.years.filter(y => y.model).length} 篇\n\n`;
    o += isA
      ? '| 年份 | 题型 | 收信人 / 受众 |\n|---|---|---|\n'
      : '| 年份 | 题型 | 主题 |\n|---|---|---|\n';
    p.years.slice().sort((a, b) => b.year - a.year).forEach(y => {
      o += isA
        ? `| ${y.year} | ${y.type || ''} | ${y.recipient || ''} |\n`
        : `| ${y.year} | ${y.chartType || ''} | ${y.titleZh || ''} |\n`;
    });
    o += '\n---\n';
    p.years.slice().sort((a, b) => b.year - a.year).forEach(y => {
      o += `\n## ${y.year} 年 · ${isA ? (y.type || '') : (y.chartType || '')} · ${isA ? (y.recipient || '') : (y.titleZh || '')}\n\n`;
      if (isA) {
        o += `- **写作任务**：${y.taskZh || ''}\n`;
        if (y.points && y.points.length) o += `- **要点**：${y.points.join('；')}\n`;
        if (y.recipient) o += `- **收信人 / 受众**：${y.recipient}\n`;
      } else {
        if (y.topicEn) o += `- **English topic**：${y.topicEn}\n`;
        if (y.pictureZh) o += `- **图画 / 图表**：${y.pictureZh}\n`;
        if (y.directionsZh) o += `- **写作要求**：${y.directionsZh}\n`;
      }
      if (y.tip) o += `- **可复用角度**：${y.tip}\n`;
      if (y.sections && y.sections.length)
        o += `- **对应语料板块**：${y.sections.map(id => (sections.find(s => s.id === id) || {}).title || id).join(' · ')}\n`;
      if (y.confidence && y.confidence !== 'high') o += `- ⚠️ 题面置信度：${y.confidence}${y.note ? '（' + y.note + '）' : ''}\n`;
      if (y.model) {
        o += `\n### 原创范文（${y.model.words} 词）\n\n`;
        if (y.model.outline && y.model.outline.length)
          o += y.model.outline.map((x, i) => `**${['一', '二', '三', '四'][i] || i + 1}、${x}**`).join('  \n') + '\n\n';
        o += y.model.en.split(/\n\s*\n/).map(x => x.trim()).join('\n\n') + '\n\n';
        o += `> 译文：${y.model.zh}\n`;
      }
      o += '\n---\n';
    });
    if (examIndex.notes && examIndex.notes.length)
      o += '\n## 命题规律 · 备考提示\n\n' + examIndex.notes.map(n => '- ' + n).join('\n') + '\n';
    return o;
  };
  fs.writeFileSync(path.join(MDDIR, '真题索引-大作文.md'), partMd(examIndex.partB, false), 'utf8');
  fs.writeFileSync(path.join(MDDIR, '真题索引-小作文.md'), partMd(examIndex.partA, true), 'utf8');
}

/* ---------------- summary ---------------- */
console.log('\n✓ 构建成功');
console.log('  输出: ' + OUT);
console.log('  大小: ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
console.log('  语料: ' + sections.length + ' 个板块 / ' + total + ' 条\n');
const byGroup = {};
sections.forEach(s => (byGroup[s.group] = byGroup[s.group] || []).push(s));
GROUP_ORDER.filter(g => byGroup[g]).forEach(g => {
  console.log('  ▸ ' + g);
  byGroup[g].forEach(s => console.log(`      ${s.emoji} ${s.title.padEnd(0)}  ${String(s.entries.length).padStart(3)} 条   [${s.id}]`));
});
if (examIndex && examIndex.stats) {
  const s = examIndex.stats;
  console.log('\n  🗂 真题索引');
  console.log(`      ${examIndex.partB ? examIndex.partB.title : '大作文'}   ${String(s.partB).padStart(2)} 套 · 范文 ${s.modelB} 篇 · ${s.wordsB} 词`);
  console.log(`      ${examIndex.partA ? examIndex.partA.title : '小作文'}   ${String(s.partA).padStart(2)} 套 · 范文 ${s.modelA} 篇 · ${s.wordsA} 词`);
}
console.log('\n  markdown/ 已同步导出。\n');
