> 한 줄 요약: 믹서 영역 숫자칸(BPM·지연보정·보이는 마디 수)의 네이티브 스피너/드롭다운 화살표를 제거하고, "원곡 드럼 끄기" 버튼을 Mute 버튼과 어울리는 알약 모양으로 재디자인.

# T3-53 결과

## 배경 (의뢰인 요청, 2026-10-29)
"이미지2에 믹서부분에보면 76, 0ms, 마디수 2 이런 숫자들이 박스에 들어가
있잖아. 근데 먼가 촌스러워 보이는데 디자인을 바꿀 수 없을까? 내가 디자인
관련 용어를 몰라서 어떻게 바꿔달라고 구체적으로 말은 못하겠는데. 원곡드럼
끄기 버튼도 조금그래."

## 진단
숫자칸(BPM·오디오 지연 보정·A-B 루프 마디) 자체는 이미 전역
`input`/`select` 규칙(`index.css`)으로 어두운 배경·테두리가 적용돼
있었다 — "촌스러움"의 실제 원인은 그 위에 브라우저가 그대로 그리는
**OS 기본 스피너 화살표**(number input의 ▲▼, select의 ▾)였다. 이
앱의 다른 곳(믹서 슬라이더, Mute 버튼, 재생 버튼 등)은 전부 네이티브
외형을 지우고 직접 그린 커스텀 모양을 쓰는데, 숫자칸·드롭다운만 그
작업이 빠져 있었던 것 — 일관성 공백.

## 구현
- `app/web/src/index.css`
  - `input[type='number']`의 웹킷 스피너 버튼(`::-webkit-outer/inner-spin-button`)
    숨김 + `appearance: textfield`(Firefox) — 마우스 휠·키보드 화살표로
    증감은 그대로 됨, 시각적 화살표만 제거. 가운데 정렬도 추가.
  - `select`의 네이티브 드롭다운 화살표를 `appearance: none`으로 지우고
    `--text-muted` 색의 쉐브론 SVG(data URI)로 교체 — 라이트/다크 테마
    전환이 없는 고정 다크 테마라(tokens.css 확인) 색을 고정값으로 넣어도
    테마 불일치 위험 없음.
  - `.preset-toggle-btn`/`.preset-toggle-btn--active` 신규 — 기존
    `.mute-btn`과 같은 "알약" 톤이지만 한 단계 더 또렷하게(글자·패딩 큼,
    accent색 보더). 꺼진 상태(드럼리스 프리셋 적용 중)는
    `.mute-btn--active`와 같은 원리로 danger색 채움.
- `app/web/src/features/practice/PracticeCanvas.tsx` — "원곡 드럼
  끄기/켜기" 버튼에 위 클래스 적용(상태에 따라 `--active` 토글).

## 테스트
- `npx tsc --noEmit`·`npx oxlint` — 에러 없음(기존 경고만).
- `npx vitest run` — 275/275 통과(순수 스타일 변경, 로직 무변경).

## 브라우저 수동 QA
로그인 세션이 없어(비밀번호를 몰라 대신 로그인 불가) 실제 연습 화면
대신, 같은 CSS를 그대로 가져온 격리된 미리보기 페이지(Vite dev
서버의 `public/` 아래 임시 파일 — 확인 후 즉시 삭제, 레포에 커밋 안 됨)
로 렌더링해 스크린샷으로 확인:
- BPM/지연보정 숫자칸 — 스피너 화살표 사라짐, 숫자 가운데 정렬.
- "보이는 마디 수" select — OS 기본 화살표 대신 작은 커스텀 쉐브론.
- "원곡 드럼 끄기"(기본) — accent색 테두리 알약, "원곡 드럼 켜기"
  (프리셋 적용 중) — danger색 테두리 알약으로 상태가 색으로도 구분됨.

## Codex 모드A 검수
1차 `task-mvsvi0j6-akpqgy` — **REQUEST_CHANGES**(Low): 전역
`button:hover:not(:disabled)`(요소선택자+가상클래스 2개, 명시도
(0,2,1))가 `.preset-toggle-btn:hover`(클래스+가상클래스 1개, 명시도
(0,2,0))보다 명시도가 높아, 의도한 accent/danger 틴트 배경이 전역
회색 호버 배경에 가려지고 있었음. **반영**: 두 호버 선택자에
`:not(:disabled)`를 추가(`.preset-toggle-btn:hover:not(:disabled)` 등,
명시도 (0,3,0) — 전역 규칙보다 명시적으로 더 높게)해 확실히 이기도록
수정. 그 외(숫자칸 선택자 범위, select padding, disabled 처리,
클래스 삼항식)는 전부 "문제 없음"으로 확인됨. 수정 후 같은 격리
미리보기 페이지로 실제 마우스 호버 재현 — 버튼 배경에 틴트가 적용됨을
스크린샷·좌표 둘 다로 확인.

2차(최종) `task-mvsvndg7-r492df` — **APPROVE**. 명시도 계산 재확인
(`.preset-toggle-btn:hover:not(:disabled)` = (0,3,0) >
`button:hover:not(:disabled)` = (0,2,1), 소스 순서 무관하게 승리) —
확인됨. 추가 지적 없음.

## 남은 작업
- (완료) Codex 모드A APPROVE → `main` 병합.
- 의뢰인이 실제 화면에서 보고 마음에 드는지 추가 피드백 필요(본인도
  "구체적으로 말은 못 하겠다"고 한 디자인 요청이라, 방향이 안 맞으면
  추가 라운드 예상).
