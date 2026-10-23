> 한 줄 요약: T2-2 QA — tsc/oxlint/vitest 전부 통과(46/46: 기존 33개 + 신규 13개 순수 타이밍 테스트). 실제 브라우저 수동 QA로 진짜 버그(메트로놈 먼저 실행 후 재생 시 노트가 전부 안 울리는 문제) 재현·수정.

# T2-2 QA 결과(2026-10-23)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npx tsc -b` | PASS |
| lint | `npx oxlint` | PASS |
| 포맷 | `npx prettier --check src/audio` | PASS |
| test(단위) | `npx vitest run` | PASS (46/46, T2-2 신규 13개 — `timing.ts` 순수 함수만) |
| test(수동, 브라우저) | Claude Browser pane에서 실제 오디오 재생 | PASS(버그 발견·수정 후) — 아래 참고 |

전체 로그: `raw_log.txt`

## 왜 Tone.js 관련 코드는 단위 테스트가 없는가
`Tone.getTransport()`가 jsdom에서 예외 없이 "객체"를 반환하지만 내부적으로 깨져있음(`bpm.value` 접근 시 `Cannot set properties of undefined`, `schedule`은 함수가 아님) — jsdom이 Web Audio API를 구현 안 하기 때문(실제 실행으로 확인, `work/T2-2/plan.md`). `new Tone.MembraneSynth()`는 바로 예외. 그래서 틱→초 변환 같은 **순수 계산**만 `timing.ts`로 분리해 단위 테스트했고, Tone.js를 실제로 쓰는 `clock.ts`/`drumVoices.ts`/`metronome.ts`/`scorePlayer.ts`는 **실제 브라우저**로 수동 검증했다.

## 신규 단위 테스트(timing.ts, 13개)
| 테스트 | 확인하는 것 |
|---|---|
| `secondsPerBeat` | 60/120/150bpm을 4분음표 길이(초)로 정확히 변환 |
| `ticksToSeconds` | DrumScore 자신의 ppq 기준 틱→초(960ppq·120bpm에서 1비트=0.5초 등), 다른 ppq(Transport 기본 192)에서도 동일 공식 성립 |
| `beatsPerBar` | 4/4·3/4(4분 단위), 4/4(8분 단위, 2배), 6/8(8분 단위, 자연스러운 박 6개) |
| `barDurationSeconds` | 4/4·120bpm=2초(카운트인 길이 기준값), 6/8·120bpm=1.5초 |
| `metronomeBeatTimes` | 1마디(4클릭, 첫 클릭만 강박, 0.5초 간격), 여러 마디(강박 패턴 반복), 시작 오프셋 적용, 8분 단위(8클릭) |

## 수동 QA(실제 브라우저) — 발견한 버그와 수정
Claude Browser pane에서 Vite dev 서버를 띄우고, 임시 하니스(QA 후 삭제)로 실제 오디오를 재생/확인했다.

1. **오디오 시작 + 9종 신스 생성·트리거**: 콘솔 에러 없음.
2. **메트로놈 단독 실행**(120bpm, 4/4, 4분): 콘솔 에러 없음.
3. **버그 재현**: 메트로놈을 먼저 몇 초 돌리고 멈춘 뒤 `playDrumScore`를 실행하면 **노트가 하나도 트리거되지 않음**(12개 중 0개). 원인: Transport가 메트로놈 실행으로 이미 16.5초까지 진행된 상태인데, `playDrumScore`가 노트를 "Transport 0초 기준" 절대 시각(0~4.75초)으로 예약해서 플레이헤드가 이미 지나간 과거 시각에 예약된 셈이 됨 — Tone.js Transport는 과거 시각에 예약된 이벤트를 발동하지 않음.
4. **수정**: `scorePlayer.ts`에서 노트를 예약하기 전에 `transport.stop(); transport.position = 0`으로 항상 재생 시작점을 0으로 되돌림.
5. **재검증**: 같은 시나리오(메트로놈 먼저 실행 후 재생)에서 12개 노트 전부 트리거됨(0개 누락), 노트 간 간격도 테스트 악보의 틱 간격(240틱=0.25초)과 정확히 일치.

이 버그는 **jsdom으로는 절대 못 잡는 종류**였다(Transport 자체를 jsdom에서 만들 수 없음) — 실제 브라우저 수동 QA 단계가 `work/T2-2/plan.md`에 명시돼 있었고, 그 계획대로 실행해서 실제로 버그를 잡아냄.

## 수용 기준(REQ-04) 충족 여부 — 이번 작업 범위
- [x] 마스터 클록·MIDI 드럼 소리·메트로놈·카운트인 메커니즘 구현(엔진 자체)
- [ ] "60%·100%·130%에서 3분 재생 시 오디오와 메트로놈/레인 어긋남이 ±30ms 이내" — **이번에 측정 안 함**. `intent/07-open-questions.md` Q-05가 이미 "분리 오디오 트랙(Phase 3)과 BPM 슬라이더(T2-4)가 모두 있어야 실제 사용 시나리오로 측정 가능"이라고 계획해둔 대로, 더 많은 조각이 모인 뒤 end-to-end로 공식 측정할 예정(`work/T2-2/plan.md` §가정).
- [x] 루프 경계에서 끊김 없음 — A-B 루프는 T2-4 범위, 이번엔 다루지 않음.

## 가정/한계
- MIDI 드럼 소리는 Tone.js 내장 신스(합성음)로 구현, 실제 드럼 샘플 오디오 아님 — 음색 승인 필요(`intent/07-open-questions.md` Q-19).
- 수동 QA에서 측정한 "노트 트리거 타이밍"은 JS 콜백 실행 시점에 `Transport.seconds`를 읽은 값이라 실제 Web Audio 스케줄 정밀도보다 다소 늦게 보일 수 있음(측정 방법 자체의 한계) — REQ-04의 공식 ±30ms 측정과는 다른, "크래시 없이 올바른 순서로 트리거되는지" 확인용.

## Codex 모드A 검수 반영
원문: `codex-modeA.md`. 판정: REQUEST_CHANGES.

- **C-001**(필수, `clock.ts`·`scorePlayer.ts`): 박자표를 Transport에 설정할 때 분자만 넘겨서, 4가 아닌 분모(예: 6/8)에서 Transport가 1마디 길이를 잘못 계산한다는 지적 — **재현됨**(실제 브라우저 콘솔로 확인: 분자만 6으로 설정하면 Transport가 "1마디"를 3초로 계산, 정답은 1.5초). **수정함**: `score.meta.timeSignature`(분자+분모 배열)를 그대로 `transport.timeSignature`에 전달(Transport가 배열을 받으면 "분모 4 기준 분자"로 환산한다는 공식 타입 주석대로). 수정 후 실제 브라우저에서 `[6,8]` 설정 시 1마디=1.5초로 정확히 나옴을 재확인.
- **C-002**(권장): 메트로놈의 강박 판정이 콜백마다 1씩 올리는 로컬 카운터 기반이라, Transport가 마디 경계가 아닌 위치에서 이미 돌고 있을 때 메트로놈을 켜면 강박 위치가 처음부터 틀어질 수 있다는 지적 — **재현됨**(설계상 명백, 실제로도 확인). **수정함**: 로컬 카운터 대신 `Transport.getTicksAtTime()`으로 그 순간의 절대 틱을 읽어 "몇 번째 클릭인지"를 계산하도록 변경 — 메트로놈이 언제 시작되든 항상 전역 마디 경계(0초, 2초, 4초...) 기준으로 강박이 맞음. 실제 브라우저에서 Transport를 마디 경계가 아닌 1.1초에서 시작한 뒤 메트로놈을 켜고 콘솔 로그로 확인(4클릭마다 정확히 강박, 강박 시각이 전부 절대 2초 배수에 수렴).
