#!/usr/bin/env node
/**
 * 성공사례 통합 인덱스 생성 — node scripts/build-case-index.mjs
 *
 * 성공사례는 두 종류다.
 *   1) 깊게 쓴 해설 글 (blog/cases.json) — 2,500~4,000자, 개별 페이지가 있다
 *   2) 처분 결과 문서가 있는 수행사례 (content/lawtalk-cases.json) — 요약 + 판결문 이미지
 *
 * 예전에는 2번을 /cases 라는 별도 페이지로 뺐는데, 성공사례를 보러 온 사람이
 * 두 군데를 오가야 했다. 그래서 하나로 합쳐 board?type=case 한 곳에서 보게 한다.
 * 2번을 개별 페이지로 만들지 않는 이유는 본문이 중앙값 830자라 얇은 페이지가
 * 73개 생기고, 그건 색인에 해롭기 때문이다.
 *
 * 결과물: blog/case-index.json (board.html 이 이것만 읽는다)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEEP = path.join(ROOT, 'blog', 'cases.json');
const LAWTALK = path.join(ROOT, 'content', 'lawtalk-cases.json');
const IMG_DIR = path.join(ROOT, 'images', 'cases');
const OUT = path.join(ROOT, 'blog', 'case-index.json');

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').replace(/[^가-힣0-9a-z]/gi, '');

/** 결과 → 배지 색 구분 */
function kindOf(r) {
  const s = String(r || '');
  if (/무죄|혐의없음|불송치|각하|불입건|기각|심리불개시/.test(s)) return 'clear';
  if (/기소유예|선고유예|보호처분|감호/.test(s)) return 'defer';
  if (/집행유예/.test(s)) return 'susp';
  return 'other';
}

/** 로톡 카테고리가 잘게 갈려 있어 훑어보기 좋게 합친다 */
function fieldOf(text) {
  const t = String(text || '');
  if (/마약/.test(t)) return '마약';
  if (/음주|교통/.test(t)) return '음주·교통';
  if (/스토킹/.test(t)) return '스토킹';
  if (/성폭력|강제추행|강간|성착취|불법촬영|통매음|준강간|유사강간|몰카|카메라|성범죄/.test(t)) return '성범죄';
  if (/소년/.test(t)) return '소년';
  if (/군형법|병역|해병|군 징계|군징계/.test(t)) return '군사건';
  if (/이혼|상간|양육|재산분할|상속/.test(t)) return '가사·상속';
  if (/절도|사기|횡령|뇌물|보이스피싱|전세사기|공갈/.test(t)) return '재산범죄';
  if (/폭행|상해|협박|명예훼손|공무집행/.test(t)) return '폭력·명예';
  return '형사일반';
}

const deep = JSON.parse(fs.readFileSync(DEEP, 'utf8'));
const lawtalk = fs.existsSync(LAWTALK) ? JSON.parse(fs.readFileSync(LAWTALK, 'utf8')) : [];
const have = new Set(fs.existsSync(path.join(IMG_DIR, 'lawtalk')) ? fs.readdirSync(path.join(IMG_DIR, 'lawtalk')) : []);

/**
 * 해설 글 ↔ 로톡 수행사례 대응표.
 *
 * 제목만으로는 같은 사건인지 못 가린다. 로톡 제목과 사이트 제목이 어순·표현이 달라
 * 앞 12자 비교로는 하나도 안 걸렸다. 그래서 직접 확인한 것만 적어 둔다.
 * 여기 적힌 건은 카드를 두 개 만들지 않고, 해설 글 카드에 판결문 이미지만 얹는다.
 * 새 해설 글을 쓰면 이 표에 한 줄 추가하면 된다.
 */
const PAIRED = {
  'special-assault-deferred-prosecution-case': 150407,
  'military-cruelty-non-prosecution-case': 179779,
  'public-official-stalking-no-booking-case': 173014,
  'disabled-quasi-rape-no-charge-case': 166441,
  'subway-molestation-deferred-prosecution': 164346,
  'juvenile-molestation-no-hearing-case': 157211,
  'drunk-groping-deferred-prosecution': 150409,
  'no-charge-5-counts': 137566,
  'public-official-molestation-appeal-reduction-case': 187851,
  'minor-victim-molestation-deferred-prosecution-case': 187651,
  'drug-repeat-purchase-suspended-sentence-case': 187634,
};

const imgsOf = (c) => (c.images || []).map((_, i) => {
  const base = `${c.number}${i ? `-${i + 1}` : ''}`;
  return ['png', 'jpg'].map((e) => `${base}.${e}`).find((n) => have.has(n));
}).filter(Boolean);

const byNumber = new Map(lawtalk.map((c) => [Number(c.number), c]));

/* ── 1) 해설 글 ─────────────────────────────── */
const items = deep.map((c) => {
  // 분야는 한 규칙으로만 정한다. 예전에 손으로 적어 둔 값과 섞이면 필터가 중복된다.
  const field = fieldOf(`${c.title} ${(c.tags || []).join(' ')} ${c.field ?? ''}`);

  // 이미 붙어 있는 판결문 → 없으면 대응표의 로톡 문서를 얹는다
  let image = '';
  let images = [];
  const own = `${c.slug.replace(/-case$/, '')}.jpg`;
  if (c.hasDocument && fs.existsSync(path.join(IMG_DIR, own))) {
    image = `/images/cases/${own}`;
    images = [image];
  } else if (PAIRED[c.slug] && byNumber.has(PAIRED[c.slug])) {
    const got = imgsOf(byNumber.get(PAIRED[c.slug])).map((n) => `/images/cases/lawtalk/${n}`);
    if (got.length) { [image] = got; images = got; }
  }

  return {
    kind: 'article',
    slug: c.slug,
    url: `/blog/${c.slug}`,
    title: c.title,
    summary: c.summary || '',
    result: c.result || '',
    resultKind: kindOf(c.result),
    field,
    date: c.date || '',
    image,
    images,
  };
});

/* ── 2) 처분 문서가 있는 수행사례 ──────────────── */
const paired = new Set(Object.values(PAIRED));

for (const c of lawtalk) {
  if (paired.has(Number(c.number))) continue;   // 해설 글로 이미 다뤘다
  const imgs = imgsOf(c);
  if (!imgs.length) continue;                   // 문서 없는 건 이 층에 둘 이유가 없다

  items.push({
    kind: 'record',
    slug: `lt-${c.number}`,
    url: '',                                   // 개별 페이지 없음 — 목록에서 펼쳐 본다
    title: c.title,
    summary: strip(c.htmlContent),
    result: c.result || '',
    resultKind: kindOf(c.result),
    field: fieldOf(`${c.title} ${(c.categories || []).join(' ')} ${(c.keywords || []).join(' ')}`),
    date: String(c.createdAt || '').slice(0, 10).replace(/-/g, '.'),
    image: `/images/cases/lawtalk/${imgs[0]}`,
    images: imgs.map((n) => `/images/cases/lawtalk/${n}`),
  });
}

/* 최신순 */
const key = (d) => Number(String(d).replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8)) || 0;
items.sort((a, b) => key(b.date) - key(a.date));

fs.writeFileSync(OUT, `${JSON.stringify(items, null, 1)}\n`);

const byField = {};
items.forEach((x) => { byField[x.field] = (byField[x.field] ?? 0) + 1; });
console.log(`case-index.json — 총 ${items.length}건 (해설 ${items.filter((x) => x.kind === 'article').length} · 문서 ${items.filter((x) => x.kind === 'record').length})`);
console.log(`판결문 이미지 붙은 카드: ${items.filter((x) => x.image).length}건`);
console.log('분야:', Object.entries(byField).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(' / '));
