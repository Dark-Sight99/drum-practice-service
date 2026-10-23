> 한 줄 요약: T2-1 QA — tsc/oxlint/vitest 전부 통과(33/33: 기존 20개 + 신규 13개). MIDI/MusicXML/GP(실제 바이너리) 세 경로 전부 실제 샘플로 올바른 DrumScore 생성 확인, 손상 입력도 크래시 없이 처리.

# T2-1 QA 결과(2026-10-23)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npx tsc -b` | PASS(`tsconfig.app.json`에 `"node"` 타입 추가 — 테스트 파일의 `node:fs`/`import.meta.dirname` 사용 때문) |
| lint | `npx oxlint` | PASS |
| 포맷 | `npx prettier --check src` | 기존 6개 파일(T1-1, 이번 작업과 무관) 경고, 이번 변경 파일은 전부 PASS |
| test | `npx vitest run` | PASS (33/33, T2-1 신규 13개 — Codex 모드A 반영으로 GP 성공 샘플 테스트 1개 추가) |

전체 로그: `raw_log.txt`

## 신규 테스트와 REQ-02(경로 C) 수용 기준 대응
| 테스트 파일 | 확인하는 것 |
|---|---|
| `importMidi.test.ts`(5개) | 퍼커션 채널(9) 노트→DrumScore 변환, 비퍼커션 채널 무시, 9종 밖 GM 노트(카우벨 등) 스킵+집계, 손상 바이트도 크래시 없이 `{ok:false}`, 템포/박자 이벤트 없을 때 120bpm/4·4 기본값 |
| `importNotation.test.ts`(3개) | **`qa-evidence/T0-4/drum_test.musicxml`(Phase 0 실제 드럼 샘플)**로 kick/snare/hihat_closed·closed 4노트 정확히 생성 + `validateDrumScore` 통과, **`qa-evidence/T0-3/out/IMG_7945.mxl`(Audiveris 실제 OMR 출력)**로 크래시 없이 처리, 손상 바이트도 `{ok:false}` |
| `index.test.ts`(5개) | 확장자별 라우팅(.mid→MIDI 경로, .musicxml→악보 경로, .gp5→악보 경로), **GP7 실제 바이너리로 kick/snare/hihat_closed×2 정확히 생성**(Codex 모드A C-001 반영), 손상된 .gp5 입력도 크래시 없이 실패, 미지원 확장자 거부 |

## 수용 기준(REQ-02 경로 C) 충족 여부
- [x] 각 경로별 샘플 1개 이상으로 DrumScore 생성 성공 — **MIDI**: 직접 구성한 테스트 MIDI로 확인. **MusicXML**: `qa-evidence/T0-4/drum_test.musicxml`(실제 샘플)로 확인. **GP**: alphaTab의 `Gp7Exporter`로 그 MusicXML 샘플을 실제 Guitar Pro 7+ 바이너리로 내보낸 `qa-evidence/T2-1/drum_test_roundtrip.gp`로 확인(Codex 모드A C-001 지적으로 보강, 아래 "Codex 모드A 검수 반영" 참고) — 단, 사람이 실제 GP 앱으로 만든 파일은 아직 미검증(Q-18)
- [x] 인식 실패/부분 인식 시에도 크래시 없이 처리 — 손상된 MIDI/MusicXML 바이트 둘 다 예외 없이 `{ok:false}` 반환(테스트로 증명). 9종 분류 밖 GM 퍼커션 노트도 임의로 끼워 맞추지 않고 건너뛰며 집계(`unmappedNoteCount`)
- [ ] 생성 결과는 원본 보존 + 편집본 별도 저장 — 이번 범위 아님(`work/T2-1/plan.md` §가정, 저장 로직은 Phase 2 후반/T2-5와 맞물림)

## 실제 샘플 검증(기억이 아닌 실행 결과)
`qa-evidence/T0-4/drum_test.musicxml`을 alphaTab(`ScoreLoader.loadScoreFromBytes`) → `MidiFileGenerator`+`AlphaSynthMidiFileHandler` → `MidiFile.toBinary()` → `@tonejs/midi`로 재파싱하는 전체 경로를 실제로 돌린 결과:
- 채널 9(퍼커션) 확인, 노트 `36(kick)→38(snare)→42(hihat_closed)→42(hihat_closed)` 정확히 추출
- ppq=960, tempo=120bpm, timeSignature=[4,4] — 전부 올바름
- `qa-evidence/T0-3/out/IMG_7945.mxl`(압축 MusicXML, Audiveris 실제 출력)도 같은 API로 예외 없이 파싱됨(트랙 1, 마디 5)

## Codex 모드A 검수 반영
원문: `codex-modeA.md`. 판정: REQUEST_CHANGES.

- **C-001**(필수): REQ-02 수용 기준이 "각 경로별 샘플 1개 이상으로 DrumScore 생성 성공"인데, GP 경로는 손상 바이트로 "크래시 안 함"만 테스트했을 뿐 성공 샘플이 없다는 지적 — **재현됨**(지적 그대로 사실). **자동 수정함**: 실제 GP 샘플 파일이 없어, 이미 검증된 `qa-evidence/T0-4/drum_test.musicxml`을 alphaTab 자신의 `exporter.Gp7Exporter`로 실제 Guitar Pro 7+ 바이너리(`qa-evidence/T2-1/drum_test_roundtrip.gp`, 2701바이트)로 내보낸 뒤 우리 가져오기 경로로 재파싱 — kick/snare/hihat_closed×2가 정확히 복원됨을 테스트로 확인(`index.test.ts`). 다만 이건 "사람이 실제 Guitar Pro 앱으로 만든 파일"이 아니라 "우리가 만든 진짜 GP7 바이너리"라는 점은 `intent/07-open-questions.md` Q-18에 명시해둠(완전 해소 아님, 부분 해소).

## 가정/한계
- GP는 이제 실제 GP7 바이너리로 메커니즘 자체는 검증됐으나, 사람이 실제 Guitar Pro 앱(특히 오래된 .gp3~.gp5 버전)으로 만든 파일은 아직 테스트 못함(`intent/07-open-questions.md` Q-18, 부분 해소로 갱신).
- `@tonejs/midi`가 CommonJS 모듈이라 Node 플레인 스크립트에서는 default-import 구조분해가 필요했으나(검증 스크립트에서 확인), Vite/Vitest 번들러 환경에서는 named import(`import { Midi } from '@tonejs/midi'`)가 문제없이 동작함(실제 테스트 통과로 확인).
- `tsconfig.app.json`에 `"node"` 타입을 추가함 — 테스트 파일이 `node:fs`로 실제 샘플 파일을 읽기 위함(Vitest 테스트는 항상 Node에서 실행되므로 정상적인 패턴). 런타임 동작에는 영향 없음(타입체크 범위만 넓어짐).
