> 한 줄 요약: 오디오 엔진(마스터 클록·MIDI 드럼 신스·메트로놈·카운트인) 구현. 순수 타이밍 계산은 단위 테스트, Tone.js 연동은 실제 브라우저 수동 QA로 검증 — 메트로놈 선행 실행 후 재생이 전부 무음이 되는 실제 버그를 발견·수정.

# T2-2 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/package.json` | `tone`(MIT) 추가 | REQ-04, 스케줄링·메트로놈(`intent/03-architecture-stack.md` §3) |
| `app/web/src/audio/timing.ts` | 순수 타이밍 계산(초/박/마디/메트로놈 클릭 시각) — Tone.js 의존 없음 | REQ-04, 단위 테스트 가능하게 분리 |
| `app/web/src/audio/clock.ts` | `getMasterClock()` — Tone.Transport 래퍼 | `intent/03-architecture-stack.md` §1 "단일 마스터 클록" |
| `app/web/src/audio/drumVoices.ts` | `createDrumVoices()` — DrumPiece 9종 → Tone 내장 신스 | REQ-04/05 "MIDI 드럼 소리" |
| `app/web/src/audio/metronome.ts` | `createMetronome()` — 박마다 클릭, 강박 구분, 4분/8분 단위 | REQ-04 "메트로놈" |
| `app/web/src/audio/scorePlayer.ts` | `playDrumScore()` — 카운트인 예약 + DrumScore 노트 스케줄링 | REQ-04 "카운트인", REQ-02(T1-5/T2-1의 DrumScore 소비) |
| `app/web/src/audio/index.ts` | 재노출 | — |
| `app/web/src/audio/timing.test.ts` | 테스트 13개 | `work/T2-2/plan.md` 테스트계획 |

## 범위 결정
`intent/05-todo.md`에서 BPM 50~150% 슬라이더·A-B 루프는 T2-4로, 연습 화면 렌더러는 T2-3으로 이미 분리돼 있어, 이번엔 "오디오 엔진"(메커니즘)만: 마스터 클록·MIDI 드럼 소리·메트로놈·카운트인. REQ-04의 공식 수용 기준(±30ms 측정)은 분리 오디오 트랙(Phase 3)·BPM UI(T2-4)가 모두 있어야 하는 end-to-end 측정이라 `intent/07-open-questions.md` Q-05의 기존 계획대로 이번엔 하지 않음. 상세 근거는 `work/T2-2/plan.md` §범위.

## 구현 근거 (실행 결과로 확인)
- jsdom에서 `Tone.getTransport()`가 예외 없이 "객체"를 반환하지만 내부적으로 깨져 있음(`bpm.value` 설정 시 `Cannot set properties of undefined`, `schedule`은 함수 아님), `new Tone.MembraneSynth()`는 바로 예외(`param must be an AudioParam`) — 직접 실행해 확인(CLAUDE.md 규칙2, 기억 아님). 그래서 틱→초 변환 등 순수 계산만 단위 테스트, 나머지는 **실제 브라우저로 수동 QA**.
- Tone.js 타입 정의(`node_modules/tone/build/esm/...d.ts`)를 직접 읽어 API 확인: `Transport.schedule(callback, time)`에서 `time`이 숫자면 "초"로 해석됨(Units.d.ts 주석으로 확인), `MembraneSynth`/`NoiseSynth`/`MetalSynth`의 `triggerAttackRelease` 시그니처, `Transport.PPQ` 기본값 192(소스 코드 직접 확인) — DrumScore 자신의 ppq(960 등)와 다를 수 있어 Transport의 틱 체계를 쓰지 않고 초 단위로 직접 계산해 예약하기로 설계.
- **실제 브라우저 수동 QA로 발견한 버그**: 메트로놈을 먼저 몇 초 돌리고 멈춘 뒤 `playDrumScore`를 실행하면 노트가 하나도 트리거되지 않음. 원인: Transport가 이미 진행된 상태에서, 노트를 "0초 기준" 절대 시각으로 예약해 플레이헤드가 이미 지나간 과거 시각에 예약된 것(Tone.js는 과거 시각 이벤트를 발동 안 함). **수정**: `playDrumScore`가 예약 전 `transport.stop(); transport.position = 0`으로 항상 재생 시작점을 0으로 되돌림. 재검증: 같은 시나리오에서 12개 노트 전부 정상 트리거(`qa-evidence/T2-2/result.md`).

## 실행한 검증
`qa-evidence/T2-2/result.md`, `raw_log.txt` — tsc/oxlint/vitest(46/46) PASS(순수 타이밍 로직만 단위 테스트, Tone.js 연동은 실제 브라우저 수동 QA로 검증 — jsdom이 Web Audio API를 구현 안 해 단위 테스트 불가).

## 가정
- MIDI 드럼 소리는 Tone.js 내장 신스(합성음), 실제 드럼 샘플 오디오 아님 — 라이선스/에셋 제작 부담 없는 선택, 음색 승인은 `intent/07-open-questions.md` Q-19.
- REQ-04의 ±30ms 공식 측정은 이번에 안 함 — Q-05의 기존 계획(Phase 2~3, 분리 오디오 트랙+BPM UI 모두 있을 때)대로 보류.
- 메트로놈 음량(dB)·강박 음높이 차이는 구현 세부사항으로 임의 설정.

## 질문
- 없음.

## 남은 문제
- T2-3(연습 화면 렌더러)이 `getMasterClock().getPositionSeconds()`를 읽어 레인과 동기화할 차례.
- T2-4(BPM 슬라이더)가 `getMasterClock().setBpm()`을 실제로 UI에 연결.
- Q-05(±30ms 공식 측정), Q-19(신스 음색 승인) 모두 열려 있음.

## Codex 모드 A 검수 반영 (2026-10-23)
판정: REQUEST_CHANGES. 원문: `qa-evidence/T2-2/codex-modeA.md`.

- **C-001**(필수): `clock.ts`·`scorePlayer.ts`가 `transport.timeSignature`에 분자만 넘겨서, 4가 아닌 분모(6/8 등)에서 Transport의 "1마디" 길이 계산이 틀어진다는 지적 — 실제 브라우저로 재현 확인(분자만 6→1마디 3초로 잘못 계산, 정답 1.5초). `score.meta.timeSignature` 배열 전체를 그대로 넘기도록 수정, 수정 후 1.5초로 정확히 나옴을 재확인.
- **C-002**(권장): 메트로놈 강박 판정이 로컬 카운터 기반이라 Transport가 마디 경계 아닌 위치에서 이미 돌고 있으면 강박이 틀어질 수 있다는 지적 — `Transport.getTicksAtTime()`으로 그 순간의 절대 틱을 읽어 계산하도록 변경, 실제 브라우저에서 Transport를 1.1초(마디 경계 아님)에서 시작해도 강박이 정확히 전역 마디 경계(0,2,4...초)에 맞음을 확인.
