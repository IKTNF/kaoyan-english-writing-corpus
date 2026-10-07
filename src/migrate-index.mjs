#!/usr/bin/env node
/**
 * 把考研真题考据结果 + 原有的主题归类，合并成新的 data/00-index.json
 *
 *   结构：{ partA: {小作文}, partB: {大作文}, notes: [...] }
 *
 *   node src/migrate-index.mjs            # 生成（旧的自动备份为 00-index.old.json）
 *   node src/migrate-index.mjs --dry      # 只打印不写盘
 *
 * 数据来源：
 *   data/_research/dazuowen-1998-2015.json    大作文题面考据
 *   data/_research/dazuowen-2016-2025.json    大作文题面考据
 *   data/_research/xiaozuowen-2005-2015.json  小作文题面考据
 *   data/_research/xiaozuowen-2016-2025.json  小作文题面考据
 *   data/00-index.json                        原有的「主题 → 语料板块」归类与备考提示
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'data');
const R = p => path.join(DATA, '_research', p);
const IDX = path.join(DATA, '00-index.json');
const DRY = process.argv.includes('--dry');

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
/* 幂等：原始「主题→板块」归类只存在于迁移前的文件里。
   第一次运行时 00-index.json 还是旧结构，之后它已被重写，
   所以一旦备份存在就永远从备份读，重跑不会丢失 sections / tip。 */
const ORIG = path.join(DATA, '00-index.old.json');
const SRC = fs.existsSync(ORIG) ? ORIG : IDX;
const old = read(SRC);
const olds = new Map((old.years || []).map(y => [y.year, y]));
console.log(`  （主题归类来源：${path.basename(SRC)}，${olds.size} 年）`);

const dzA = read(R('dazuowen-1998-2015.json')).items;
const dzB = read(R('dazuowen-2016-2025.json')).items;
const xzA = read(R('xiaozuowen-2005-2015.json')).items;
const xzB = read(R('xiaozuowen-2016-2025.json')).items;

/* ---------- 大作文：需要人工补的板块归类与提示 ---------- */
const B_EXTRA = {
  1998: { sections: ['society', 'quality', 'describe'], tip: '诚信与承诺。漫画讽刺"只承诺最保险的事"，可写职业操守、社会责任、言行一致。' },
  2000: { sections: ['environment', 'describe', 'argue'], tip: '两图对比（1900 鱼多船少 / 1995 船多鱼少）。首段必须写出对比，主体段解释过度捕捞的成因，结尾落到可持续发展。' },
  2002: { sections: ['culture', 'describe'], tip: '照片题。文化多元与融合，可写"民族的即世界的"。' },
  2006: { sections: ['society', 'quality', 'describe'], tip: '照片题。辩证看待追星：适度激励 vs 盲目模仿，落点"理性追星、崇尚内在"。' }
};

/* ---------- 小作文：板块归类 + 备考提示（我手工撰写） ---------- */
const A_MAP = {
  2005: { sections: ['letter-general', 'letter-apply'], tip: '辞职信。三段：说明去意 → 给出理由 → 致歉并祝愿。语气要体面，切勿抱怨。' },
  2006: { sections: ['letter-general', 'letter-apply'], tip: '申请/求助信。说清"请求什么"+"资助哪类孩子"+"如何落实"，条理是拿分点。' },
  2007: { sections: ['letter-general', 'letter-advice'], tip: '建议信。开篇表明身份与目的，主体 2 条建议要具体可操作，结尾表达感谢与期待。' },
  2008: { sections: ['letter-general', 'letter-apply'], tip: '道歉信。先致歉 → 解释原因（不找借口）→ 主动提出补救方案，这是关键得分点。' },
  2009: { sections: ['letter-general', 'letter-advice'], tip: '建议信（给编辑）。先简要表态限塑效果不佳，再给 2-3 条建议，注意面向公众的措辞。' },
  2010: { sections: ['letter-general', 'notice'], tip: '通知（研究生会署名）。标题居中大写，正文写清岗位、条件与报名方式，落款是组织不是个人。' },
  2011: { sections: ['letter-general', 'letter-advice'], tip: '推荐信。推荐电影 + 给理由；理由分两层（剧情/主题/观感），避免只说"很好看"。' },
  2012: { sections: ['letter-general', 'letter-advice'], tip: '欢迎 + 建议信（学生会署名）。先表示欢迎，再给校园生活建议；注意署名是 Students\' Union。' },
  2013: { sections: ['letter-general', 'letter-advice'], tip: '邀请信。写明活动名称、时间、地点、身份，并礼貌请对方确认出席。' },
  2014: { sections: ['letter-general', 'letter-advice'], tip: '建议信（给校长）。语气正式得体，建议要宏观（体育设施、锻炼氛围），不要写成抱怨信。' },
  2015: { sections: ['letter-general', 'letter-advice'], tip: '推荐信（读书会）。推荐一本书 + 理由；与 2011 推荐电影是同一套句式，可一起背。' },
  2016: { sections: ['letter-general', 'notice'], tip: '通知（图书馆员署名）。欢迎新生 + 告知开放时间、借阅规则；注意通知不用书信称呼语。' },
  2017: { sections: ['letter-general', 'letter-advice'], tip: '推荐信（给外籍教授）。推荐本地景点 + 理由；注意用 email 形式但仍要正式礼貌。' },
  2018: { sections: ['letter-general', 'letter-advice'], tip: '邀请信（全体外国专家）。毕业典礼的时间、地点、其他信息三要素齐全，结尾请对方确认出席。' },
  2019: { sections: ['letter-general', 'letter-apply'], tip: '回信（答复咨询）。逐条回答对方的问题，细节要充分；回信要呼应来信的问法。' },
  2020: { sections: ['letter-general', 'notice'], tip: '通知（面向全体留学生）。主题是历史景点游览，写清活动安排与报名方式。' },
  2021: { sections: ['letter-general', 'letter-advice'], tip: '建议信（给求职的外国朋友）。建议要落地：语言、简历、行业选择、面试准备。' },
  2022: { sections: ['letter-general', 'letter-advice'], tip: '邀请信（给英国大学教授）。邀请其组建团队参加国际创新大赛，写清赛事、时间与期待。' },
  2023: { sections: ['letter-general', 'notice'], tip: '通知（招 1 名学生参与 Smith 教授项目）。资格要求 + 报名方式 + 截止时间三件套。' },
  2024: { sections: ['letter-general', 'letter-advice'], tip: '读信 + 回信建议。先回应对方的处境，再给具体建议，语气要体贴。' },
  2025: { sections: ['letter-general', 'letter-apply'], tip: '回信（答复同学来信的两点）。逐点回应，结构清晰是首要评分点。' }
};

/* ---------- 组装 partB ---------- */
const partB_years = [...dzA, ...dzB]
  .sort((a, b) => a.year - b.year)
  .map(r => {
    const o = olds.get(r.year) || {};
    const ex = B_EXTRA[r.year] || {};
    return {
      year: r.year,
      chartType: r.chartType || '图画',
      titleZh: r.titleZh || o.topicZh || '',
      topicEn: r.topicEn || o.topicEn || '',
      pictureZh: r.pictureZh || '',
      captions: r.captions && r.captions.length ? r.captions : [],
      directionsZh: r.directionsZh || '描述图画并解释其含义，给出你的评论。',
      sections: ex.sections || o.sections || [],
      tip: ex.tip || o.tip || '',
      confidence: r.confidence || 'high',
      note: r.corrected ? String(r.corrected) : '',
      sources: r.sources || []
    };
  });

/* ---------- 组装 partA ---------- */
const partA_years = [...xzA, ...xzB]
  .sort((a, b) => a.year - b.year)
  .map(r => {
    const m = A_MAP[r.year] || { sections: ['letter-general'], tip: '' };
    return {
      year: r.year,
      type: r.type || '应用文',
      recipient: r.recipient || '',
      taskZh: r.taskZh || '',
      points: r.points || [],
      directionsEn: r.directionsEn || '',
      sections: m.sections,
      tip: m.tip,
      confidence: r.confidence || 'high',
      note: r.note || '',
      sources: r.sources || []
    };
  });

/* ---------- 顶层提示 ---------- */
const notes = [
  '命题规律：近 28 年英语一大作文高度集中在五大话题族——① 个人品质与成功素养（2004/2007/2008/2012/2017/2019/2020）② 文化传承与交流（2002/2010/2021/2023）③ 科技与媒介（2009/2015）④ 社会公德与家庭伦理（1998/2001/2003/2005/2006/2011/2014/2016）⑤ 学习与青年选择（2013/2018/2022）。把这五族的语料背熟，基本可以覆盖任意新题。',
  '题型分布：1998—2025 共 28 年，仅 1999 年是真正的图表题，其余全为图画/照片；2002 与 2006 是照片类（picture/photograph），写法与漫画一致。2025 年重回图表题（居民耐用消费品拥有量变化），因此图表描述句必须一起准备。',
  '分值演变：1998—2000 年不少于 150 词、15 分；2001—2004 年约 200 词、20 分；2005 年起增加 Part A 小作文，大作文降为 160—200 词、20 分。现在一律按 160—200 词练。',
  '首段写法固定：描述画面（含图上文字）→ 点出寓意。主体段两到三点理由。结尾段总结 + 建议/呼吁。任何题目都能套这三步。'
];

const notesA = [
  '题型频率：建议信最多（2007/2009/2012/2014/2021/2024），其次通知（2010/2016/2020/2023）与邀请信（2013/2018/2022）；推荐信（2011/2015/2017）近十年明显升温。把「建议信 + 通知 + 邀请信 + 推荐信」四类吃透，覆盖面已超七成。',
  '格式分不能丢：英语一统一署名 Li Ming（通知类用组织名，如 the Postgraduate Association / the Students\' Union）。署名后不要加点；书信称呼后用逗号；通知要居中大写标题 NOTICE，落款写组织与日期。',
  '近年趋势是「读信 + 回信」：2019、2024、2025 都要求先读懂来信内容再逐条回应。答题时把对方的问题逐点对应回答，比堆砌套话更容易得分。',
  '字数控制：约 100 词，正文 7—9 句足够。宁可少而准，不要为了凑字数写与要点无关的句子。'
];

const out = {
  title: '历年真题索引',
  desc: '考研英语一 Section III 写作真题逐年题面与原创范文。原题部分为考据结果，标注来源与置信度；范文为本书原创，非官方答案。',
  partB: {
    title: '大作文真题索引',
    subtitle: 'Part B · 图画/图表作文 160—200 词 · 1998—2025',
    emoji: '🗂',
    years: partB_years,
    notes
  },
  partA: {
    title: '小作文真题索引',
    subtitle: 'Part A · 应用文 约 100 词 · 2005—2025',
    emoji: '✉️',
    years: partA_years,
    notes: notesA
  }
};

/* ---------- 报告 ---------- */
console.log('\n=== 迁移结果 ===');
console.log(`  大作文 ${partB_years.length} 套 (${partB_years[0].year}—${partB_years[partB_years.length - 1].year})`);
console.log(`  小作文 ${partA_years.length} 套 (${partA_years[0].year}—${partA_years[partA_years.length - 1].year})`);
const noSection = [...partB_years, ...partA_years].filter(y => !y.sections.length);
if (noSection.length) console.log(`  ! 未归类板块: ${noSection.map(y => y.year).join(', ')}`);
const lowConf = [...partB_years.map(y => ({ ...y, p: 'B' })), ...partA_years.map(y => ({ ...y, p: 'A' }))]
  .filter(y => y.confidence !== 'high');
console.log(`  非高置信度: ${lowConf.length ? lowConf.map(y => y.p + y.year + '(' + y.confidence + ')').join(', ') : '无'}`);
const changed = partB_years.filter(y => {
  const o = olds.get(y.year);
  return o && o.type && o.type !== y.chartType;
});
if (changed.length) console.log(`  题型被订正: ${changed.map(y => y.year + ' ' + olds.get(y.year).type + '→' + y.chartType).join('; ')}`);

const picChanged = partB_years.filter(y => y.note);
if (picChanged.length) console.log(`  题面被订正: ${picChanged.map(y => y.year).join(', ')}`);

if (DRY) { console.log('\n（--dry，未写盘）\n'); process.exit(0); }

if (!fs.existsSync(ORIG)) {
  fs.writeFileSync(ORIG, JSON.stringify(old, null, 2), 'utf8');
  console.log('  （已备份旧结构到 00-index.old.json）');
}
fs.writeFileSync(IDX, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('\n✓ 已写入 ' + IDX + '\n');
