# 커머스 AX 워크벤치

**라이브 데모: https://ax-workbench.pages.dev**

온라인 유통 실무(상품등록·콘텐츠·매출분석)를 AI로 자동화한 취업 포트폴리오 데모입니다.
(주)다솜인터내셔널 "AI 매니저(AI 활용 및 자동화 담당자)" 공고의 담당업무를 1:1로 구현했습니다.

## 데모 구성

| 경로 | 기능 | 공고 담당업무 |
|---|---|---|
| `/detail-page` | AI 상품 상세페이지 생성기 (HTML 다운로드 → 디자이너 인계) | B · 필수 자격요건 |
| `/content` | 채널 콘텐츠 팩토리 (인스타·카드뉴스·블로그·스레드·유튜브·틱톡) | B |
| `/listing` | 상품등록·검색어 최적화 + 표시광고 금칙어 사전점검 | A |
| `/sales` | 매출 CSV 자동 집계·차트 + AI 주간 리포트 | A |
| `/edu` | 직원 AI 교육 가이드 | C |

## 기술 스택

- React 19 + Vite, Cloudflare Pages Functions
- Claude API (`claude-opus-4-8`) — tool 강제 호출로 구조화 JSON 응답
- Cloudflare D1 — API 레이트리밋
- 판매 CSV는 브라우저에서만 파싱 (서버 미전송)

## 실행

```bash
npm install
npm run dev        # 프론트만 (API는 프록시)
npm run dev:full   # wrangler pages dev 포함
npm test           # vitest
npm run build
```

## 배포 (Cloudflare Pages)

이 프로젝트는 wrangler.toml 없이 배포합니다(변수·바인딩을 Cloudflare 대시보드에서 관리하기 위함).

```bash
npm run build
npx wrangler pages deploy dist --project-name ax-workbench --branch master
```

master 푸시 시 GitHub Actions(.github/workflows/deploy.yml)가 같은 명령으로 자동 배포합니다
(저장소 시크릿 `CLOUDFLARE_API_TOKEN` 등록 필요).

### 라이브 AI 전환

기본 상태에서는 큐레이션된 샘플 응답(데모 모드)으로 전체 흐름을 시연합니다.
Cloudflare 대시보드 → Workers & Pages → ax-workbench → Settings → **Variables and secrets**에서
`CLAUDE_API_KEY`(Secret 타입)를 추가하고 재배포하면 같은 화면이 Claude Opus 4.8 라이브 생성으로 전환됩니다.

같은 화면의 **Bindings**에 D1 바인딩(변수명 `DB`, 데이터베이스 `ax-workbench`)이 있어야
API 레이트리밋이 동작합니다(없어도 앱은 동작하며, 제한만 걸리지 않습니다).

## 문서

- [기획안.md](./기획안.md) — 공고 분석과 포트폴리오 설계
- [개선기획안.md](./개선기획안.md) — 배포 후 개선 사이클 기록
