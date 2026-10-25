> 한 줄 요약: T3-6(일시정지/이어재생) QA 결과 — 모드A 1라운드가 찾은 "카운트인 중 일시정지→재개 시 원곡 오디오가 너무 일찍 재생"버그를 trackPlayer.ts의 started 플래그로 수정, 전부 재검증 통과. 오디오 가청 검증(크래시 끊김·모바일 재생 거부)은 Claude가 들을 수 없어 의뢰인 확인 필요.

# T3-6 QA 결과

## 근거(REQ)
- REQ-04 "일시정지/이어재생"(2026-10-25 의뢰인 요청 추가): "멈춘 지점부터 다시 재생. 기존 '정지'와는 별개 동작."
- 설계: `work/T3-6/plan.md` v4(모드C 3라운드 — 1라운드 BLOCKING, 2라운드 BLOCKING, 3라운드 BLOCKING 후 마스터 직접 판단으로 종료, §모드C 3라운드 반영 참고).

## 변경 내용
- `app/web/src/audio/drumVoices.ts` — `DrumVoice.stopAllRinging()`/맵 전체용 `stopAllRinging(voices)` 신설. 이미 커밋된 원샷(디케이 중이거나 lookahead로 예약만 된 것)을 즉시 끊음.
- `app/web/src/audio/metronome.ts` — `Metronome.stopRinging()`(`synth.triggerRelease()`) 신설.
- `app/web/src/audio/trackPlayer.ts` — `TrackPlayer.pause()`/`resume()` 신설(언락된 트랙만).
- `app/web/src/audio/scorePlayer.ts` — `PlaybackHandle.pause()`/`resume()` 신설. pause()는 `transport.pause()` + `stopAllRinging(voices)` + `countInSynth.triggerRelease()` + `tracks?.pause()`. resume()은 `transport.start()`(오프셋 없음) + `tracks?.resume()`.
- `app/web/src/features/practice/PracticeCanvas.tsx` — `isPaused` 상태, "⏸ 일시정지" 버튼, `handlePause()`/`handlePlay()`의 재개 분기, `performance.now()` 기반 자동 정지 타이머 재계산(`autoStopTimerIdRef`/`autoStopRemainingMsRef`/`autoStopScheduledAtRef`), BPM/A-B 루프 입력 `disabled`에 `isPaused` 추가, "⏸"/"▶" 핸들러 둘 다 `playbackRef.current` 생존 가드(모드C 3라운드 C-001).

## 모드A 1라운드 지적(High, 반영함)
`trackPlayer.ts`의 `resume()`이 `unlocked`(=prime() 성공)인 트랙에 무조건 `.play()`를 불렀는데, `unlocked`는 "이 세션에서 실제로 playFrom()으로 시작된 적 있는지"와는 다른 조건 — 카운트인 중(아직 `playFrom()`이 한 번도 안 불린 시점)에 일시정지→재개하면 Transport의 예약된 `playFrom()` 콜백이 실행되기 전에 `resume()`이 먼저 `.play()`를 불러, 카운트인이 끝나기도 전에 원곡 오디오가 들리는 버그였음. `TrackState`에 `started: boolean`(기본 false, `playFrom()`이 설정)을 추가하고 `resume()`을 `!unlocked || !started`면 건너뛰도록 수정 — 아직 안 시작된 트랙은 Transport가 재개돼 원래 예약된 `playFrom()`이 때가 되면 알아서 시작시키게 둠(기존 T2-4/T3-3 경로 그대로, 추가 개입 없음).

## 자동 테스트
```
cd app/web
npx tsc --noEmit        # 통과
npm test -- --run       # 17 test files / 177 tests 모두 통과(기존 173 + pause/resume 신규 4 — started 가드 회귀 테스트 포함)
npm run lint            # oxlint 통과, 경고 없음
```
`drumVoices.test.ts`에는 `stopAllRinging()` 자동 테스트를 추가하지 않음 — `sampleVoice()`가 비공개라 단위 테스트하려면 Tone.Player/ToneAudioBuffer 전체를 모킹해야 하는데, 이 파일은 애초에 `trigger()`/`dispose()`도 전혀 단위 테스트하지 않는 기존 선례(jsdom에 Web Audio 디코딩이 없음)를 그대로 유지(plan.md §QA계획에 명시, 구현 중 범위 조정).

## 모드A 지적 수정 후 브라우저 검증(HTMLMediaElement.prototype.play 몽키패치로 호출 시점 로깅)
- **count-in 중 일시정지→재개(버그 재현 시도)**: 재생 직후 빠르게 일시정지를 눌렀을 때 — 자동화 클릭의 왕복 지연 때문에 정확히 count-in 구간(2초) 안에서 멈추는 걸 안정적으로 재현하진 못함(타이밍에 민감 — 아래 "검증하지 못한 것" 참고). 대신 **동일한 시나리오를 정확히 겨냥한 단위 테스트**(`trackPlayer.test.ts` "resume() does NOT play a track that was primed but never started via playFrom()")로 확정적으로 재현·검증함 — prime()만 하고 playFrom()을 안 부른 상태에서 resume()을 호출해도 play()가 전혀 안 불림을 확인(수정 전이었다면 이 테스트가 실패했을 것).
- **count-in 이후 일시정지→재개(정상 경로 회귀 확인)**: 재생 후 3초 대기(count-in 2초 지남, 원곡 오디오가 이미 시작된 상태)→일시정지→재생을 브라우저로 직접 수행, `play()` 호출 로그로 "prime() 배치(4건) → playFrom() 배치(4건) → resume() 배치(4건)" 순서로 정확히 3차례 호출됨을 확인 — 정상적으로 이미 시작된 트랙은 재개 시 여전히 다시 재생됨(이번 수정이 정상 경로를 깨지 않음).

## 브라우저 수동 검증(localhost:5174, 로그인된 세션, huibigyocha 곡)
- **재생→일시정지**: 재생 중 "⏸ 일시정지" 클릭 → 버튼 상태가 `▶ 재생`(활성)/`⏸ 일시정지`(비활성)/`⏹ 정지`(활성)로 정확히 전환됨(`button.disabled` 직접 읽어 확인).
- **일시정지 중 BPM/루프 잠금**: BPM 슬라이더·A-B 루프 체크박스 `disabled=true` 확인(재생 중과 동일하게 잠김).
- **일시정지→재개**: "▶ 재생" 클릭 → 버튼이 다시 재생 중 상태로 전환, 레인 스크린샷으로 노트가 처음(카운트인)이 아니라 이미 진행된 위치에서 계속 진행되는 것을 확인(멈춘 지점부터 재개 — 처음으로 안 돌아감).
- **일시정지 중 정지**: "⏸" 후 "⏹" 클릭 → `▶ 재생`(활성)/`⏸`(비활성)/`⏹`(비활성)로 완전 정지 상태 전환 확인(`isPaused`도 같이 리셋됨 — stopPlayback() 공유 경로).
- **정지 후 재시작**: 바로 "▶ 재생" 다시 클릭 → 스크린샷으로 레인이 처음(카운트인 근처)부터 다시 시작하는 것 확인 — 일시정지 상태가 잘못 남아 "재개"로 오분기하지 않음.
- 전 과정(재생→일시정지→재개→일시정지→정지→재시작)에서 **콘솔 에러 0건**(`read_console_messages(onlyErrors:true)`로 매 단계 확인).

## 검증하지 못한 것(의뢰인 확인 필요 — Claude는 소리를 들을 수 없음)
- **1라운드 핵심 회귀**: 크래시/라이드처럼 디케이가 긴 피스를 친 직후 일시정지를 눌렀을 때 그 소리가 실제로 즉시(또는 거의 즉시) 끊기는지 — 코드는 `stopAllRinging()`이 실제 설치된 Tone.js 소스(Player.js/Source.js)로 검증된 메커니즘으로 호출되지만, 가청 확인은 사람이 들어야 함.
- 메트로놈/카운트인 클릭의 `triggerRelease()` 테일이 체감상 무시할 만한지.
- 모바일(iOS Safari 등)에서 일시정지 후 재생이 제스처 거부 없이 되는지.
- 곡 길이에 비해 충분히 길게 일시정지해뒀다가 재생해도 자동 정지 타이머가 조기/지연 발동하지 않는지(실시간 수십 초~분 단위 대기가 필요해 이번 자동 QA 세션에서는 직접 재현하지 않음 — 코드 리뷰로 로직 확인, 실사용 중 문제 생기면 후속 피드백으로 받기로 함).

## 결론
상태 기계(일시정지/재개/정지 전이, UI 잠금, 생존 가드)는 자동 테스트+브라우저로 확인 완료. 오디오 자체의 가청 동작(크래시 끊김 등)은 사람의 청취 확인이 필요 — 의뢰인 실기기 테스트에서 재차 QA 요청 예정.
