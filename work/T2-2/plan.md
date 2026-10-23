> 한 줄 요약: T2-2 — 마스터 클록(Tone.js Transport)·MIDI 드럼 신스·메트로놈·카운트인을 구현. 틱→초 변환 등 순수 계산 로직은 단위 테스트, 실제 오디오 노드(Tone 신스·Transport)는 jsdom에서 테스트 불가해 브라우저로 수동 확인.

# T2-2 계획

## 목표
`intent/05-todo.md` T2-2: "오디오 엔진: 마스터 클록, MIDI 드럼 소리, 메트로놈, 카운트인 (REQ-04)".

## 근거
REQ-04: 연습 BPM 50~150%, 오디오/MIDI/레인/메트로놈 동기화, 메트로놈(켜기/끄기·음량·강박·박단위), 카운트인(1마디). `intent/03-architecture-stack.md` §1 "단일 마스터 클록: 오디오 컨텍스트 시간을 기준으로 레인·메트로놈·MIDI 소리 스케줄링"(REQ-11 대비) — Tone.js의 Transport가 AudioContext 시간 기반이라 이게 곧 "마스터 클록"의 구현체.

## 범위 — 이번 작업이 다루는 것과 안 다루는 것
T2-2 제목 자체가 "오디오 엔진"(엔진=메커니즘)이고, REQ-04의 나머지(BPM 50~150% **슬라이더**, A-B 루프)는 `intent/05-todo.md`에 **T2-4로 별도** 분리돼 있다. 이번엔:
- 마스터 클록(Tone.Transport 래퍼) — BPM을 **설정할 수 있는 API**까지(슬라이더 UI는 T2-4).
- DrumScore(T1-5/T2-1에서 만든 DrumNote[])를 재생하는 스케줄러.
- MIDI 드럼 소리(신스 — 아래 "가정" 참고, 실제 샘플 오디오 파일은 안 씀).
- 메트로놈(켜기/끄기, 음량, 강박, 4분/8분 박).
- 카운트인(재생 전 1마디).
- REQ-04의 **측정 수용 기준**(60/100/130%에서 ±30ms 이내)은 이번에 측정하지 않음(아래 "가정" §Q-05 참고).

## 설계
### 왜 jsdom에서 Tone.js를 테스트할 수 없는지(실제 실행으로 확인)
`Tone.getTransport()`는 jsdom에서 예외 없이 "객체"를 반환하지만 내부적으로 깨져 있음(`bpm.value` 접근 시 `Cannot set properties of undefined`, `schedule`은 함수가 아님) — jsdom이 Web Audio API(`AudioContext`)를 전혀 구현하지 않기 때문. `new Tone.MembraneSynth()`는 바로 `param must be an AudioParam` 예외로 실패함. 따라서:
- **순수 계산 로직**(틱→초 변환, 메트로놈 클릭 시각 생성, 카운트인 길이 계산)은 Tone.js를 전혀 쓰지 않는 평범한 함수로 분리해 **단위 테스트**로 검증.
- **Tone.js를 실제로 사용하는 코드**(Transport 제어, 신스 생성·트리거)는 얇게 유지하고, **실제 브라우저(Claude Browser pane)로 소리를 듣고 타이밍을 확인**하는 수동 QA로 검증(아래 "수동 QA" 참고).

### 파일
- `app/web/src/audio/timing.ts`(순수, 테스트됨): `secondsPerBeat`, `ticksToSeconds`, `beatsPerBar`, `barDurationSeconds`(카운트인 길이), `metronomeBeatTimes`(마디 수만큼의 클릭 시각+강박 여부 배열).
- `app/web/src/audio/drumVoices.ts`: `DrumPiece` → Tone 신스 매핑(`createDrumVoices()`/`disposeDrumVoices()`). kick/tom류=`MembraneSynth`, snare=`NoiseSynth`, hihat/crash/ride=`MetalSynth`(아래 "가정" §신스 선택 참고).
- `app/web/src/audio/metronome.ts`: `createMetronome()` — `Transport.scheduleRepeat`로 박마다 클릭, 강박은 다른 음높이/음량.
- `app/web/src/audio/clock.ts`: `getMasterClock()` — `Tone.getTransport()`를 감싸 `start/stop/setBpm/getBpm/getPositionSeconds` 같은 우리 쪽 이름으로 노출(다른 모듈이 Tone을 직접 참조하지 않고 이 래퍼만 쓰게 해 "교체 가능한 모듈" 원칙 유지, `intent/03-architecture-stack.md` §1).
- `app/web/src/audio/scorePlayer.ts`: `playDrumScore(score, voices, {countInBars})` — 카운트인 길이만큼 지연시켜 각 노트를 `Transport.schedule`로 예약, 해당 `piece`의 신스를 트리거.

### 틱→초 변환이 핵심 — Transport의 PPQ(기본 192)와 DrumScore의 ppq(예: 960)가 다를 수 있음
Transport에 내장된 틱 기반 스케줄링을 쓰지 않고, DrumScore의 `ppq`로 직접 초 단위를 계산해 `Transport.schedule(callback, 초)`로 예약한다(Tone.js Units 문서: 숫자를 Time으로 넘기면 "초"로 해석됨 — 타입 정의 주석으로 확인). PPQ 불일치 문제를 원천적으로 피함.

## 수동 QA(브라우저, Tone.js는 jsdom에서 검증 불가)
`qa-evidence/T2-2/`에 다음을 기록:
1. 브라우저 콘솔에서 실제로 소리가 나는지(각 9종 분류 1번씩).
2. 메트로놈 켜고 들어보기(강박이 다르게 들리는지).
3. 카운트인 1마디 후 노트가 시작되는지(귀로 + 콘솔 로그의 `Transport.seconds` 타임스탬프로).
4. BPM을 바꿔도 모든 소리(메트로놈+노트)가 같은 비율로 빨라지는지.

## 가정
- **신스 선택**(Tone.js 내장 합성음, 샘플 오디오 아님): REQ-05가 "MIDI 드럼 소리(신스/샘플)"라고 괄호로 둘 다 언급해 결정이 안 돼 있음. 샘플 오디오를 쓰려면 실제 드럼 샘플 파일을 만들거나 구해야 하는데(라이선스·에셋 제작 필요) 이번 범위를 벗어나므로, 라이선스 걱정 없는 Tone.js 내장 신스(MIT)로 우선 구현. 음색이 마음에 드는지는 의뢰인 확인이 필요해 `intent/07-open-questions.md`에 Q-19로 등록(Q-09의 드럼킷 그래픽과 같은 결의 "디자인 승인 필요" 항목).
- **REQ-04 측정 수용 기준(±30ms)은 이번에 측정 안 함**: `intent/07-open-questions.md` Q-05가 이미 "Phase 2~3에서 실제 메트로놈(Tone.js)·분리 오디오 트랙 함께 재생하는 end-to-end 테스트로 재검증"이라고 계획해둠 — 지금은 분리 오디오 트랙(Phase 3)도 BPM 슬라이더 UI(T2-4)도 없어 "실제 사용 시나리오"를 아직 구성할 수 없음. 엔진 자체는 만들지만 공식 측정은 더 많은 조각이 모인 뒤로 유지.
- 메트로놈 음량 수치 설정(dB 범위)·강박 음높이 차이는 구현 세부사항으로 임의 설정 — 의뢰인 확인 사항 아님.
- 레인 동기화(T2-3)와의 실제 연결은 이번 범위 아님 — `getMasterClock().getPositionSeconds()`를 T2-3이 읽어 쓰는 것은 다음 작업.

## 테스트 계획
1. `secondsPerBeat(bpm)`: 60bpm→1초, 120bpm→0.5초, 150bpm 등
2. `ticksToSeconds(tick, ppq, bpm)`: 960ppq·120bpm에서 960틱(=1비트)→0.5초
3. `beatsPerBar(timeSignature)`: [4,4]→4, [3,4]→3, [6,8]→6
4. `barDurationSeconds(timeSignature, bpm)`: [4,4]·120bpm→2초(카운트인 길이)
5. `metronomeBeatTimes(timeSignature, bpm, bars)`: [4,4]·120bpm·1마디 → 4개 클릭, 첫 클릭만 강박, 간격 0.5초
6. 경계값: bpm<=0, timeSignature 분모 이상값 등 비정상 입력에도 크래시 없이 합리적 결과(또는 명확한 에러) 반환
