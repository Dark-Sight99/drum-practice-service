> 한 줄 요약: T3-9(재생 위치 탐색 ±10초 + 현재 위치로 A-B 구간 지정) QA 결과 — Codex 모드C 3라운드 전부 반영(루프 즉시 적용·타이머 재계산·일시정지 중 트랙 오재생 방지), 테스트/타입체크/린트 통과, 브라우저로 핵심 시나리오 전부 확인.

# T3-9 QA 결과

## 근거(REQ)
- REQ-04 "구간 반복(A-B 루프)" + "재생 위치 탐색 + 현재 위치로 A-B 구간 지정"(2026-10-25 신규 추가).
- 의뢰인 실사용 피드백: "A-B 루프 마디수 입력 방식으론 못 쓰겠는데? 악보 없이 듣다가 지금 위치가 몇 번째 마디인지 어떻게 아는데." → 명확화 후 "여기서 시작/여기까지" 버튼 + 되돌아갈 수 있는 탐색 수단(±10초, 구현 쉬운 쪽) 확정.

## 변경 내용
1. `app/web/src/audio/timing.ts` — `barIndexForSeconds(positionSeconds, songStartSeconds, barSeconds)` 신설(NaN/Infinity·barSeconds<=0 방어).
2. `app/web/src/audio/clock.ts`(MasterClock) — `setPositionSeconds`/`setLoopPoints`/`setLoopEnabled` 신설(전부 Tone.js Transport로의 얇은 패스스루, 실제 설치된 소스로 "재생 중에도 즉시 반영됨"을 확인 후 설계).
3. `app/web/src/audio/trackPlayer.ts` — `seekTo(songPositionSeconds, playbackRate)` 신설(`playFrom()`과 달리 `.play()`를 안 부름 — 일시정지 중 seek 전용).
4. `app/web/src/features/practice/PracticeCanvas.tsx` — `songEndPositionSeconds()`(핸들플레이·시크 공유), `handleSeek(deltaSeconds)`(◀◀10초/10초▶▶ 버튼), `markLoopPointFromCurrentPosition(which)`(⏱ 여기서 시작/여기까지 버튼), 재생 중 루프 설정을 살아있는 Transport에 즉시 반영하는 `useEffect` 신설.

## 설계·검수 이력
"오디오 타이밍·동기" 위험 작업 — Codex 모드C 3라운드(파이프라인 최대):
- **1라운드 BLOCKING**: (C-001) 재생 중 마디를 찍어도 네이티브 루프에 반영되는 경로가 없었음 → 재생 중 루프 설정을 즉시 Transport에 반영하는 useEffect 신설로 해소. (C-002) seek이 T3-6 자동 정지 타이머를 재계산 안 함 → `songEndPositionSeconds()` 공유 + seek 시 재계산 로직 추가.
- **2라운드 BLOCKING**: (C-007) seek 시 자동 정지 타이머 재계산이 일시정지 여부와 무관하게 항상 실시간 타이머를 걸어, 일시정지 중에도 자동 정지가 발동할 수 있었음 → `isPaused` 분기로 일시정지 중엔 값만 갱신하고 타이머는 안 걺(T3-6 `pauseAutoStopTimer()`와 동일한 패턴 재사용).
- **3라운드 BLOCKING**: (C-008) 일시정지 중 seek에서도 `playFrom()`을 그대로 써서, Transport는 멈춰있는데 분리 오디오 트랙만 재생이 시작될 수 있었음 → `TrackPlayer.seekTo()` 신설, `handleSeek()`이 `isPaused` 여부로 `playFrom()`/`seekTo()` 분기. 이게 파이프라인 최대 재검수 3회 — 전부 반영 완료로 마스터 판단, 구현 진행.
- 이번 라운드들은 Codex 샌드박스가 한글 경로·일부 명령(`rg`/`python`)을 못 읽는 환경 문제로 재시도가 여러 번 필요했음(내용 기반 거부가 아니었음을 매번 확인 후 재시도) — 실제로 읽은 라운드는 전부 정당한 지적이었고, 반영 후 전부 해소로 재확인됨.

## 자동 테스트
```
cd app/web
npx tsc --noEmit        # 통과
npm test -- --run       # 17 test files / 195 tests 모두 통과(기존 185 + timing.ts 신규 7 + trackPlayer.ts 신규 4 — seekTo() 포함)
npm run lint            # oxlint 통과, 경고 없음
```

## 브라우저 수동 검증 (localhost:5173, 로그인된 세션, huibigyocha 곡)
- 재생 중 "⏱ 여기서 시작" → 3초 후 "⏱ 여기까지" 클릭 → "⟲ 마디 8~13 반복 중" 텍스트가 즉시 나타남(정지·재시작 없이 **지금 재생 중인 세션에 바로 루프가 걸림** — 1라운드 C-001이 정확히 고친 핵심). 이후 수 초간 계속 재생해도 콘솔 에러 없이 정상 동작.
- 일시정지 → `HTMLMediaElement.prototype.play`를 몽키패치해 호출 로그 확보 → "◀◀ 10초" 클릭 → **`play()` 호출 0건**(분리 오디오 트랙이 전혀 재생되지 않음 — 3라운드 C-008이 고친 핵심, `seekTo()`가 쓰였다는 직접 증거). 버튼 상태도 일시정지 그대로 유지됨.
- 이어서 "▶ 재생" 클릭 → 4개 트랙 전부 `play()` 호출 확인(seek한 위치에서 정상적으로 재개).
- 재생 중 "10초 ▶▶" 클릭(새 탭으로 콘솔 이력 초기화 후 재확인) → 콘솔 에러 0건.
- 전 과정에서 믹서(T3-7·T3-8에서 작업한 기능)·일시정지/재개(T3-6) 등 기존 기능 회귀 없음 확인.

## 결론
Codex 모드C가 3라운드 내내 전부 실제 설계 공백을 짚어냈고(루프 미반영·타이머 미인지·트랙 오재생), 전부 코드로 해소·테스트·브라우저로 검증 완료. 크래시 등 디케이가 긴 소리가 점프 순간 끊기지 않고 계속 울릴 수 있다는 점(설계상 수용한 한계)은 Claude가 들을 수 없어 가청 검증 불가 — 의뢰인 확인 필요.
