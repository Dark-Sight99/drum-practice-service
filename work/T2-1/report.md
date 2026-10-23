> 한 줄 요약: MIDI/MusicXML/GP → DrumScore 가져오기 구현. alphaTab으로 악보를 파싱해 표준 MIDI로 재수출한 뒤 .mid 직접 가져오기와 같은 변환기로 합류시키는 단일 경로. 세 경로 전부 실제 바이트(MIDI/MusicXML/GP7)로 검증, 테스트 13개.

# T2-1 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/package.json` | `@tonejs/midi`(MIT), `@coderline/alphatab`(MPL-2.0) 추가 | REQ-02 경로 C, 라이선스는 npm 레지스트리로 확인(둘 다 비카피레프트, `intent/03-architecture-stack.md` §4 갱신) |
| `app/web/src/score/import/midiEvents.ts` | `midiToDrumScore(midi, source, title)` — @tonejs/midi `Midi` 인스턴스를 DrumScore로 변환하는 공유 로직 | REQ-02, `work/T2-1/plan.md` §설계 |
| `app/web/src/score/import/importMidi.ts` | `importMidiBuffer` — .mid 직접 가져오기 | REQ-02 경로 C(MIDI) |
| `app/web/src/score/import/importNotation.ts` | `importNotationBytes` — MusicXML/.mxl/GP → alphaTab → MIDI 바이너리 → 공유 변환기 | REQ-02 경로 C(MusicXML, GP) |
| `app/web/src/score/import/index.ts` | `importScoreFile(bytes, filename)` — 확장자로 포맷 판별해 라우팅하는 통합 진입점 | REQ-02 경로 C |
| `app/web/src/score/index.ts` | import 모듈 재노출 | — |
| `app/web/tsconfig.app.json` | `types`에 `"node"` 추가 | 테스트가 `node:fs`로 실제 샘플 파일을 읽어야 함(Vitest는 항상 Node에서 실행) |
| `app/web/src/score/import/*.test.ts` | 테스트 13개(Codex 모드A 회귀 1개 포함) | `work/T2-1/plan.md` 테스트계획 + Codex 모드A C-001 |

## 핵심 설계 결정: 두 경로를 하나의 MIDI 변환기로 합류
실제 실행으로 확인(기억 아님, CLAUDE.md 규칙2): alphaTab의 `importer.ScoreLoader.loadScoreFromBytes`로 MusicXML/.mxl/GP를 렌더링 없이 파싱해 `Score`를 얻고, 그 `Score`를 alphaTab 자신의 `midi.MidiFileGenerator`+`midi.AlphaSynthMidiFileHandler`로 표준 MIDI 바이너리(`MidiFile.toBinary()`)로 재수출하면, 그 바이트를 `@tonejs/midi`로 다시 파싱했을 때 `.mid` 직접 가져오기와 **완전히 같은 자료구조**가 나온다. 틱·템포·타이·삼연음 계산을 alphaTab에 전부 맡기고, "MIDI 노트 이벤트 → DrumScore" 변환 로직(`midiToDrumScore`)은 한 곳만 유지함. 상세 근거·검증 로그는 `work/T2-1/plan.md` §설계.

## 구현 근거 (실행 결과로 확인)
- `qa-evidence/T0-4/drum_test.musicxml`(Phase 0 실제 드럼 샘플)을 전체 경로로 통과시킨 결과: 채널9(퍼커션), 노트 36/38/42/42(kick/snare/hihat_closed×2), ppq=960, tempo=120, timeSignature=[4,4] — 전부 올바름. `T1-5`의 `GM_NOTE_TO_PIECE`와 직접 호환 확인.
- `qa-evidence/T0-3/out/IMG_7945.mxl`(Audiveris 실제 OMR 출력, 압축 MusicXML)도 같은 API로 예외 없이 파싱됨 — `.mxl` 압축 형식 지원 확인.
- `@tonejs/midi`의 `Instrument.percussion`이 실제로 `track.channel===9`(GM 표준)로 구현된 것을 소스 코드로 직접 확인 — 별도 채널 판별 로직 불필요.
- 두 파서(`Midi`, alphaTab `ScoreLoader`) 모두 손상 바이트에 실제로 예외를 던지는 것을 확인 → `importMidiBuffer`/`importNotationBytes` 둘 다 try/catch로 감싸 `{ok:false}` 반환(크래시 없음).
- 9종 분류 밖 GM 퍼커션 노트(카우벨=56, 탬버린=54 등)는 임의로 비슷한 분류에 끼워 맞추지 않고 건너뛰며 `unmappedNoteCount`/`unmappedGmNotes`로 집계(CLAUDE.md 규칙1 — 근거 없는 추측 금지).

## 실행한 검증
`qa-evidence/T2-1/result.md`, `raw_log.txt` — tsc/oxlint/vitest(33/33) PASS. prettier는 이번 변경 파일 전부 PASS(전체 `src` 기준 T1-1 때부터 있던 기존 경고 6개는 무관, 범위 밖).

## 가정
- GP는 사람이 실제 Guitar Pro 앱으로 만든 샘플은 아직 미검증(`intent/07-open-questions.md` Q-18, 부분 해소) — 대신 alphaTab 자신의 `Gp7Exporter`로 만든 진짜 GP7 바이너리로 메커니즘 자체는 검증함(아래 "Codex 모드A 검수 반영" 참고).
- 파일 선택 UI(input/드래그앤드롭)와 가져온 결과의 서버 저장(원본 보존+편집본)은 Phase 2 후반(T2-5, 라이브러리 화면) 범위 — 이번엔 순수 변환 함수까지.
- `audioOffsetMs`는 0으로 고정(디지털 악보 경로는 오디오 트랙이 없어 오프셋 개념이 무의미).

## 질문
- 없음.

## 남은 문제
- GP를 사람이 실제로 만든 파일로 재검증 필요(Q-18) — 의뢰인이 GP 파일(특히 .gp3~.gp5)을 갖고 있으면 제공받아 검증.
- 가져온 DrumScore를 라이브러리 화면에서 실제로 업로드·저장하는 흐름은 T2-5.

## Codex 모드 A 검수 반영 (2026-10-23)
판정: REQUEST_CHANGES. 원문: `qa-evidence/T2-1/codex-modeA.md`.

- **C-001**(필수): REQ-02 수용 기준 "각 경로별 샘플 1개 이상으로 DrumScore 생성 성공"에서 GP 경로는 손상 바이트로 "크래시 안 함"만 테스트했을 뿐 성공 샘플이 없다는 지적 — 지적 그대로 사실이라 **재현됨**. **수정함**: 실제 GP 샘플이 없어, 검증된 `qa-evidence/T0-4/drum_test.musicxml`을 alphaTab 자신의 `exporter.Gp7Exporter`로 실제 Guitar Pro 7+ 바이너리(`qa-evidence/T2-1/drum_test_roundtrip.gp`)로 내보낸 뒤 우리 가져오기 경로로 재파싱해 kick/snare/hihat_closed×2가 정확히 복원됨을 테스트로 확인. "사람이 만든 파일은 아님"이라는 한계는 `intent/07-open-questions.md` Q-18에 명시(완전 해소 아닌 부분 해소로 갱신).
