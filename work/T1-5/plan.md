> 한 줄 요약: T1-5 — DrumScore TypeScript 타입·검증 함수·GM 타악기 매핑 상수(공식 표로 재확인) + 단위 테스트. app/web에 구현(아래 "범위" 근거 참고).

# T1-5 계획

## 목표
`intent/05-todo.md` T1-5: "DrumScore 타입·검증·GM 매핑 상수 + 단위 테스트 (REQ-02)".

## 근거
- `intent/03-architecture-stack.md` §2: DrumScore JSON 스키마, GM 매핑 예시값, "구현 시 공식 표로 재확인" 명시.
- `intent/02-requirements.md` REQ-02: 세 입력 경로(오디오 ADT / 종이 OMR / 디지털 악보 파서)가 모두 DrumScore로 수렴. 최소 분류 9종(킥·스네어·하이햇 닫힘·열림·탐 하이/미드/플로어·크래시·라이드). 수용 기준에 "인식 실패/부분 인식 시에도 크래시 없이 '인식된 부분 + 편집 필요' 상태로 진입" 포함 → 검증 함수는 예외를 던지는 대신 에러 목록을 반환하는 형태가 적합.

## 범위 — 왜 app/web(TypeScript)인가
`intent/03-architecture-stack.md` §1: "모든 화면이 이 형식만 읽음" — DrumScore는 근본적으로 프런트엔드가 읽는 계약. T1-1에서 이미 `app/web/src/score/`(빈 디렉터리, `.gitkeep`만)를 이 용도로 스캐폴드해둔 것으로 봐서 의도된 위치로 판단. 또한 REQ-02 경로 C(MIDI/MusicXML/GP)는 `@tonejs/midi`·`alphaTab`(둘 다 JS/TS 라이브러리, `03-architecture-stack.md` §3 기술스택 표)로 처리하도록 돼 있어 **브라우저에서 직접 DrumScore를 생성**하는 경로임 — TypeScript 타입이 먼저 필요하다.
- 경로 A(ADT)·B(OMR)는 Python 서버가 DrumScore JSON을 "생성"하지만, 이건 Phase 3(T3-2)·Phase 4(T4-1) 범위(`intent/05-todo.md`)다. 지금 Python 쪽에 동일한 타입을 미리 만드는 건 CLAUDE.md 절대규칙 6(범위 밖 작업 금지) 위반 — 그 작업에서 "JSON 직렬화 결과가 TypeScript 쪽 타입·검증 함수를 통과하는지"로 교차 검증하면 된다. 서버는 지금 DrumScore를 거의 그대로 파일(`assets`)로 저장·전달만 하면 되고 타입 강제가 필요 없음(T1-2에서 이미 `Asset` 테이블·경로 검증 완료).

## 설계
- `app/web/src/score/types.ts`: `DrumPiece`(9종 리터럴 유니온), `Hand`(`'R'|'L'|'RF'|'LF'|null`), `HandSource`(`'auto'|'user'`), `ScoreSource`(`'audio'|'omr'|'midi'|'musicxml'|'gp'`), `DrumNote`, `DrumScoreMeta`, `DrumScore`(버전 1 고정 리터럴).
- `app/web/src/score/gmMapping.ts`: `PIECE_TO_GM_NOTE: Readonly<Record<DrumPiece, number>>` + 역방향 `GM_NOTE_TO_PIECE`(REQ-02 "MIDI 내보내기" 및 향후 T2-1 MIDI 가져오기 양쪽에 필요 — 매핑 상수 자체의 자연스러운 양방향 용도, 범위 추가 아님). 값은 공식 General MIDI Level 1 Percussion Key Map으로 재확인(아래 "검증 근거").
- `app/web/src/score/validate.ts`: `validateDrumScore(data: unknown): { valid: boolean; errors: string[] }` — 구조·범위를 검사하고 예외를 던지지 않음(REQ-02 수용 기준: 부분 인식도 크래시 없이 진입). `isDrumScore(data): data is DrumScore` 타입가드는 이 결과를 재사용.
- `app/web/src/score/index.ts`: 재노출.

## GM 매핑 값 검증 근거
`intent/03-architecture-stack.md`가 예시로 든 값(kick=36, snare=38, hihat_closed=42, hihat_open=46, crash=49, ride=51, tom_high=50, tom_mid=47, tom_floor=43)을 Finale 공식 문서가 게재한 General MIDI Level 1 퍼커션 키맵(MMA 표준과 동일 넘버링, https://usermanuals.finalemusic.com/PrintMusic2010Mac/Content/General_MIDI_Percussion_Map_Table.htm)과 대조해 전부 일치 확인:
- 36=Bass Drum 1(kick), 38=Acoustic Snare, 42=Closed Hi Hat, 46=Open Hi Hat, 49=Crash Cymbal 1, 51=Ride Cymbal 1, 50=High Tom, 47=Low-Mid Tom(mid tom으로 채택), 43=High Floor Tom(floor tom으로 채택 — GM에는 Low Floor Tom(41)도 있으나 우리 분류는 플로어 탐 1종뿐이라 기존 설계값 43 유지).

## 바꿀 파일
```
app/web/src/score/types.ts        신규
app/web/src/score/gmMapping.ts    신규
app/web/src/score/validate.ts     신규
app/web/src/score/index.ts        신규
app/web/src/score/gmMapping.test.ts  신규
app/web/src/score/validate.test.ts   신규
```

## 테스트 계획
1. GM 매핑: 9종 전부 올바른 노트 번호로 매핑되는지, 역방향 매핑이 정방향과 정확히 대응하는지(양방향 1:1)
2. validate: 올바른 최소 DrumScore(노트 0개)가 valid
3. validate: 올바른 DrumScore(노트 여러 개, hand 포함)가 valid
4. validate: version이 1이 아니면 invalid
5. validate: meta.source가 허용된 값이 아니면 invalid
6. validate: ppq <= 0이면 invalid
7. validate: timeSignature가 길이 2 배열이 아니거나 값이 양의 정수가 아니면 invalid
8. validate: notes[].piece가 9종 밖이면 그 노트만 에러로 잡고(다른 올바른 노트는 영향 없음 확인), 전체 valid=false
9. validate: notes[].velocity가 0~127 범위 밖이면 invalid
10. validate: notes[].tick이 음수면 invalid
11. validate: hand 값이 허용 목록(R/L/RF/LF/null) 밖이면 invalid
12. validate: notes[].handSource가 hand가 null이 아닐 때만 의미 있음 — hand가 null인데 handSource가 있어도 에러로 보지 않음(사양에 handSource가 hand 없을 때 금지라는 규정은 없음, 과도한 제약 추가 안 함)
13. validate: 완전히 다른 구조(객체가 아님, notes가 배열이 아님 등)를 던져도 예외 없이 invalid 반환(크래시 방지, REQ-02 수용 기준)

## 가정
- `version`은 지금 1 하나뿐 — 향후 스키마가 바뀌면 버전 분기 필요(지금은 다루지 않음, 범위 밖).
- `hand`가 `user`로 지정된 값을 자동 추천이 덮어쓰지 않는 규칙(REQ-12)은 편집기 로직(Phase 2+)에서 다룰 내용이라 이번 타입/검증에는 "값이 유효한 열거값인지"만 확인하고 그 보존 규칙 자체는 구현하지 않음.
- `audioOffsetMs`는 음수도 허용(오디오가 MIDI보다 먼저 시작하는 경우를 표현할 수 있어야 함) — 유한한 숫자이기만 하면 됨.
