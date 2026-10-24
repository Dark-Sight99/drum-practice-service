> 한 줄 요약: T2-8 QA — 프론트(tsc/oxlint/vitest 131/131)·백엔드(ruff/pytest 81/81) 전부 통과. 의뢰인이 실사용 중 보고한 음원-화면 동기화 버그(카운트인 오프셋 누락)를 코드로 재현·수정 확인, 연습 화면 R/L 즉석 자동계산도 실제 브라우저로 확인.

# T2-8 QA 결과(2026-10-24)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 프론트 타입체크 | `npx tsc -b` | PASS |
| 프론트 lint | `npx oxlint` | PASS |
| 프론트 단위 테스트 | `npx vitest run --reporter=verbose` | PASS (131/131 — T2-7까지 129개 + T2-8 신규 2개: `validate.test.ts`의 audioOffsetMs 비영점/비유한 거부) |
| 백엔드 lint | `ruff check`(T2-8가 바꾼 파일) | PASS |
| 백엔드 포맷 | `ruff format --check`(T2-8가 바꾼 파일) | PASS |
| 백엔드 단위 테스트 | `pytest` | PASS (81/81, T2-8 신규 2개) |
| 수동(실제 브라우저+실제 서버) | 아래 "수동 QA" 섹션 | PASS |

전체 로그: `raw_log.txt`

## 배경
의뢰인이 Phase 2 게이트에서 실제 MIDI 곡(MusicDelta_Grunge)으로 연습 화면을 써보고 2026-10-24에 보고:
1. 노트가 판정선을 다 지나간 뒤에야 드럼 소리가 들림
2. 노트가 안 보이는데 소리만 들릴 때가 있음
3. 곡 초반 5초가 특히 안 맞음
4. R/L 표시 토글이 차이가 없음

## 원인(코드로 확인) 및 수정
- `app/web/src/audio/scorePlayer.ts`의 노트 재생 스케줄은 `songStartSeconds`(카운트인 길이, 120bpm 4/4 1마디=2초)를 더하는데, `app/web/src/render/laneRenderer.ts`의 노트 위치 계산(`noteTimeOf`)은 이 값을 빼먹어 노트가 2초 일찍 화면에 나타남 → 보고 ①②③과 정확히 일치. `LaneRenderer.render()`에 `songStartSeconds` 파라미터를 추가해 `PracticeCanvas.tsx`가 실제 재생과 같은 값을 넘기도록 수정.
- Codex 모드C 1차 지적(C-001): `laneRenderer.ts`는 `audioOffsetMs`를 더하는데 `scorePlayer.ts`는 전혀 반영 안 해 비영점 값에서 또 다른 동기 어긋남이 생길 수 있음 — `scorePlayer.ts`에도 `audioOffsetMs`를 더해 대칭화.
- Codex 모드C 3차 지적(C-001): 그 대칭화가 A-B 루프 경계를 넘기는 노트를 만들 수 있는데, "현재 설정 경로가 없다"는 보류 근거가 API 검증까지 확인 안 한 성급한 판단이었음 — `score/validate.ts`·`api/schemas.py` 둘 다 `audioOffsetMs`를 "정확히 0"으로 검증 강화(Phase 3 전까지 임시 제한, Q-23).
- 보고 ④(R/L 토글 무반응)는 버그가 아니라 데이터 문제(해당 곡에 스티킹 정보가 없었음) — 의뢰인 선택에 따라 `PracticeCanvas.tsx`가 저장 없이 `recommendSticking()`으로 즉석 계산해 보여주도록 수정.

## 신규 테스트
- `score/validate.test.ts`(2개): `audioOffsetMs`가 0이 아니면 거부, 비유한(Infinity)이면 거부.
- `app/server/tests/test_songs_upload_api.py`(1개): 업로드 시 `audioOffsetMs=500` 거부(422), 고아 DB 행 안 남음.
- `app/server/tests/test_songs_editor_api.py`: 기존 파라미터화 불변식 목록에 `audioOffsetMs=500` 케이스 추가.
- `render/laneRenderer.ts`/`audio/scorePlayer.ts` 자체는 전용 단위 테스트 없음(Canvas·Tone.js, jsdom 한계 — T2-2/T2-3부터 이어진 패턴) — 수동 QA로 검증.

## 수동 QA(실제 브라우저 + 실제 FastAPI 서버)
Vite dev(5173) → `/api` 프록시 → 실제 `uvicorn`(127.0.0.1:8000)로 확인. 실제 사용자 곡 "MusicDelta_Grunge"로 진행(읽기 전용 재생만 — 저장 호출 없음, 데이터 변경 없음).

1. **R/L 즉석 자동계산**: 편집기를 한 번도 연 적 없는 곡인데 연습 화면 진입만으로 레인에 R/L 글자가 바로 보임(스크린샷 `screenshot-rl-auto-display.jpg`) — "자동 추천 재적용"을 눌러야만 보이던 기존 흐름 없이 동작.
2. **동기화 수정 확인(핵심)**: 재생 시작 후 정확히 2초(카운트인 1마디, 120bpm 4/4) 지점에서 스크린샷 — 첫 실제 노트(SN, L)가 판정선(하단 흰 선)에 정확히 걸쳐 있음(`screenshot-sync-at-countin-end.jpg`). 수정 전이었다면 이 노트는 이미 2초 전(재생 시작 직후)에 화면에 나타나 판정선을 지나쳐 훨씬 아래(화면 밖)로 사라졌어야 함 — 실제로는 카운트인이 끝나는 바로 그 순간에 판정선에 있어, 실제 소리가 스케줄되는 시점과 화면 위치가 일치함을 확인.
3. **A-B 루프에서도 동일 확인**: 루프 켜고 재생 2초 지점 스크린샷(`screenshot-sync-loop-mode.jpg`) — 루프 모드도 같은 `render()` 호출 경로를 타므로 동일하게 확인, 킷 점등(SN, 점선 테두리=왼손)도 같은 타이밍에 반영됨.
4. **콘솔 에러 없음**: 재생 전/중/후 `read_console_messages`로 확인 — 남아있던 에러는 전부 이번 QA 세션 이전(과거 HMR 재시도 중 발생)의 누적 기록이었고(`read_console_messages`가 탭 단위로 과거 기록을 들고 있음, 새 네비게이션 후에도 동일 목록 반복 확인으로 교차검증), 이번 재생 조작으로 새로 발생한 에러는 0건.
