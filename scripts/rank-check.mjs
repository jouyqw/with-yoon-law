#!/usr/bin/env node
/**
 * 목표 키워드 순위 추적 (Google Search Console Search Analytics API)
 * ---------------------------------------------------------------
 * 노리는 다섯 키워드가 실제로 몇 위에 몇 번 노출되는지, 그리고 그 키워드에
 * 어느 페이지가 뜨는지를 주 단위로 남긴다. 순위는 짐작하지 말고 실측한다.
 *
 * 구글 데이터는 2~3일 늦게 들어오므로 오늘이 아니라 3일 전까지를 본다.
 *
 * 환경변수
 *   GSC_SA_JSON   (필수) 서비스 계정 키 JSON 전문
 *   GSC_SITE_URL  (필수) 도메인 속성이면 sc-domain:with-yoon-law.com
 *   RANK_WINDOW   (선택) 집계 구간 일수, 기본 28
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const SITE_URL = process.env.GSC_SITE_URL || '';
const WINDOW = Number(process.env.RANK_WINDOW || 28);
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const OUT = 'rank-report.md';

// 사이트가 노리는 다섯 키워드. 착지 페이지가 어디여야 하는지도 함께 적는다.
const TARGETS = [
  { kw: '서초법률사무소', page: '/about/' },
  { kw: '서초변호사', page: '/' },
  { kw: '서초형사전문변호사', page: '/practice/criminal/' },
  { kw: '서초성범죄변호사', page: '/practice/sex-crime/' },
  { kw: '서초이혼전문변호사', page: '/practice/divorce/' },
];

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(json).slice(0, 300)}`);
  return json.access_token;
}

async function query(token, body) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Search Analytics 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).rows || [];
}

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const fmtPos = (p) => (p == null ? '—' : p.toFixed(1));
const arrow = (now, prev, lowerIsBetter = false) => {
  if (prev == null || now == null) return '';
  const d = now - prev;
  if (Math.abs(d) < 0.05) return ' (–)';
  const good = lowerIsBetter ? d < 0 : d > 0;
  return ` (${good ? '↑' : '↓'}${Math.abs(d).toFixed(1)})`;
};

async function main() {
  if (!process.env.GSC_SA_JSON) throw new Error('GSC_SA_JSON 이 없습니다.');
  if (!SITE_URL) throw new Error('GSC_SITE_URL 이 없습니다.');
  const sa = JSON.parse(process.env.GSC_SA_JSON);
  const token = await getAccessToken(sa);

  // 구글 데이터 지연을 감안해 3일 전까지만 본다.
  const end = shift(new Date(), -3);
  const start = shift(end, -(WINDOW - 1));
  const prevEnd = shift(start, -1);
  const prevStart = shift(prevEnd, -(WINDOW - 1));

  const base = { type: 'web', rowLimit: 25000 };
  const [cur, prev, byPage] = await Promise.all([
    query(token, { ...base, startDate: iso(start), endDate: iso(end), dimensions: ['query'] }),
    query(token, { ...base, startDate: iso(prevStart), endDate: iso(prevEnd), dimensions: ['query'] }),
    query(token, { ...base, startDate: iso(start), endDate: iso(end), dimensions: ['query', 'page'] }),
  ]);

  const idx = (rows) => new Map(rows.map((r) => [r.keys[0], r]));
  const curMap = idx(cur), prevMap = idx(prev);

  // 키워드마다 노출이 가장 많은 페이지 하나
  const topPage = new Map();
  for (const r of byPage) {
    const [kw, page] = r.keys;
    const best = topPage.get(kw);
    if (!best || r.impressions > best.impressions) topPage.set(kw, { page, impressions: r.impressions, position: r.position });
  }

  const L = [];
  L.push(`# 목표 키워드 순위 — ${iso(start)} ~ ${iso(end)}`);
  L.push('');
  L.push(`직전 동일 구간(${iso(prevStart)} ~ ${iso(prevEnd)}) 대비입니다. 구글 데이터는 2~3일 늦게 들어오므로 최근 3일은 제외했습니다.`);
  L.push('');
  L.push('| 키워드 | 평균순위 | 노출 | 클릭 | 실제 뜨는 페이지 | 의도한 페이지 |');
  L.push('|---|---:|---:|---:|---|---|');

  let ranked = 0;
  for (const t of TARGETS) {
    const c = curMap.get(t.kw), p = prevMap.get(t.kw);
    const tp = topPage.get(t.kw);
    if (!c) {
      L.push(`| ${t.kw} | 노출 없음 | 0 | 0 | — | ${t.page} |`);
      continue;
    }
    ranked++;
    const actual = tp ? new URL(tp.page).pathname : '—';
    const match = actual === t.page ? '✅' : `⚠️ ${t.page}`;
    L.push(`| ${t.kw} | ${fmtPos(c.position)}${arrow(c.position, p?.position, true)} | ${c.impressions}${arrow(c.impressions, p?.impressions)} | ${c.clicks} | ${actual} | ${match} |`);
  }

  L.push('');
  L.push(`목표 키워드 ${TARGETS.length}개 중 ${ranked}개가 노출되고 있습니다.`);
  L.push('');

  // 서초로 시작하는 다른 검색어 — 아직 페이지를 안 만든 기회를 찾는 자리
  const seocho = cur
    .filter((r) => r.keys[0].includes('서초') && !TARGETS.some((t) => t.kw === r.keys[0]))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  if (seocho.length) {
    L.push('## 목표 밖의 서초 검색어 상위 20');
    L.push('');
    L.push('노출은 나오는데 전용 페이지가 없는 검색어입니다. 다음 착지 페이지 후보로 봅니다.');
    L.push('');
    L.push('| 검색어 | 평균순위 | 노출 | 클릭 |');
    L.push('|---|---:|---:|---:|');
    for (const r of seocho) L.push(`| ${r.keys[0]} | ${fmtPos(r.position)} | ${r.impressions} | ${r.clicks} |`);
    L.push('');
  }

  const total = cur.reduce((a, r) => a + r.impressions, 0);
  const prevTotal = prev.reduce((a, r) => a + r.impressions, 0);
  L.push(`전체 노출 ${total}회${arrow(total, prevTotal)} · 검색어 ${cur.length}개`);
  L.push('');

  fs.writeFileSync(OUT, L.join('\n'));
  console.log(L.join('\n'));

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `ranked=${ranked}\ntotal=${TARGETS.length}\n`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
