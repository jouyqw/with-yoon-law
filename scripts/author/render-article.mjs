/**
 * 법률칼럼 렌더러 — 법률사무소 위드윤
 *
 *   node scripts/author/render-article.mjs content/drafts/<slug>.json
 *   node scripts/author/render-article.mjs --all        content/drafts/*.json 전부
 *
 * 초안 JSON 하나를 받아 blog/<slug>.html 을 만든다. 머리말·구조화 데이터·상단바·
 * 사무소 안내·작성자 소개·CTA·푸터는 전부 여기서 붙이므로 초안에는 본문만 쓴다.
 * 디자인은 현재 사이트에서 가장 많이 쓰는 판(scripts/author/article.css)을 그대로 쓴다.
 *
 * 지켜야 할 것
 *   - "형사전문변호사" 같은 전문 표기를 쓰지 않는다. 변협 전문분야 등록이 확인되지 않았다.
 *   - 승소율·성공률·무죄 확률처럼 결과를 단정하거나 보장하는 표현을 쓰지 않는다.
 *   위 두 가지는 renderArticle 이 검사해서 어기면 렌더링을 멈춘다.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = 'https://with-yoon-law.com';
const CSS = readFileSync(path.join(__dirname, 'article.css'), 'utf8');

const TEL = '010-9491-1567';
const OFFICE_TEL = '02-2038-7241';
const KAKAO = 'https://pf.kakao.com/_CNtxjX';

const esc = (v = '') => String(v)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#x27;');

/* ---------- 컴플라이언스 검사 ---------- */
// 전문 표기와 결과 보장은 광고규정 문제로 이어진다. 통과 못 하면 파일을 만들지 않는다.
const FORBIDDEN = [
  { re: /(형사|성범죄|이혼|가사|민사)\s*전문\s*변호사/, why: '전문 표기(변협 전문분야 등록 미확인)' },
  { re: /전문변호사/, why: '전문 표기(변협 전문분야 등록 미확인)' },
  { re: /승소율|성공률|무죄율/, why: '결과 수치' },
  { re: /반드시\s*(무죄|불기소|기소유예)/, why: '결과 단정' },
  { re: /100\s*%|무조건/, why: '결과 보장' },
  { re: /보장(합니다|해\s*드립니다|드립니다)/, why: '결과 보장' },
];

// 검사 대상은 이번에 새로 쓰는 본문만이다. 관련글 카드는 기존 글 제목을 그대로 인용하는데,
// 그중 일부가 예전에 '전문변호사' 표기를 쓰고 있어서 함께 검사하면 새 글까지 막힌다.
function draftOwnText(draft) {
  const parts = [draft.title, draft.description, draft.crumb, ...(draft.tldr || [])];
  for (const s of draft.sections || []) {
    parts.push(s.title);
    for (const b of s.blocks) {
      if (typeof b === 'string') parts.push(b);
      else if (b.type === 'info') parts.push(b.text);
      else if (b.type === 'table') parts.push(...b.rows.flat());
      else if (b.type === 'list') parts.push(...b.items);
      else if (b.type === 'dialog') parts.push(b.title, ...b.lines);
      else if (b.type === 'quote') parts.push(...b.lines);
    }
  }
  for (const f of draft.faqs || []) parts.push(f.q, f.a);
  if (draft.quote) parts.push(...draft.quote);
  if (draft.cta) parts.push(draft.cta.title, draft.cta.sub);
  return parts.join(' ');
}

function assertCompliant(draft) {
  const text = draftOwnText(draft);
  const problems = [];
  for (const { re, why } of FORBIDDEN) {
    const m = text.match(re);
    if (m) problems.push(`${why} — "${m[0]}"`);
  }
  if (problems.length) {
    throw new Error(`${draft.slug}: 금지 표현이 있습니다.\n  - ${problems.join('\n  - ')}`);
  }
}

/* ---------- 본문 블록 ---------- */
function renderBlock(block) {
  if (typeof block === 'string') return `<p class="a-text">${esc(block)}</p>`;

  switch (block.type) {
    case 'info':
      return `<div class="info">${esc(block.text)}</div>`;

    case 'table':
      return `<table class="tbl"><tbody>${block.rows
        .map(([th, td]) => `<tr><th>${esc(th)}</th><td>${esc(td)}</td></tr>`)
        .join('\n')}</tbody></table>`;

    case 'list':
      return `<ul class="list">${block.items
        .map((item, i) => `<li><b>${i + 1}</b><span>${esc(item)}</span></li>`)
        .join('\n')}</ul>`;

    // 상담예시 — 의뢰인/변호사가 주고받는 형식
    case 'dialog':
      return `<div class="dark"><h3>${esc(block.title)}</h3>${block.lines
        .map((line) => `<p>${esc(line)}</p>`)
        .join('\n')}</div>`;

    case 'quote':
      return `<div class="quote"><p>${block.lines.map(esc).join('<br>')}</p></div>`;

    default:
      throw new Error(`알 수 없는 블록 종류: ${block.type}`);
  }
}

function renderSection(section, index) {
  const id = section.id || `s${index + 1}`;
  const head = `${index === 0 ? '' : '<div class="divider"></div>'}<div class="label">${esc(section.label)}</div><h2 class="title" id="${id}">${esc(section.title)}</h2>`;
  return `${head}\n${section.blocks.map(renderBlock).join('\n')}`;
}

/* ---------- 관련 글 ---------- */
// 초안에 /blog/x.html 로 적혀 있어도 최종 주소로 바꿔 내보낸다.
// .html 주소는 Cloudflare Pages 가 308 로 넘기고, 구글은 그 링크를 리디렉션으로 센다.
const finalHref = (href = '') => href.replace(/^(\/blog\/[^#?]+?)\.html/, '$1');

function renderRelated(related = [], hub) {
  const cards = [];
  if (hub) {
    cards.push(
      `<a class="rel-card hub" href="${esc(finalHref(hub.href))}"><span class="badge hub">${esc(hub.badge)}</span><p>${esc(hub.label)}</p><span>분야 전체 보기 &rsaquo;</span></a>`,
    );
  }
  for (const r of related) {
    const isCase = r.kind === 'case';
    cards.push(
      `<a class="rel-card" href="${esc(finalHref(r.href))}"><span class="badge ${isCase ? 'case' : 'col'}">${isCase ? '실제 해결사례' : '법률칼럼'}</span><p>${esc(r.label)}</p><span>${isCase ? '사례 확인' : '자세히 보기'} &rsaquo;</span></a>`,
    );
  }
  if (!cards.length) return '';
  return `<div class="divider"></div><div class="label">RELATED</div><h2 class="title">함께 읽으면 좋은 글</h2><div class="rel-grid">${cards.join('')}</div>`;
}

/* ---------- 문서 ---------- */
export function renderArticle(draft) {
  assertCompliant(draft);
  // Cloudflare Pages 가 /blog/x.html 을 /blog/x 로 308 리디렉션한다.
  // canonical·og:url·구조화 데이터에는 리디렉션되지 않는 최종 주소만 쓴다.
  const url = `${SITE}/blog/${draft.slug}`;
  const keywords = (draft.keywords || []).concat('법률사무소위드윤').join(',');
  const sections = draft.sections || [];
  const faqs = draft.faqs || [];

  const sectionHtml = sections.map(renderSection).join('\n');

  const toc = sections
    .map((s, i) => `<li><a href="#${s.id || `s${i + 1}`}">${esc(s.title)}</a></li>`)
    .concat(faqs.length ? '<li><a href="#faq">자주 묻는 질문</a></li>' : [])
    .concat('<li><a href="#loc">상담·오시는 길</a></li>')
    .join('');

  const faqHtml = faqs.length
    ? `<div class="divider"></div><div class="label">FAQ</div><h2 class="title" id="faq">자주 묻는 질문</h2><div class="faq">\n${faqs
        .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
        .join('\n')}\n</div>`
    : '';

  const quoteHtml = draft.quote
    ? `<div class="quote"><p>${draft.quote.map(esc).join('<br>')}</p></div>`
    : '';

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: draft.title,
    description: draft.description,
    author: {
      '@type': 'Person',
      name: '윤성호',
      jobTitle: '변호사',
      worksFor: { '@type': 'LegalService', name: '법률사무소 위드윤' },
    },
    publisher: {
      '@type': 'LegalService',
      name: '법률사무소 위드윤',
      url: SITE,
      telephone: TEL,
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: draft.date,
    dateModified: draft.date,
    keywords,
    articleSection: `법률칼럼 · ${draft.category}`,
    inLanguage: 'ko',
    speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.tldr', 'h1'] },
    about: (draft.keywords || []).map((name) => ({ '@type': 'Thing', name })),
    isAccessibleForFree: true,
    spatialCoverage: {
      '@type': 'Place',
      name: '서울 서초구(서울중앙지방검찰청)',
      address: {
        '@type': 'PostalAddress',
        addressLocality: '서초구',
        addressRegion: '서울특별시',
        addressCountry: 'KR',
      },
    },
  };

  const faqLd = faqs.length
    ? `\n<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      })}</script>`
    : '';

  const legalService = {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    '@id': `${SITE}/#legalservice`,
    name: '법률사무소 위드윤',
    url: SITE,
    image: `${SITE}/og-image.jpg`,
    telephone: TEL,
    priceRange: '₩₩',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '서초대로 270 서보빌딩 602호',
      addressLocality: '서초구',
      addressRegion: '서울특별시',
      postalCode: '06647',
      addressCountry: 'KR',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 37.4917, longitude: 127.0079 },
    areaServed: [
      '서울 서초구 서초동', '서울 서초구 방배동', '서울 서초구 잠원동', '서울 서초구 반포동',
      '서울 서초구 양재동', '서울 서초구 내곡동', '서울 강남구 역삼동', '서울 강남구 논현동',
      '서울 강남구 삼성동', '서울 동작구 사당동', '서울 동작구 이수', '서울 관악구 낙성대',
      '서초경찰서', '방배경찰서', '서울중앙지방검찰청', '서울중앙지방법원', '서울가정법원',
    ].map((name) => ({ '@type': 'Place', name })),
    knowsAbout: draft.keywords || [],
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '09:00',
      closes: '19:00',
    }],
    founder: { '@type': 'Person', name: '윤성호', jobTitle: '변호사' },
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '홈', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: '법률칼럼', item: `${SITE}/board?type=law` },
      { '@type': 'ListItem', position: 3, name: draft.crumb, item: url },
    ],
  };

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(draft.title)} | 법률사무소 위드윤 윤성호 변호사</title>
<meta name="description" content="${esc(draft.description)}">
<meta name="keywords" content="${esc(keywords)}">
<meta name="author" content="윤성호 변호사 | 법률사무소 위드윤">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(draft.title)} | 법률사무소 위드윤">
<meta property="og:description" content="${esc(draft.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="ko_KR">
<meta property="og:site_name" content="법률사무소 위드윤">
<meta property="article:published_time" content="${draft.date}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="법률사무소 위드윤 윤성호 변호사">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(draft.title)}">
<meta name="twitter:description" content="${esc(draft.description)}">
<meta name="twitter:image" content="${SITE}/og-image.jpg">
<meta name="geo.region" content="KR-11">
<meta name="geo.placename" content="서울특별시 서초구 서초동">
<meta name="geo.position" content="37.4917;127.0079">
<meta name="ICBM" content="37.4917, 127.0079">
<script type="application/ld+json">${JSON.stringify(article)}</script>${faqLd}
<script type="application/ld+json">${JSON.stringify(legalService)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav class="top"><div class="top-in"><a class="brand" href="/"><div class="mark">W</div><div><strong>LAW OFFICE WITH YOON</strong><span>법률사무소 위드윤</span></div></a><div class="top-actions"><a class="btn primary" href="/board?type=law">법률칼럼</a><a class="btn gold" href="tel:${TEL}">☎ <span class="lg">긴급</span>상담</a><a class="btn green" href="${KAKAO}" target="_blank" rel="noopener"><span class="lg">카카오톡</span><span class="sm">카톡</span></a></div></div></nav>
<main class="page">
<nav class="crumb"><a href="/">홈</a><span>›</span><a href="/board?type=law">법률칼럼</a><span>›</span><span>${esc(draft.crumb)}</span></nav>
<article class="article">
<header class="head"><div class="cat">법률칼럼 · ${esc(draft.category)}</div><h1>${esc(draft.title)}</h1><p class="desc">${esc(draft.description)}</p><div class="meta"><span><b>작성자</b> 윤성호 변호사 · 법률사무소 위드윤</span><span><b>작성일</b> ${draft.date.replaceAll('-', '.')}</span><span><b>키워드</b> ${esc(draft.crumb)}</span><span><b>지역</b> 서울 서초구(서울중앙지방검찰청)</span></div></header>
<div class="body">
<div class="tldr"><h2>이 글의 핵심</h2><ul>${draft.tldr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
<nav class="toc"><strong>목차</strong><ol>${toc}</ol></nav>
${sectionHtml}
${faqHtml}
${quoteHtml}
${renderRelated(draft.related, draft.hub)}
<div class="divider"></div><div class="label">LOCATION</div><h2 class="title" id="loc">${esc(draft.crumb)} 사무소 위치와 상담 안내</h2>
<table class="tbl"><tbody>
<tr><th>사무소</th><td>법률사무소 위드윤 · 서울 서초구 서초대로 270 서보빌딩 602호</td></tr>
<tr><th>교통</th><td>지하철 2호선·3호선 교대역, 2호선 서초역에서 도보 이용이 가능합니다. 서울중앙지방법원·서울중앙지방검찰청과 인접해 있습니다.</td></tr>
<tr><th>주요 상담권역</th><td>서초동·방배동·잠원동·반포동·양재동·내곡동, 인접 강남구(역삼·논현·삼성), 동작구(사당·이수), 관악구 일대</td></tr>
<tr><th>대응 기관</th><td>서초경찰서·방배경찰서·강남경찰서, 서울중앙지방검찰청, 서울중앙지방법원, 서울가정법원(양재동)</td></tr>
<tr><th>상담</th><td>직통 ${TEL} · 사무실 ${OFFICE_TEL} · 카카오톡 채널 상담 가능</td></tr>
</tbody></table>
<div class="author"><div class="av">W</div><div><h3>윤성호 변호사</h3><div class="role">법률사무소 위드윤 대표변호사 · 대한변호사협회 등록</div><p>윤성호 변호사는 서울 서초구 서초대로 270 서보빌딩에 위치한 법률사무소 위드윤의 대표변호사로, 형사·성범죄·스토킹 사건과 이혼·재산분할·상간소송을 함께 다룹니다. 서울중앙지방법원·서울중앙지방검찰청·서울가정법원이 모두 도보 거리에 있어 기록 열람과 긴급 서면 접수를 당일 처리합니다.</p></div></div>
</div>
<div class="cta"><div><h2>${esc(draft.cta.title)}</h2><p>${esc(draft.cta.sub)}</p></div><div><a class="btn gold" href="tel:${TEL}">☎ ${TEL}</a> <a class="btn green" href="${KAKAO}" target="_blank" rel="noopener">카카오톡 상담</a></div></div>
</article>
</main>
<div class="mcta"><a class="tel" href="tel:${TEL}">☎ 전화상담</a><a class="kko" href="${KAKAO}" target="_blank" rel="noopener">카카오톡 상담</a></div>
<footer class="foot"><strong>법률사무소 위드윤</strong> · 서울 서초구 서초대로 270 서보빌딩 602호<br>직통 상담: <a href="tel:${TEL}">${TEL}</a> · 사무실: <a href="tel:${OFFICE_TEL}">${OFFICE_TEL}</a><br>© 2026 Law Office With Yoon. All rights reserved.</footer>
</body></html>
`;

  return html;
}

/* ---------- 본문 글자수(품질 확인용) ---------- */
export function bodyLength(draft) {
  const parts = [];
  for (const s of draft.sections || []) {
    parts.push(s.title);
    for (const b of s.blocks) {
      if (typeof b === 'string') parts.push(b);
      else if (b.type === 'info') parts.push(b.text);
      else if (b.type === 'table') parts.push(b.rows.flat().join(' '));
      else if (b.type === 'list') parts.push(b.items.join(' '));
      else if (b.type === 'dialog') parts.push(b.title, b.lines.join(' '));
      else if (b.type === 'quote') parts.push(b.lines.join(' '));
    }
  }
  return [...parts.join('').replace(/\s+/g, '')].length;
}

/* ---------- CLI ---------- */
const args = process.argv.slice(2);
if (args.length) {
  const draftsDir = path.join(ROOT, 'content', 'drafts');
  const files = args[0] === '--all'
    ? readdirSync(draftsDir).filter((f) => f.endsWith('.json')).map((f) => path.join(draftsDir, f))
    : args;

  let ok = 0;
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`초안이 없습니다: ${file}`);
      process.exit(1);
    }
    const draft = JSON.parse(readFileSync(file, 'utf8'));
    const out = path.join(ROOT, 'blog', `${draft.slug}.html`);
    writeFileSync(out, renderArticle(draft), 'utf8');
    console.log(`${draft.slug}  본문 ${bodyLength(draft)}자  h2 ${(draft.sections || []).length}개`);
    ok += 1;
  }
  console.log(`\n${ok}편 생성 완료`);
}
