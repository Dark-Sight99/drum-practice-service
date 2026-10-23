> 한 줄 요약: T1-5 QA — tsc/oxlint/vitest 전부 통과(20개 테스트: GM 매핑 9종 양방향 + DrumScore 검증 15개, Codex 모드A 회귀 2개 포함). prettier는 T1-1 때부터 있던 기존 파일 6개에서만 경고(이번 변경과 무관, 범위 밖).

# T1-5 QA 결과(2026-10-23)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npx tsc -b` | PASS |
| lint | `npx oxlint` | PASS |
| 포맷(새 파일만) | `npx prettier --check src/score` | PASS |
| 포맷(전체) | `npx prettier --check src` | 기존 6개 파일에서 경고(App.tsx 등, T1-1부터 있던 것 — 이번 변경 파일 아님, 수정 안 함) |
| test | `npx vitest run` | PASS (20/20, Codex 모드A 회귀 테스트 2개 포함) |

전체 로그: `raw_log.txt`

## 테스트와 REQ-02/설계 대응
| 테스트 파일 | 확인하는 것 |
|---|---|
| `gmMapping.test.ts` | 9종 전부 GM 노트 번호 매핑, 공식 General MIDI Level 1 퍼커션 키맵과 일치(수치 하나하나 대조), 역방향 매핑이 정방향과 정확히 1:1 대응 |
| `validate.test.ts` | 최소/정상 DrumScore accept, version·meta.source·ppq·timeSignature·velocity·tick·hand 각각의 범위 밖 값 reject, **부분 인식**(노트 하나만 잘못돼도 나머지는 영향 없이 그 노트만 에러로 잡힘 — REQ-02 "인식 실패/부분 인식 시에도 크래시 없이 '인식된 부분 + 편집 필요' 상태로 진입"), 완전히 잘못된 입력(null/문자열/숫자/notes가 배열이 아님)에도 예외 없이 invalid 반환 |

## 수용 기준(REQ-02) 충족 여부 — 이번 작업 범위
- [x] DrumScore 타입이 REQ-02 최소 분류 9종(킥·스네어·하이햇 닫힘/열림·탐 하이/미드/플로어·크래시·라이드)을 전부 표현
- [x] GM 타악기 번호 매핑 — 공식 표로 재확인(아래 "GM 매핑 검증" 참고), MIDI 내보내기에 쓸 수 있음
- [x] 검증 함수가 예외 없이 동작 — 부분 인식 시에도 크래시 안 남(테스트로 증명)
- 경로 A/B/C의 실제 생성 로직(ADT/OMR/파서)은 Phase 2~4 범위, 이번엔 다루지 않음(`work/T1-5/plan.md` §범위)

## GM 매핑 검증(공식 표 대조)
`intent/03-architecture-stack.md` §2가 예시로 든 값을 Finale 공식 문서가 게재한 General MIDI Level 1 퍼커션 키맵(MMA 표준과 동일 넘버링)과 대조:
출처: https://usermanuals.finalemusic.com/PrintMusic2010Mac/Content/General_MIDI_Percussion_Map_Table.htm (WebFetch로 확인, 2026-10-23)

| DrumPiece | 채택 노트 | GM 공식 명칭 | 일치 |
|---|---|---|---|
| kick | 36 | Bass Drum 1 | ✓ |
| snare | 38 | Acoustic Snare | ✓ |
| hihat_closed | 42 | Closed Hi Hat | ✓ |
| hihat_open | 46 | Open Hi Hat | ✓ |
| tom_high | 50 | High Tom | ✓ |
| tom_mid | 47 | Low-Mid Tom | ✓(GM엔 Hi-Mid Tom(48)도 있으나 분류가 1종뿐이라 기존 설계값 47 유지) |
| tom_floor | 43 | High Floor Tom | ✓(GM엔 Low Floor Tom(41)도 있으나 분류가 1종뿐이라 기존 설계값 43 유지) |
| crash | 49 | Crash Cymbal 1 | ✓ |
| ride | 51 | Ride Cymbal 1 | ✓ |

전부 일치 확인 — `intent/03-architecture-stack.md`의 "구현 시 공식 표로 재확인" 요구사항 충족.

## 가정
- 서버(Python) 쪽 동일 타입은 만들지 않음 — DrumScore를 실제로 생성하는 Python 코드(ADT/OMR)는 Phase 3/4 범위(`work/T1-5/plan.md` §범위 참고).

## Codex 모드A 검수 반영
원문: `codex-modeA.md`. 판정: REQUEST_CHANGES.

- **C-001**(필수, `validate.ts:96`): `data.notes`가 배열이어도 그 원소의 필드 접근(예: getter)이 예외를 던지면 `validateDrumScore` 자체가 그대로 예외를 던진다는 지적 — **재현됨**(마스터가 직접 확인). `piece` 접근 시 예외를 던지는 getter를 가진 객체를 `notes`에 넣고 `validateDrumScore`를 호출한 결과, 수정 전 코드는 그 예외가 그대로 전파됨("예외 발생(재현됨): 악의적 getter가 터짐"). **자동 수정함**: 필드 검사 로직(`runChecks`)을 통째로 `try/catch`로 감싸 어떤 예외가 나도 `{valid:false, errors:[...]}`로 변환해 반환하도록 수정. 회귀 테스트 `does not crash when a note field throws on access` 추가. "검증 함수는 절대 예외를 던지지 않는다"는 REQ-02 수용 기준을 입력 형태와 무관하게 지키는 국소 수정이라 설계 변경 없이 바로 고침.
- **C-002**(권장): `tick`이 정수인지 확인하지 않아 소수 틱도 허용된다는 지적 — 수용 기준에 명시된 요구는 아니지만, `ppq`(틱당 분해도) 기반 정수 틱이 스키마 의도에 맞아 타당 → **자동 수정함**: `Number.isFinite` → `Number.isInteger`로 변경, 회귀 테스트 `rejects a non-integer tick` 추가.
