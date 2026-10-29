> 한 줄 요약: 편집 화면의 BPM을 더 이상 영구적으로 바꿀 수 없게 하고, 연주 화면과 똑같은 "연습 속도(원곡 대비 50~150%, 저장 안 됨)" 조절로 대체 — 라이브러리에 적힌 BPM이 편집 실수로 틀어지는 걸 구조적으로 막음.

# T3-59 결과

## 배경 (의뢰인 요청, 2026-10-29)
T3-58(편집 화면 재생 기능) 작업 중 "BPM·박자표를 수정하면 실제 곡의 기본값이
바뀌는지" 질문에 답하면서, `EditorScreen.tsx`의 BPM 입력이 `commit()`을 거쳐
그대로 저장되는 `meta.bpm`을 직접 고치고 있고, 그게 라이브러리 목록이 보여주는
`song.original_bpm`과 별도로 동기화되지 않는다는 점을 열어둔 질문으로
남겨뒀었다(`intent/07-open-questions.md` 확인 전).

의뢰인 답: "편집기에서 bpm을 건들 수 없었으면 좋겠어. 우리가 업로드했을때
노래 원곡의 bpm을 계산하면 그건 건들 수 없게하고, 편집화면과 연주화면에서
모두 bpm을 높였다 줄였다만 할 수 있게 조절만할 수 있게하고 그게 원본값에
영향을 주지않도록하고싶어. 그래서 라이브러리에 bpm은 우리가 업로드했을 때의
원본값이 적히도록."

→ 편집기의 BPM 편집 기능을 완전히 제거하고, `PracticeCanvas.tsx`가 이미
REQ-04대로 구현해 둔 "연습 속도(playbackBpm, 원곡 대비 50~150%, 저장 안 됨)"
패턴을 편집기에도 그대로 적용.

## 구현 (REQ-03, REQ-04)

### `PracticeCanvas.tsx` — 변경 없음
확인해보니 이 화면은 이미 의뢰인이 원하는 모델을 정확히 구현하고 있었다
(2026-10-29 같은 날 더 이른 시점 작업분, T3-58 범위): `playbackBpm`이라는
별도 state로만 조절하고, `score.meta.bpm`(원곡 BPM)을 쓰거나 바꾸는 코드
경로가 전혀 없음(`grep meta\.bpm\s*=` 결과 0건으로 확인). 슬라이더·숫자
입력 모두 `minBpm`~`maxBpm`(원곡의 50~150%) 범위로 클램프되고, 재생/일시정지
중엔 잠기며, 원곡 BPM으로 되돌리는 리셋 버튼(`RotateCcw`)이 있음. 그대로 둠.

### `EditorScreen.tsx`
- **제거**: 상단 컨트롤 바의 BPM `<input type="number">`와, 그걸
  `commit({ ...state, meta: { ...meta, bpm: ... } })`으로 저장하던 경로.
  대신 `원곡 BPM {meta.bpm}`을 읽기 전용 텍스트로만 표시.
- **추가**: "재생" 영역에 `PracticeCanvas.tsx`와 완전히 같은 패턴의 "속도"
  컨트롤 — `playbackBpm` state(초깃값 `meta.bpm`), `minBpm`/`maxBpm`(원곡의
  50~150%), 슬라이더(`.mixer-slider`) + 숫자 입력(포커스 중 자유 입력 draft,
  blur 시 clamp) + 원곡 BPM 리셋 버튼(`.settings-trigger` + `RotateCcw`),
  재생 중엔 전부 잠김. **`playbackBpm`은 `commit()`/`history`를 전혀 거치지
  않는 별도 state라 `handleSave()`가 보내는 `state.meta.bpm`에 영향을 주지
  않는다** — 이게 이번 요청의 핵심("원본값에 영향을 주지않도록").
- `commit()`의 "이 함수를 거치는 편집 경로" 목록 주석에서 BPM을 빼고,
  2026-10-29부터 빠졌다는 날짜 메모 추가.
- 재생 경로 전부를 `meta.bpm`(이제 절대 안 바뀌는 "원곡 BPM") 대신
  `playbackBpm`/`playbackBpmRef.current` 기준으로 재계산:
  - `currentSeconds` 초깃값, `secondsToTicks()` — 틱↔초 환산 기준을
    `playbackBpm`으로.
  - `handlePlay()` — `clock.setPositionSeconds()`에 쓰는 위치 계산도
    `playbackBpm` 기준으로 바꾸고, **`playDrumScore()` 호출에 빠져있던
    `playbackBpm: playbackBpmRef.current` 옵션을 새로 추가**(이게 없으면
    scorePlayer.ts가 `score.meta.bpm`, 즉 항상 원곡 속도로 노트를 스케줄해
    버려 — 속도를 조절해도 신스 드럼 노트만 원래 속도로 남아 스템과
    어긋났을 것. 메트로놈은 Tone.js Transport의 단일 BPM을 그대로 쓰므로
    별도 처리 불필요 — `scorePlayer.ts`의 `transport.bpm.value = playbackBpm`
    한 줄로 노트·메트로놈 둘 다 같이 반영됨, 실제 소스 확인).
  - 원곡 음원(스템) `playbackRate` 계산 — 기존엔 `initialBpmRef`(재생 시작
    시점에 고정해둔 "원곡 BPM" 흉내)를 썼는데, 이제 `meta.bpm` 자체가 영원히
    원곡값이라 `initialBpmRef`가 완전히 중복됐음 → 삭제하고 `meta.bpm`을
    직접 사용(`playbackRate = playbackBpmRef.current / latestState.meta.bpm`).
  - `startRaf()`의 `resync()` 리싱크 계산도 같은 식으로 교체.

## 테스트
- `app/web`: `npx tsc -b` 통과(에러 0). `npx oxlint` 통과(기존 경고 4건만,
  이번 변경분 신규 경고 0건). `npx vitest run` — **297/297 통과**(신규 1개
  포함: 재생 속도만 바꾸면 저장 버튼이 계속 비활성인 것, 노트를 편집해
  저장해도 서버로 보내는 `meta.bpm`이 항상 원본(120) 그대로인 것을 같은
  테스트에서 확인). 기존 "그리드 단축키가 BPM 입력을 안 건드린다" 테스트는
  이제 그 자리에 있는 "속도" 숫자 입력을 대신 찾도록 수정(동작 의도는
  동일 — 입력창에 포커스가 있을 때 방향키가 그리드로 새지 않아야 함).
- `app/server`: 이번 작업은 프런트엔드 전용(백엔드 라우트·DB 스키마 변경
  없음)이라 기존 pytest 스위트에 영향 없음, 재실행 생략.

## 브라우저 QA
시도했으나 **실행하지 못함** — 현재 세션에 유효한 로그인 쿠키가 없고,
실제 계정 비밀번호를 모르며(CLAUDE.md §세이프티 — 사용자의 실제 비밀번호를
입력하거나 대신 계정을 만드는 행위는 로컬 개발 환경이라도 피해야 할
항목으로 판단, 이전 작업에서도 신규 계정 생성은 자동 분류기에 막힌 전례),
로그인 화면엔 가입 경로가 없어(관리자가 수동 생성) 진짜 브라우저 로그인은
막혀 있다. 대신:
- `npx vitest run`이 실제 `@testing-library/react` DOM 렌더링을 쓰므로(이
  화면은 Canvas가 아니라 순수 DOM이라 jsdom에서 100% 테스트 가능 —
  work/T2-6/plan.md §테스트계획), 실패한 테스트 디버그 출력으로 실제 렌더된
  마크업(슬라이더 `class="mixer-slider" min="60" max="180" value="120"`,
  숫자 입력, `RotateCcw` 아이콘 버튼)을 직접 확인함 — 구조·속성이 의도한
  그대로 나옴.
- 실제 브라우저 시각 확인(로그인 필요)은 남은 작업으로 아래에 기록.

## Codex 모드A 검수(읽기 전용)
- 대상: `task/T3-59-editor-bpm-practice-speed-only` vs `main`(코드 변경분만,
  `intent/02-requirements.md`는 문서 전용 수정이라 범위 밖).
- **1차 — APPROVE(지적 없음)**. 확인 범위: `playbackBpm` 선언 순서(먼저
  선언돼 `currentSeconds` 초기화에서 쓰임)와 rAF 변환, 재생 시작 시 BPM·
  위치·스템 속도 계산, 리싱크 계산, 입력 잠금(`disabled={isPlaying}`),
  테스트의 입력 구분(`getAllByDisplayValue` + `type==='number'` 필터)과
  저장 검증(playbackBpm 변경이 meta.bpm에 영향 없음). `initialBpmRef`의
  잔여 참조 없음 확인. (검수 범위 밖으로 직접 밝힌 것: 테스트 실행 자체는
  안 함 — 위 "테스트" 절의 vitest 297/297 통과로 보완됨.)

## 남은 작업
- 의뢰인이 직접 로그인해 편집 화면에서 "속도" 슬라이더를 눈으로 확인 필요
  (기능은 테스트로 검증됐으나 레이아웃·간격 등 시각적 확인은 못 함).
- `intent/02-requirements.md` REQ-03("BPM·박자표 수정")·REQ-04에 이번
  변경을 반영하는 취소선+날짜 메모 추가함(별도 승인 불필요 — 의뢰인의
  명시적 직접 지시에 따른 반영, T3-58의 REQ-12 수정과 같은 원칙).
