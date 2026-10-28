> 한 줄 요약: T3-47 설정 패널(Drawer/사이드바) UI 다듬기 — 색상 구역 구분, 레인 중앙정렬, Drawer 트랜지션, 믹서 트리거 비-버튼 스타일, 블루투스 문구 갱신, ♩=BPM 레인 좌측 상단 이동, 지연 보정 기본값 재설정 버튼.

# T3-47-feedback-1 결과

## 배경 (의뢰인 요청, 2026-10-28, 이미지 2장 첨부 + 추가 요청 1건)
1. songscription 참고 이미지처럼 "내가 직접 만질 수 있는 설정 영역"과 "연주
   영역"을 색으로 구분.
2. 자사 스크린샷 지적 — 드럼킷 그림·블루투스 문구가 레인과 중앙정렬이 안 맞음.
3. Drawer 열림/닫힘에 트랜지션 추가.
4. 설정 버튼이 투박해 보임 — 톱니바퀴 아이콘 + "믹서" 라벨로, 버튼처럼 안
   보이게.
5. 오디오 지연 보정 기능이 생겼으니 블루투스 안내 문구를 그에 맞게 수정.
6. ♩=BPM 표시를 레인 좌측 상단으로 이동(설정에서 BPM 바꾸면 같이 바뀌게).
7. (작업 중 추가 요청) 오디오 지연 보정 값을 기본값으로 되돌리는 리셋 아이콘 —
   "기본값이 몇인지 모른다"는 지적.

## 구현
- `app/web/src/features/practice/PracticeCanvas.tsx`
  - 넓은 화면 사이드바에 `background: var(--surface)` 카드(테두리·둥근
    모서리·패딩) + "⚙ 믹서" 헤더 추가 — 연주 영역(`--bg` 그대로)과 색으로
    구분(요청 1). 내부 채널 볼륨 소제목은 패널 제목과 겹치지 않게 "믹서" →
    "채널 볼륨"으로 변경.
  - 블루투스 안내 문구 `<p>`와 드럼킷 그림 wrapper에 레인 박스와 같은
    `maxWidth`(+`margin:auto`/`textAlign:center`)를 줘서 레인과 정확히 같은
    중심에 오도록(요청 2).
  - 좁은 화면 트리거 버튼에 `className="settings-trigger"`(아래 index.css)
    적용, 라벨 "설정"→"믹서"로, Drawer `title`도 "믹서"로 통일(요청 4).
  - 블루투스 문구를 "스피커·유선을 쓰라"는 회피 안내에서 "믹서의 오디오
    지연 보정으로 맞출 수 있다"는 해결 안내로 갱신, 스피커·유선은 보조
    설명으로 유지(요청 5).
  - `♩= {playbackBpm}` 표시를 설정 패널 BPM 입력 옆에서 레인 캔버스 좌측
    상단(절대 위치)으로 이동 — 같은 `playbackBpm` state를 읽으므로 설정에서
    BPM을 바꾸면 그대로 반영됨(요청 6). 기존 FPS 디버그 배지와 겹치지 않게
    FPS는 우측 상단으로 이동.
- `app/web/src/components/Drawer.tsx` — `shouldRender`/`visible` 2단 상태로
  열림은 "닫힌 모습 1프레임 → visible=true"(requestAnimationFrame),
  닫힘은 "visible=false → TRANSITION_MS(220ms) 뒤 언마운트"로 분리해
  CSS `transition: transform/opacity 220ms`가 실제로 애니메이션되게 함(요청 3).
- `app/web/src/index.css` — `.settings-trigger` 클래스 추가(테두리·배경
  없음, 호버 시 텍스트만 밝아짐) — 전역 `button` 스타일을 덮어써 "버튼처럼
  안 보이게" 구현.
- `app/web/src/features/practice/PracticeCanvas.tsx`(추가 요청 7) — 오디오
  지연 보정 입력 옆에 재설정 아이콘(RotateCcw, `.settings-trigger` 스타일
  재사용) — 클릭 시 `setAudioLatencyCompensationMs(0)` + 편집 중이었다면
  draft도 같이 초기화. 기본값은 0ms(`loadStoredAudioLatencyCompensationMs`가
  저장값이 없거나 깨졌을 때 돌려주는 값과 동일 — 코드 근거로 확인, 추측
  아님). 재생/일시정지 중엔 BPM·지연 보정 입력 자체와 같은 이유로 비활성화.

## 테스트
- `npx vitest run` — 275/275 통과(변경 없음, 이번 작업은 순수 UI).
- `npx tsc --noEmit` — 에러 없음.
- `npx oxlint` — 에러 없음(`Drawer.tsx`에 `set-state-in-effect` 경고 1건 —
  의도된 패턴이라 코드 주석으로 근거 명시, 동작 변경 없음).

## 브라우저 수동 QA (Claude 내장 브라우저)
1. **색상 구역 구분** — 넓은 화면(1400px)에서 BPM 라벨을 감싼 조상 요소의
   `background-color`가 `rgb(24,27,34)`(`--surface`)로, `body`의
   `rgb(15,17,21)`(`--bg`)와 다름을 computed style로 확인.
2. **중앙정렬** — 레인 행(`canvas` 조상), 블루투스 문구 `<p>`, 드럼킷
   wrapper의 `getBoundingClientRect()` 중심 x좌표가 셋 다 정확히 830.5로
   일치함을 확인.
3. **Drawer 트랜지션** — 좁은 화면(420px)에서 열기 직후 `transform:
   matrix(1,0,0,1,0,0)`(완전히 열림), 닫기 50ms 후
   `transform: matrix(1,0,0,1,-64.12,0)`(슬라이드 도중, 아직 DOM에 존재),
   300ms 후 DOM에서 완전히 사라짐을 확인 — 트랜지션이 실제로 재생됨.
4. **믹서 트리거 비-버튼 스타일** — 좁은 화면에서 트리거 버튼의 computed
   `border: "0px none"`, `background-color: rgba(0,0,0,0)` 확인, 텍스트
   "믹서" 확인.
5. **문구·레이블 전수 확인**(`get_page_text`) — "믹서"(패널 제목), "채널
   볼륨"(구 "믹서" 소제목), "♩= 92"(레인 좌측 상단), 갱신된 블루투스 문구
   전부 정상 노출. "설정" 텍스트가 더는 어디에도 안 남음.
6. 콘솔 확인 — 최근 vite 서버 로그(hmr update) 전부 정상, 신규 에러 없음
   (세션 초반부터 누적된 401/과거 트랜지언트 리로드 메시지만 존재 — 이번
   변경과 무관, 재확인됨).
7. **지연 보정 재설정 버튼**(추가 요청) — JS로 입력값을 220ms로 바꿔
   localStorage(`drumPractice.audioLatencyCompensationMs`)에 "220"이 저장됨을
   먼저 확인한 뒤, 재설정 아이콘 클릭 → 입력 필드 값과 localStorage 값 둘 다
   "0"으로 돌아옴을 확인.

## 남은 작업
- Codex 모드A 검수 → 통과 시 `main` 병합.
