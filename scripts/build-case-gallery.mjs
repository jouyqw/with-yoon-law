#!/usr/bin/env node
/**
 * 판결문 갤러리 생성 — node scripts/build-case-gallery.mjs
 *
 * 왜 개별 페이지로 만들지 않았나
 *   확보한 사례 73건의 본문은 중앙값 830자다(50건이 1,000자 미만).
 *   이걸 각각 페이지로 만들면 얇은 페이지를 73개 찍어내는 셈이라 색인에 해롭다.
 *   반면 **판결문·처분장 이미지 75장**은 경쟁 사무소가 흉내 낼 수 없는 신뢰 자산이다.
 *   그래서 한 페이지에 전부 모아 훑어볼 수 있게 하고, 깊게 쓴 사례는 따로 개별 페이지로 둔다.
 *
 * 개인정보
 *   이미지는 로톡에 이미 공개돼 있던 것을 그대로 가져왔다. 게시 주체가 같으므로
 *   새로 노출되는 정보는 없다. 다만 **가림 처리 여부는 사람이 눈으로 확인해야 한다.**
 *   확인 전에는 NOINDEX 를 켜 두고, 확인이 끝나면 PUBLISH=1 로 다시 생성한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content', 'lawtalk-cases.json');
const IMG_DIR = path.join(ROOT, 'images', 'cases', 'lawtalk');
const OUT = path.join(ROOT, 'cases.html');
const SITE = 'https://with-yoon-law.com';

// 눈으로 가림 처리를 확인하기 전까지는 검색엔진에 올리지 않는다.
const PUBLISH = process.env.PUBLISH === '1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/** 결과 문자열 → 배지 색 구분용 키 */
function resultKind(r) {
  const s = String(r || '');
  if (/무죄|혐의없음|불송치|각하|불입건|기각|심리불개시/.test(s)) return 'clear';   // 혐의를 벗은 것
  if (/기소유예|선고유예|보호처분|감호/.test(s)) return 'defer';                    // 재판 없이 종결
  if (/집행유예/.test(s)) return 'susp';
  return 'other';
}

/** 분야 묶음 — 로톡 카테고리가 잘게 갈려 있어 훑어보기 좋게 합친다 */
function fieldOf(c) {
  const t = `${c.title} ${(c.categories || []).join(' ')} ${(c.keywords || []).join(' ')}`;
  if (/마약/.test(t)) return '마약';
  if (/음주|교통/.test(t)) return '음주·교통';
  if (/스토킹/.test(t)) return '스토킹';
  if (/성폭력|강제추행|강간|성착취|불법촬영|통매음|준강간|유사강간|몰카|카메라/.test(t)) return '성범죄';
  if (/소년/.test(t)) return '소년';
  if (/군|병역|해병/.test(t)) return '군사건';
  if (/이혼|상간|양육|재산분할|상속/.test(t)) return '가사·상속';
  if (/절도|사기|횡령|뇌물|보이스피싱|전세사기/.test(t)) return '재산범죄';
  if (/폭행|상해|협박|명예훼손/.test(t)) return '폭력·명예';
  return '형사일반';
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const have = new Set(fs.existsSync(IMG_DIR) ? fs.readdirSync(IMG_DIR) : []);

const cases = raw.map((c) => {
  // 이미지는 번호로 저장해 뒀다(150409.png, 150409-2.png …)
  const imgs = (c.images || []).map((_, i) => {
    const base = `${c.number}${i ? `-${i + 1}` : ''}`;
    return ['png', 'jpg'].map((e) => `${base}.${e}`).find((n) => have.has(n));
  }).filter(Boolean);
  return {
    number: c.number,
    title: c.title,
    result: c.result || '',
    kind: resultKind(c.result),
    field: fieldOf(c),
    date: String(c.createdAt || '').slice(0, 10).replace(/-/g, '.'),
    brief: strip(c.htmlContent),
    images: imgs,
  };
}).filter((c) => c.images.length)
  .sort((a, b) => Number(b.number) - Number(a.number));

const fields = [...new Set(cases.map((c) => c.field))]
  .map((f) => ({ f, n: cases.filter((c) => c.field === f).length }))
  .sort((a, b) => b.n - a.n);

const cards = cases.map((c) => `      <article class="g-card" data-field="${esc(c.field)}" data-text="${esc(`${c.title} ${c.result} ${c.field}`)}">
        <button class="g-shot" type="button" aria-label="판결문 크게 보기">
          <img src="/images/cases/lawtalk/${esc(c.images[0])}" alt="${esc(c.title)} 처분 결과 문서" loading="lazy" decoding="async">
        </button>
        <div class="g-body">
          <div class="g-tags"><span class="g-res ${c.kind}">${esc(c.result)}</span><span class="g-field">${esc(c.field)}</span></div>
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.brief)}</p>
          ${c.brief.length > 150 ? '<button class="g-more" type="button">더 보기</button>' : ''}
        </div>
      </article>`).join('\n');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>성공사례 판결문 모음 ${cases.length}건 | 법률사무소 위드윤 윤성호 변호사</title>
<meta name="description" content="법률사무소 위드윤이 직접 수행한 형사·성범죄·마약·가사 사건의 처분 결과 문서 ${cases.length}건을 모았습니다. 기소유예·불송치·무죄 등 실제 결과를 문서로 확인하세요.">
<meta name="robots" content="${PUBLISH ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">
<link rel="canonical" href="${SITE}/cases.html">
<meta property="og:type" content="website"><meta property="og:title" content="성공사례 판결문 모음 ${cases.length}건 | 법률사무소 위드윤">
<meta property="og:description" content="실제 수행 사건의 처분 결과 문서를 한자리에서 확인하세요."><meta property="og:url" content="${SITE}/cases.html">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Noto+Serif+KR:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/case-article.css">
<style>
.g-wrap{max-width:1180px;margin:auto;padding:36px 20px 80px}
.g-head h1{font-family:"Noto Serif KR",serif;font-size:clamp(26px,4vw,40px);color:var(--navy);line-height:1.3;word-break:keep-all}
.g-head p{margin-top:12px;color:#5b6577;font-size:15px;word-break:keep-all}
.g-note{margin-top:16px;padding:14px 16px;border-left:4px solid #315ea8;background:#eef4ff;color:#294979;font-size:13px;line-height:1.75;word-break:keep-all}
.g-bar{position:sticky;top:0;z-index:5;display:flex;gap:8px;overflow-x:auto;margin:26px -20px 0;padding:14px 20px;background:rgba(244,246,249,.96);backdrop-filter:blur(10px);-webkit-overflow-scrolling:touch}
.g-bar::-webkit-scrollbar{display:none}
.g-chip{flex:0 0 auto;padding:8px 14px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#41506b;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit}
.g-chip.on{background:var(--navy);border-color:var(--navy);color:#fff}
.g-search{width:100%;margin-top:12px;padding:13px 15px;border:1px solid var(--line);border-radius:10px;font-family:inherit;font-size:15px;outline:none}
.g-search:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(199,164,75,.16)}
.g-count{margin:18px 0 10px;color:#8a94a6;font-size:13px;font-weight:700}
.g-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
.g-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden}
.g-shot{display:block;width:100%;padding:0;border:0;background:#eef1f5;cursor:zoom-in;line-height:0}
.g-shot img{width:100%;height:210px;object-fit:cover;object-position:top}
.g-body{display:flex;flex-direction:column;gap:9px;padding:16px}
.g-tags{display:flex;flex-wrap:wrap;gap:6px}
.g-res{padding:4px 11px;border-radius:999px;color:#fff;font-size:12px;font-weight:900}
.g-res.clear{background:#0b5d3b}.g-res.defer{background:#8a6a1b}.g-res.susp{background:#33507e}.g-res.other{background:#5b6577}
.g-field{padding:4px 10px;border-radius:999px;background:#eef2f6;color:#41506b;font-size:12px;font-weight:800}
.g-card h3{color:var(--navy);font-size:15.5px;font-weight:800;line-height:1.5;word-break:keep-all}
.g-card p{color:#5b6577;font-size:14px;line-height:1.75;word-break:keep-all;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.g-card p.open{-webkit-line-clamp:unset;display:block}
.g-more{align-self:flex-start;border:0;background:none;color:#8a6a1b;font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;padding:0}
.g-empty{padding:60px 20px;text-align:center;color:#98a2b3}
.lb{position:fixed;inset:0;z-index:50;display:none;place-items:center;padding:20px;background:rgba(11,15,24,.92)}
.lb.on{display:grid}
.lb img{max-width:100%;max-height:86vh;object-fit:contain;background:#fff}
.lb-x{position:absolute;top:14px;right:16px;width:44px;height:44px;border:0;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;font-size:22px;cursor:pointer}
@media(max-width:620px){
  .g-wrap{padding:24px 14px 60px}
  .g-grid{grid-template-columns:1fr;gap:12px}
  .g-shot img{height:min(58vw,260px)}
  .g-bar{margin:20px -14px 0;padding:12px 14px}
}
</style></head><body>
<nav class="top"><div class="top-in"><a class="brand" href="/"><span class="mark">W</span><span><strong>LAW OFFICE WITH YOON</strong><span>법률사무소 위드윤</span></span></a><div class="actions"><a class="btn" href="/board?type=case">사례 해설</a><a class="btn gold" href="tel:010-9491-1567">상담전화</a></div></div></nav>
<main class="g-wrap">
  <div class="g-head">
    <div class="crumb"><a href="/">홈</a> · 판결문 모음</div>
    <h1>직접 수행한 사건의<br>처분 결과 문서 ${cases.length}건</h1>
    <p>불기소이유통지서·결정문·판결문을 그대로 공개합니다. 결과와 분야로 추려서 보실 수 있습니다.</p>
    <div class="g-note">문서의 개인정보는 비식별 처리했습니다. 사안마다 사실관계와 양형 사유가 달라 결과는 달라질 수 있으며, 이 페이지는 특정 결과를 보장하지 않습니다. 사건 경위는 의뢰인 보호를 위해 요약했습니다.</div>
    <input id="q" class="g-search" type="search" placeholder="혐의·결과로 검색 (예: 강제추행, 불송치)" autocomplete="off">
    <div class="g-bar" id="chips">
      <button class="g-chip on" data-f="all" type="button">전체 ${cases.length}</button>
${fields.map((x) => `      <button class="g-chip" data-f="${esc(x.f)}" type="button">${esc(x.f)} ${x.n}</button>`).join('\n')}
    </div>
    <p class="g-count" id="cnt"></p>
  </div>
  <div class="g-grid" id="grid">
${cards}
  </div>
  <div class="g-empty" id="empty" style="display:none">조건에 맞는 사례가 없습니다.</div>
  <aside class="cta" style="margin:34px 0 0"><div><h2>같은 혐의라도 대응에 따라 달라집니다</h2><p>상담실장 없이 대표변호사가 직접 상담합니다.</p></div><div class="cta-links"><a class="btn gold" href="tel:010-9491-1567">전화 상담</a><a class="btn primary" href="https://pf.kakao.com/_CNtxjX">카카오톡 상담</a></div></aside>
</main>
<div class="lb" id="lb"><button class="lb-x" id="lbx" type="button" aria-label="닫기">×</button><img id="lbi" src="" alt=""></div>
<footer class="foot"><strong>법률사무소 위드윤</strong><br>서울 서초구 서초대로 270 서보빌딩 602호 · 광고책임변호사 윤성호<br><a href="/board?type=case">사례 해설 보기</a></footer>
<script>
(function(){
  var grid=document.getElementById('grid'),q=document.getElementById('q'),cnt=document.getElementById('cnt'),empty=document.getElementById('empty');
  var cards=[].slice.call(grid.querySelectorAll('.g-card')),f='all';
  function apply(){
    var s=(q.value||'').trim().toLowerCase(),n=0;
    cards.forEach(function(c){
      var ok=(f==='all'||c.dataset.field===f)&&(!s||c.dataset.text.toLowerCase().indexOf(s)!==-1);
      c.style.display=ok?'':'none'; if(ok)n++;
    });
    cnt.textContent='총 '+n+'건';
    empty.style.display=n?'none':'block';
  }
  document.getElementById('chips').addEventListener('click',function(e){
    var b=e.target.closest('.g-chip'); if(!b)return;
    f=b.dataset.f;
    [].slice.call(this.querySelectorAll('.g-chip')).forEach(function(x){x.classList.toggle('on',x===b);});
    apply();
  });
  q.addEventListener('input',apply);
  grid.addEventListener('click',function(e){
    var m=e.target.closest('.g-more');
    if(m){var p=m.parentNode.querySelector('p');p.classList.toggle('open');m.textContent=p.classList.contains('open')?'접기':'더 보기';return;}
    var s=e.target.closest('.g-shot');
    if(s){var img=s.querySelector('img');document.getElementById('lbi').src=img.src;document.getElementById('lbi').alt=img.alt;document.getElementById('lb').classList.add('on');}
  });
  function close(){document.getElementById('lb').classList.remove('on');}
  document.getElementById('lb').addEventListener('click',function(e){ if(e.target.id!=='lbi') close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') close(); });
  apply();
})();
</script>
</body></html>
`;

fs.writeFileSync(OUT, html);
console.log(`cases.html 생성 — 사례 ${cases.length}건 · 이미지 ${cases.reduce((n, c) => n + c.images.length, 0)}장`);
console.log('분야:', fields.map((x) => `${x.f} ${x.n}`).join(' / '));
console.log(PUBLISH ? '색인: index,follow (공개)' : '색인: noindex (가림 처리 확인 전)');
