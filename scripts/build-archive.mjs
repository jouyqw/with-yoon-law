/**
 * 크롤러가 글 전체에 닿을 통로를 만든다 — node scripts/build-archive.mjs
 *
 * 왜 필요한가
 *   서치콘솔에서 157편이 "발견됨 - 현재 색인이 생성되지 않음"이고, 최종 크롤링이
 *   전부 "해당사항 없음"이었다. 구글이 주소는 알지만 **한 번도 가져간 적이 없다**는 뜻이다.
 *   (2026-07-01 최초 감지, 2026-09-27 확인 시점까지 석 달)
 *
 *   원인은 링크다. 목록(board.html)이 posts.json 을 fetch 해서 그리고,
 *   HTML 안에 실제로 박힌 <a> 는 68개뿐이었다. 나머지 글은 사이트맵에만 있고
 *   사이트 어디에서도 링크되지 않는 고아 페이지였다. 사이트맵은 "있다"는 신호일 뿐
 *   "중요하다"는 신호가 아니라서, 링크 없는 페이지는 크롤링 순서가 계속 밀린다.
 *
 * 무엇을 만드나
 *   /blog/ 에 전체 글 목록 페이지. 자바스크립트 없이 순수 <a> 로만 169편을 건다.
 *   분야별로 묶어 사람도 훑어볼 수 있게 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG = path.join(ROOT, 'blog');
const SITE = 'https://with-yoon-law.com';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 태그가 잘게 갈려 있어 훑어보기 좋게 묶는다 */
function fieldOf(text) {
  const t = String(text || '');
  if (/마약|필로폰|대마/.test(t)) return '마약';
  if (/음주|교통|무면허|뺑소니/.test(t)) return '음주·교통';
  if (/스토킹/.test(t)) return '스토킹';
  if (/성폭력|강제추행|강간|성착취|불법촬영|통매음|준강간|카메라|성범죄/.test(t)) return '성범죄';
  if (/소년|학교폭력/.test(t)) return '소년·학교폭력';
  if (/군형법|병역|군사/.test(t)) return '군사건';
  if (/이혼|상간|양육|재산분할|상속|가사/.test(t)) return '가사·상속';
  if (/절도|사기|횡령|배임|뇌물|보이스피싱|전세사기|공갈|재산/.test(t)) return '재산범죄';
  if (/폭행|상해|협박|명예훼손|공무집행/.test(t)) return '폭력·명예';
  if (/경찰조사|수사|구속|영장|재판|항소|형사절차|피의자/.test(t)) return '수사·형사절차';
  return '형사일반';
}

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const posts = readJson(path.join(BLOG, 'posts.json'));
const cases = readJson(path.join(BLOG, 'case-index.json'));

// 두 목록을 합치고 slug 로 중복을 없앤다. 실제로 파일이 있는 글만 싣는다 —
// 없는 주소를 링크하면 404 를 스스로 만들어 내는 꼴이다.
const seen = new Set();
const items = [];
for (const c of [...posts, ...cases]) {
  const slug = c.slug || String(c.url || '').replace(/^\/blog\//, '').replace(/\/$/, '');
  if (!slug || seen.has(slug)) continue;
  if (!fs.existsSync(path.join(BLOG, `${slug}.html`))) continue;
  seen.add(slug);
  items.push({
    slug,
    title: c.title || slug,
    summary: c.summary || c.description || '',
    date: String(c.date || '').replace(/-/g, '.'),
    field: fieldOf(`${c.title} ${(c.tags || []).join(' ')} ${c.field ?? ''}`),
  });
}

const key = (d) => Number(String(d).replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8)) || 0;
items.sort((a, b) => key(b.date) - key(a.date));

const groups = new Map();
for (const it of items) {
  if (!groups.has(it.field)) groups.set(it.field, []);
  groups.get(it.field).push(it);
}
const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

const sections = ordered.map(([field, list]) => `<section class="grp">
    <h2>${esc(field)} <span>${list.length}편</span></h2>
    <ul>
      ${list.map((it) => `<li><a href="/blog/${esc(it.slug)}">${esc(it.title)}</a>${it.summary ? `<p>${esc(it.summary.slice(0, 110))}</p>` : ''}</li>`).join('\n      ')}
    </ul>
  </section>`).join('\n  ');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>법률 칼럼·성공사례 전체 목록 ${items.length}편 | 법률사무소 위드윤</title>
<meta name="description" content="법률사무소 위드윤 유성호 변호사가 작성한 형사·성범죄·마약·음주운전·가사 사건 칼럼과 성공사례 ${items.length}편의 전체 목록입니다.">
<meta name="robots" content="index,follow,max-snippet:-1">
<link rel="canonical" href="${SITE}/blog/">
<meta property="og:type" content="website">
<meta property="og:title" content="법률 칼럼·성공사례 전체 목록 | 법률사무소 위드윤">
<meta property="og:url" content="${SITE}/blog/">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans KR',sans-serif;color:#1f2733;background:#f6f7f9;line-height:1.7;word-break:keep-all}
.top{background:#07162f;color:#fff}
.top-in{max-width:1000px;margin:0 auto;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:14px}
.top a{color:#fff;text-decoration:none;font-weight:800}
.top .btn{background:#d8ad4d;color:#1c1405;padding:9px 15px;border-radius:7px;font-size:14px}
main{max-width:1000px;margin:0 auto;padding:36px 20px 70px}
h1{font-size:27px;line-height:1.4;margin:0 0 10px;letter-spacing:-.02em}
.lead{color:#5b687b;margin:0 0 8px}
.crumb{color:#7b8698;font-size:14px;margin:0 0 22px}
.crumb a{color:#193b70;font-weight:700;text-decoration:none}
.grp{background:#fff;border:1px solid #e3e7ee;border-radius:12px;padding:22px 20px;margin:0 0 16px}
.grp h2{font-size:19px;margin:0 0 14px;color:#07162f}
.grp h2 span{color:#8b93a1;font-size:14px;font-weight:600;margin-left:6px}
.grp ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.grp li{padding-bottom:12px;border-bottom:1px solid #f0f2f5}
.grp li:last-child{border-bottom:0;padding-bottom:0}
.grp a{color:#101828;font-weight:700;text-decoration:none;font-size:16px;line-height:1.5}
.grp a:hover{color:#193b70;text-decoration:underline}
.grp p{margin:5px 0 0;color:#6b7684;font-size:14px;line-height:1.65}
.foot{background:#07162f;color:#cfd9e6;font-size:13.5px}
.foot-in{max-width:1000px;margin:0 auto;padding:24px 20px;line-height:1.9}
.foot a{color:#d8ad4d;font-weight:700;text-decoration:none;margin-right:12px}
@media(max-width:600px){main{padding:26px 15px 56px}h1{font-size:22px}.grp{padding:18px 15px}.grp a{font-size:15px}}
</style>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: `법률 칼럼·성공사례 전체 목록 ${items.length}편`,
  url: `${SITE}/blog/`,
  isPartOf: { '@type': 'WebSite', name: '법률사무소 위드윤', url: `${SITE}/` },
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/blog/${it.slug}`, name: it.title })),
  },
})}</script>
</head><body>
<nav class="top"><div class="top-in"><a href="/">법률사무소 위드윤</a><a class="btn" href="tel:010-9491-1567">상담전화</a></div></nav>
<main>
  <div class="crumb"><a href="/">홈</a> · 전체 글 목록</div>
  <h1>법률 칼럼·성공사례 전체 목록</h1>
  <p class="lead">유성호 변호사가 작성한 ${items.length}편을 분야별로 정리했습니다.</p>
  <p class="crumb"><a href="/board?type=column">칼럼 보기</a> · <a href="/board?type=case">성공사례 보기</a> · <a href="/records">판결문 기록</a></p>
  ${sections}
</main>
<footer class="foot"><div class="foot-in">
  <strong>법률사무소 위드윤</strong><br>
  서울 서초구 서초대로 270 서보빌딩 602호 · 광고책임변호사 윤성호<br>
  <a href="/">홈</a><a href="/board?type=column">칼럼</a><a href="/board?type=case">성공사례</a><a href="tel:010-9491-1567">010-9491-1567</a>
</div></footer>
</body></html>
`;

fs.writeFileSync(path.join(BLOG, 'index.html'), html);
console.log(`/blog/ 전체 목록 생성 — ${items.length}편`);
console.log('분야:', ordered.map(([f, l]) => `${f} ${l.length}`).join(' · '));
