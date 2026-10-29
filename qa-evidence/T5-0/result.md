> 한 줄 요약: Pretendard 폰트 자체 호스팅 적용(intent/08-design.md §4 명세 — 지금까지 미구현이던 항목). Regular/Bold 2종 woff2만, 라이선스(SIL OFL-1.1) 확인·기록. 테스트 전부 통과, 실브라우저로 적용 확인, Codex 모드A 대기.

# T5-0 QA 증거 (Phase 5 — 전체 화면 UI 디자인 다듬기)

## 배경
"phase5 남은 작업들 진행해보자"에 따라 T5-0(디자인 다듬기)을 진행하며 `intent/08-design.md` 기준으로 화면들을 점검. 라이브러리·업로드 등은 그동안의 세세한 의뢰인 요청(T3-xx)들로 이미 다듬어져 있었고, 명세 대비 객관적으로 확인된 차이는 **Pretendard 폰트 미적용** 하나 — §4에 "Pretendard, 직접 호스팅(오프라인 PWA 대응, 외부 CDN 의존 금지)"로 명시돼 있는데 실제로는 시스템 기본 폰트(`-apple-system, system-ui, Segoe UI...`)만 쓰이고 있었음(`intent/03-architecture-stack.md`에도 "⚠확인" 상태로 남아있던 항목).

의뢰인에게 범위 확인(AskUserQuestion) 후 "Pretendard 폰트만 적용"으로 승인받고 진행(화면별 폰트 크기 수치 차이 등은 체감 문제 없어 손대지 않음).

## 구현
- `npm install pretendard`(1.3.9, SIL OFL-1.1 — `npm view pretendard license` 확인)로 공식 배포본에서 Regular(400)·Bold(700) woff2 파일과 LICENSE.txt만 추출해 `app/web/public/fonts/`에 복사, npm 패키지 자체는 제거(런타임에 불필요 — 정적 파일만 필요).
  - 디자인 문서가 요구하는 굵기는 400/700 2종뿐이라(§4 "본문 400, 화면 제목·레인 머리글·BPM 700") 나머지 7종 굵기(Black/ExtraBold/Medium/...)는 받지 않음 — 불필요한 용량(오프라인 PWA 캐시 대상이라 더 중요) 절감.
  - Variable font(전체 굵기 1파일, ~2MB) 대신 정적 2파일(~1.5MB 합산)을 선택 — 필요한 굵기가 2개뿐이라 더 작고, 가변 폰트 브라우저 지원 이슈도 없음.
- `app/web/src/index.css` — `@font-face` 2개(Regular/Bold, `font-display: swap`) 추가, `body`의 `font-family`를 `'Pretendard', -apple-system, ...`(기존 폴백 스택 유지)로 교체.
- `intent/03-architecture-stack.md` — 라이선스 표 2곳(§3 선택 이유 표, §4 라이선스 표)의 "Pretendard (SIL OFL ⚠확인)" 항목을 확인 완료로 갱신, 근거(`npm view` 결과 + 배포본 LICENSE.txt)와 호스팅 위치 기록.

## 테스트
- `npx tsc -b`: 에러 없음
- `npx vitest run`: **333 passed**(25 test files) — CSS/폰트 변경이라 JS 테스트 영향 없음, 회귀 없음 확인 차 재실행.

## 실브라우저 확인
- `document.fonts.ready` 후 `[...document.fonts]`에서 Pretendard 400/700 둘 다 `status: "loaded"` 확인.
- `getComputedStyle(document.body).fontFamily` → `"Pretendard, -apple-system, system-ui, ..."` 확인.
- 라이브러리 화면 스크린샷으로 한글 글자(초성·종성 포함 복잡한 글리프)가 기존 시스템 폰트와 다른 Pretendard 특유의 자형으로 렌더링됨을 육안 확인.

## Codex 모드A
(진행 예정)

## 결론
명세에 있었지만 미구현이던 Pretendard 폰트를 라이선스까지 확인해 자체 호스팅으로 적용. 의뢰인이 승인한 범위(폰트만) 안에서 진행, 그 외 화면별 수치 차이는 손대지 않음.
