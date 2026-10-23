> 한 줄 요약: T2-1 — MIDI(.mid)/MusicXML(.musicxml/.mxl)/Guitar Pro(.gp~.gpx) 파일을 DrumScore로 변환. 두 형식 모두 같은 MIDI 변환 경로로 합류시켜 구현 하나로 처리.

# T2-1 계획

## 목표
`intent/05-todo.md` T2-1: "MIDI/MusicXML/GP → DrumScore 가져오기 (REQ-02 경로 C)".

## 근거
REQ-02 경로 C: 디지털 악보(MIDI/.mid, MusicXML/.musicxml·.mxl, Guitar Pro/.gp·.gp3~.gp5·.gpx) → 파서 → DrumScore. 수용 기준: 각 경로별 샘플 1개 이상으로 DrumScore 생성 성공, 생성 결과는 원본 보존 + 편집본 별도 저장(저장 로직은 Phase 2의 라이브러리 작업 T2-5 범위, 이번엔 "파일 바이트 → DrumScore" 변환 함수까지).

## 설계 — 핵심 결정: 두 경로를 하나의 MIDI 변환기로 합류
실제 실행으로 확인한 사실(기억 아님, CLAUDE.md 규칙2):
- **alphaTab(`@coderline/alphatab` 1.8.4, MPL-2.0, npm 레지스트리로 라이선스 재확인)**은 `importer.ScoreLoader.loadScoreFromBytes(bytes, settings)`로 MusicXML/.mxl/GP를 렌더링 없이 파싱해 `Score` 객체를 준다. 이 `Score`를 `midi.MidiFileGenerator`(+`midi.AlphaSynthMidiFileHandler`+`midi.MidiFile`)에 넣으면 **표준 MIDI 바이너리**(`MidiFile.toBinary()`)를 만들어낸다 — 즉 "악보 파싱"과 "틱·템포·타이·삼연음 계산"을 전부 alphaTab이 대신 해주고, 결과는 평범한 MIDI 바이트.
- 그 MIDI 바이트를 **@tonejs/midi(2.0.28, MIT)**로 다시 파싱하면 `.mid` 직접 가져오기와 **완전히 같은 자료구조**(`Midi.tracks[].notes[].midi/ticks/velocity`, `track.instrument.percussion`)가 나온다.
- 따라서 "MIDI 노트 이벤트 배열 → DrumScore" 변환 로직을 **한 번만** 만들고, MusicXML/GP 경로는 그 앞에 "alphaTab으로 파싱해 MIDI 바이트로 재수출"하는 단계만 추가하면 된다.

### 실제 검증(실행 결과, 기억에 의존한 추측 아님)
- `qa-evidence/T0-4/drum_test.musicxml`(Phase 0에서 만든 실제 드럼 샘플, kick/snare/closed-hihat)을 위 경로로 통과시킨 결과: 채널=9(percussion), 노트 `midi: 36(kick), 38(snare), 42(closed-hihat), 42`, ticks 0/960/1920/2400(ppq=960과 4분음표·8분음표 길이에 정확히 대응), tempo 120bpm, timeSignature [4,4] — **전부 올바르게 나옴**. `T1-5`의 `GM_NOTE_TO_PIECE`와 직접 호환.
- `qa-evidence/T0-3/out/IMG_7945.mxl`(Audiveris OMR이 실제로 만든 압축 MusicXML)도 `ScoreLoader.loadScoreFromBytes`로 예외 없이 파싱됨(트랙 1, 마디 5) — `.mxl` 압축 형식도 같은 API로 처리됨을 확인.
- `@tonejs/midi`의 `Instrument.percussion` getter는 실제로 `track.channel === 9`(GM 표준 퍼커션 채널)로 구현돼 있음(소스 코드 직접 확인) — 별도 채널 판별 로직을 내가 다시 만들 필요 없음.
- 두 파서 모두 손상된/임의 바이트를 넣으면 **예외를 던짐**(`Midi`: 알 수 없는 에러 객체, alphaTab: `EndOfReaderError`) — 실제 실행으로 확인. 가져오기 함수는 반드시 이 예외들을 잡아서 "실패"로 변환해야 함(REQ-02 "인식 실패 시에도 크래시 없이 진입").
- **GP(.gp/.gp3~.gp5/.gpx)는 실제 샘플 파일이 없어서 이번엔 실행으로 검증 못함** — 같은 `ScoreLoader.loadScoreFromBytes` API를 쓰므로(포맷 감지는 alphaTab 내부가 바이트로 판단) 동작할 것으로 예상하나, 확인 전까지는 "검증 안 됨"으로 분류(아래 "가정" 참고).

## 바꿀 파일
```
app/web/package.json(+@tonejs/midi, +@coderline/alphatab)
app/web/src/score/import/midiEvents.ts       신규 — 공유 변환기: Midi(파싱결과) → DrumScore
app/web/src/score/import/importMidi.ts       신규 — .mid 직접 가져오기
app/web/src/score/import/importNotation.ts   신규 — MusicXML/.mxl/GP → (alphaTab) → MIDI 바이트 → 공유 변환기
app/web/src/score/import/index.ts            신규 — importScoreFile(bytes, filename) 통합 진입점
app/web/src/score/import/*.test.ts           신규 — 단위 테스트
```

## 설계 세부
- `ImportResult = { ok: true; score: DrumScore; unmappedNoteCount: number; unmappedGmNotes: number[] } | { ok: false; error: string }` — 예외를 던지지 않음(T1-5 `validateDrumScore`와 같은 원칙).
- GM 노트 번호가 우리 9종 분류(`GM_NOTE_TO_PIECE`)에 없는 퍼커션 노트(예: 카우벨, 탬버린)는 **임의로 비슷한 분류에 끼워 맞추지 않고 건너뛰며 개수를 센다**(CLAUDE.md 규칙1 — 근거 없는 추측 금지). `unmappedNoteCount`/`unmappedGmNotes`로 호출자(향후 편집기 UI, T2-6)에 알려 "일부 노트를 인식하지 못함" 표시에 쓸 수 있게 함.
- 퍼커션 트랙 판별은 `track.instrument.percussion`(= `channel===9`) 기준. 채널9가 아닌 트랙은 무시(드럼 외 악기 트랙 — 예: GP의 베이스/기타 트랙).
- `meta.bpm`은 `header.tempos[0]?.bpm ?? 120`, `meta.timeSignature`는 `header.timeSignatures[0]?.timeSignature as [number,number] ?? [4,4]` — 템포/박자 이벤트가 없는 파일 대비 fallback.
- `audioOffsetMs`는 0으로 고정(디지털 악보는 오디오 트랙이 없으므로 오프셋 개념 자체가 無의미 — REQ-02 경로 C는 음원과 무관).
- velocity는 @tonejs/midi가 0~1 정규화값을 주므로 `Math.round(v*127)`로 역변환.
- 결과는 `validateDrumScore`(T1-5)로 자체 검증까지 통과하는지 테스트로 확인(가져오기 로직이 스키마를 어기지 않는지 교차 검증).

## 테스트 계획
1. `.mid`: @tonejs/midi로 직접 만든 간단한 MIDI(채널9, kick/snare 2노트)를 바이트로 인코딩 → `importMidiBuffer`로 가져와 올바른 DrumScore 생성
2. `.mid`: 퍼커션 아님(채널0) 트랙은 무시됨
3. `.mid`: GM_NOTE_TO_PIECE에 없는 노트(예: 카우벨=56)는 건너뛰고 `unmappedNoteCount`에 집계
4. `.mid`: 손상된 바이트 → `{ok:false}` 반환, 예외 없음
5. MusicXML: `qa-evidence/T0-4/drum_test.musicxml`(실제 샘플)로 올바른 DrumScore 생성(kick/snare/hihat_closed 전부)
6. `.mxl`: `qa-evidence/T0-3/out/IMG_7945.mxl`(실제 OMR 샘플)로 예외 없이 처리됨(퍼커션 노트가 전혀 없을 수도 있어 "크래시 안 함"만 확인, 내용 정확성은 OMR 품질 문제라 이번 범위 아님)
7. 손상된 MusicXML 바이트 → `{ok:false}`, 예외 없음
8. `importScoreFile`: 확장자로 .mid vs .musicxml/.mxl/.gp* 올바르게 분기
9. `importScoreFile`: 지원 안 하는 확장자(.txt 등) → `{ok:false}`
10. 생성된 DrumScore가 `validateDrumScore`를 통과(스키마 자체 검증과 교차 확인)

## 가정
- GP(.gp/.gp3~.gp5/.gpx) 실제 파일 검증은 못함 — `intent/07-open-questions.md`에 등록(실제 GP 샘플 구해서 재검증 필요).
- 파일을 "선택/업로드"하는 UI(파일 input, 드래그앤드롭)는 라이브러리 화면(T2-5) 범위 — 이번엔 바이트 배열을 받아 DrumScore를 반환하는 순수 함수까지만.
- 가져온 DrumScore를 실제로 DB/파일에 저장하는 것(원본 보존 + 편집본 별도)은 서버 쪽 Asset 저장 로직과 맞물리는 Phase 2 후반 작업 — 이번 범위 아님.
