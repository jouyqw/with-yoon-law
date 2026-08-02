# with-yoon-law

법률사무소 위드윤 홈페이지. 정적 사이트이며 GitHub Actions 로 콘텐츠 발행과 검색엔진 색인을 자동화한다.

## 자동화 파이프라인

| 워크플로 | 트리거 | 하는 일 |
|---|---|---|
| `publish-scheduled.yml` | 매일 00:05 KST | `blog/scheduled.json` 의 발행일 도래분을 `blog/posts.json` 으로 승격 → 피드 재생성 호출 |
| `update-sitemap-rss.yml` | 콘텐츠 push / 매일 03:00 KST | `sitemap.xml` · `rss.xml` · `robots.txt` · `llms.txt` 재생성 후 **IndexNow 색인 요청** |
| `indexnow-bulk.yml` | 수동 | sitemap 전체 URL 을 일괄 색인 요청 (최초 도입·구조 변경 시) |
| `gsc-index-check.yml` | 매일 07:00 KST | 구글 색인 여부 점검 → 미색인 URL 을 이슈로 보고 |

### 색인 요청이 실제로 나가는 경로

```
칼럼 발행 (00:05 KST)
   └→ posts.json 갱신 → 커밋
        └→ "Update search feeds" 실행
             ├→ sitemap/rss/robots/llms 재생성
             ├→ 직전 sitemap 과 비교해 "신규 + lastmod 변경" URL 추출
             └→ IndexNow POST
                  ├→ 네이버 (searchadvisor.naver.com)
                  └→ IndexNow 허브 (api.indexnow.org → Bing · Yandex · Seznam · Naver · Yep)
```

## 검색엔진별 자동화 가능 범위

| 엔진 | 색인 요청 자동화 | 방식 |
|---|---|---|
| 네이버 | 가능 | IndexNow (2023.7~ 공식 지원) |
| Bing / Yandex / Seznam | 가능 | IndexNow 허브가 상호 전파 |
| 구글 | **불가** | Indexing API 는 JobPosting·BroadcastEvent 전용. sitemap 자동 갱신 + 색인 상태 자동 점검이 최대치 |
| 다음 | 불가 | 공개 API 없음. 네이버 색인과 별개로 동작 |

## IndexNow 키

- 키: `eee764b31941bb288655b49d490b1005`
- 검증 파일: `https://with-yoon-law.com/eee764b31941bb288655b49d490b1005.txt`
- 이 파일이 200 + text/plain 으로 응답하지 않으면 모든 색인 요청이 403 으로 거절된다.
- 키는 공개되어도 무방하다 (해당 도메인 소유 증명 용도).

## 구글 색인 점검 설정 (최초 1회)

1. GCP 콘솔 → 프로젝트 생성 → **Google Search Console API** 사용 설정
2. 서비스 계정 생성 → 키 → 새 키 만들기(JSON) 다운로드
3. Search Console → 속성 → 설정 → 사용자 및 권한 → 서비스 계정 이메일을 **소유자**로 추가
4. GitHub → Settings → Secrets and variables → Actions
   - **Secrets**: `GSC_SA_JSON` = 다운로드한 JSON 전문
   - **Variables**: `GSC_SITE_URL` = `sc-domain:with-yoon-law.com`

시크릿이 없으면 해당 워크플로는 경고만 남기고 조용히 넘어간다.

## 수동 실행

```bash
# 로컬에서 제출 대상만 미리 확인
INDEXNOW_KEY=eee764b31941bb288655b49d490b1005 node scripts/indexnow.mjs --all --dry-run

# 특정 URL 만 색인 요청
INDEXNOW_KEY=eee764b31941bb288655b49d490b1005 node scripts/indexnow.mjs --url https://with-yoon-law.com/blog/some-post.html
```
