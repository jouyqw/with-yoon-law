/**
 * 초안의 related / hub 를 실제 발행된 글에서 자동으로 채운다.
 *
 *   node scripts/author/fill-related.mjs          바뀔 내용만 보여 준다
 *   node scripts/author/fill-related.mjs --apply  채우고 다시 렌더링한다
 *
 * 왜 필요한가
 *   글쓰기 프롬프트에 "related 는 넣지 마라" 고 적어 뒀다. LLM 이 없는 주소를 지어내
 *   점검에서 막히기 때문이다. 그 조치는 맞았지만, 대신 내부링크가 통째로 사라졌다.
 *   2026-10-28 점검에서 초안 99편 중 98편이 관련 글 0개였다.
 *   한 글에서 다른 글로 가는 길이 없으면 크롤러가 깊이 들어오지 않고,
 *   한 글이 받은 신뢰가 다른 글로 전해지지도 않는다.
 *
 * 그래서 LLM 에게 맡기지 않고 **이미 있는 글에서 골라 붙인다.**
 * 실제 파일을 보고 고르므로 없는 주소가 생길 수 없다.
 *
 * 고르는 기준
 *   1) 같은 분야(category)에서 가장 최근 글
 *   2) 모자라면 같은 허브(hub)를 쓰는 글
 *   3) 자기 자신과 이미 들어간 글은 뺀다
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const DRAFTS = path.join(ROOT, 'content', 'drafts');
const BLOG = path.join(ROOT, 'blog');
const APPLY = process.argv.includes('--apply');
const WANT = 3;   // 글마다 붙일 관련 글 수

// 분야 안내 페이지. practice 아래 실제로 있는 것만 쓴다.
const HUBS = {
  '성범죄': { href: '/practice/sex-crime/', badge: '성범죄 분야 안내', label: '서초 성범죄 사건 — 분야 종합 안내' },
  '형사': { href: '/practice/criminal/', badge: '형사 분야 안내', label: '서초 형사사건 — 분야 종합 안내' },
  '이혼·가사': { href: '/practice/divorce/', badge: '이혼·가사 분야 안내', label: '서초 이혼·가사 — 분야 종합 안내' },
  '음주·교통': { href: '/practice/dui/', badge: '음주·교통 분야 안내', label: '서초 음주운전·교통사고 — 분야 종합 안내' },
};

const drafts = fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, slug: f.replace(/\.json$/, ''), d: JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8')) }));

// 실제로 발행된 글만 후보로 쓴다. 예약분을 걸면 아직 없는 주소가 된다.
const liveSlugs = new Set(fs.readdirSync(BLOG).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')));
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const pool = drafts
  .filter((x) => liveSlugs.has(x.slug) && String(x.d.date || '') <= TODAY)
  .sort((a, b) => String(b.d.date).localeCompare(String(a.d.date)));

let changed = 0;
for (const item of drafts) {
  const { d } = item;
  const already = Array.isArray(d.related) ? d.related.length : 0;
  const cat = d.category || '';

  const pick = [];
  const seen = new Set([item.slug]);
  for (const src of [pool.filter((p) => p.d.category === cat), pool]) {
    for (const p of src) {
      if (pick.length >= WANT) break;
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      pick.push({ href: `/blog/${p.slug}`, label: p.d.title });
    }
    if (pick.length >= WANT) break;
  }

  const hub = d.hub || HUBS[cat] || null;
  if (already >= WANT && d.hub) continue;
  if (!pick.length && !hub) continue;

  console.log(`${item.slug}  관련 ${already} → ${pick.length}${hub ? ' + 분야안내' : ''}`);
  if (!APPLY) continue;

  d.related = pick;
  if (hub) d.hub = hub;
  fs.writeFileSync(path.join(DRAFTS, item.file), `${JSON.stringify(d, null, 2)}\n`, 'utf8');
  changed += 1;
}

if (!APPLY) { console.log('\n(--apply 를 붙이면 채웁니다)'); process.exit(0); }
console.log(`\n초안 ${changed}편 수정 — 다시 렌더링합니다`);
execFileSync(process.execPath, [path.join(HERE, 'render-article.mjs'), '--all'], { stdio: 'inherit', cwd: ROOT });
execFileSync(process.execPath, [path.join(HERE, 'normalize-urls.mjs')], { stdio: 'inherit', cwd: ROOT });
execFileSync(process.execPath, [path.join(HERE, 'verify.mjs')], { stdio: 'inherit', cwd: ROOT });
