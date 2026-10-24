> 한 줄 요약: Phase 2 게이트 실사용 피드백에서 보고된 음원-화면 동기화 버그(카운트인 오프셋 누락)를 코드로 재현해 수정 — "오디오 타이밍·동기"는 위험 작업이라 Codex 모드C 3회(카운트인 오프셋 → audioOffsetMs 비대칭 → 그 수정의 루프 경계 부작용)를 거쳐 검증 단계에서 audioOffsetMs를 0으로 강제하는 데까지 이어짐. 연습 화면 R/L 즉석 자동계산도 함께 구현.

# T2-8 보고 — Phase 2 게이트 피드백 수정

## 배경
의뢰인이 실제 MIDI 곡으로 연습 화면을 써보고 보고한 4가지 문제 중 3가지(노트 지나간 뒤 소리남, 소리만 들릴 때 있음, 초반 5초 안 맞음)가 **같은 근본 원인**(카운트인 오프셋 누락)이었고, 1가지(R/L 표시 토글 무반응)는 버그가 아니라 데이터 문제였음을 코드 조사로 확인한 뒤 진행.

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/src/render/laneRenderer.ts` | `render()`에 `songStartSeconds` 파라미터 추가, `noteTimeOf`에 반영 | 동기화 버그 수정 |
| `app/web/src/audio/scorePlayer.ts` | 노트 스케줄 식에 `audioOffsetMs` 추가(렌더러와 대칭화) | Codex 모드C 1차 C-001 |
| `app/web/src/score/validate.ts` | `audioOffsetMs` 검증을 "유한"→"정확히 0"으로 강화 | Codex 모드C 3차 C-001 |
| `app/web/src/score/validate.test.ts` | 테스트 2개 추가 | — |
| `app/server/api/schemas.py` | `DrumScoreIn.audioOffsetMs` 검증 동일하게 강화 | 위와 동일(백엔드 대칭) |
| `app/server/tests/test_songs_upload_api.py`, `test_songs_editor_api.py` | 테스트 2개 추가 | — |
| `app/web/src/features/practice/PracticeCanvas.tsx` | `songStartSeconds` 계산을 렌더러 호출 앞으로 이동(진행바 계산과 공유), `recommendSticking()`으로 R/L 즉석 계산해 표시 전용 `displayScore` 구성 | 동기화 버그 + REQ-12 피드백 |

## 위험 작업 여부 판단
`intent/06-pipeline.md` §1-1에 **"오디오 타이밍·동기"가 명시**돼 있어 동기화 버그 수정은 위험 작업 — 구현 전 Codex 모드C 3회(아래) 거침. R/L 즉석 계산은 순수 표시 로직 추가라 위험 작업 아님.

## Codex 모드C(설계 검수) — 3회(최대)
**1회차: needs-attention(C-001, high).** 카운트인 오프셋 누락 진단은 맞지만, `laneRenderer.ts`가 반영하는 `audioOffsetMs`를 `scorePlayer.ts`는 전혀 반영하지 않아 비영점 값에서 동기가 계속 어긋난다는 지적 — 현재는 `score/import/midiEvents.ts`가 항상 0으로 생성해 실질 영향 없지만 Phase 3(T3-5)에서 실제 쓰일 필드.
→ `scorePlayer.ts`에도 `audioOffsetMs`를 더해 대칭화.

**2회차: needs-attention(C-001→C-002로 재명명, high).** 그 대칭화가 노트를 A-B 루프 경계 너머로 밀어낼 수 있다는 새 지적 — 1차 대응이 낳은 부작용. "현재 설정 경로가 없다(import·편집 UI 둘 다 0만 만듦)"는 이유로 설계를 보류하고 Q-23으로 등록.
→ Q-23 등록, 루프+오프셋 상호작용 설계는 Phase 3(T3-5가 UI·허용범위를 정의한 뒤)로 명시적 이연.

**3회차(최대 횟수): needs-attention(C-001, high).** 2차의 보류 근거가 틀렸다는 지적 — `validate.ts`·`api/schemas.py`는 "유한하기만 하면 통과"였어서, UI가 없어도 **API에 직접 JSON을 올리는 경로**(업로드·편집기 저장 둘 다)로 비영점 값이 들어올 수 있었음. "지금은 발생 안 한다"는 판단이 UI 부재만 확인하고 API 자체의 방어를 확인하지 않은 실수였음을 인정.
→ `06-pipeline.md` §1-1 "재검수 최대 3회" 규칙에 따라 Codex 재호출 없이, Codex가 Recommendation에서 제시한 해법("검증 단계에서 0만 허용")을 그대로 구현 — `validate.ts`·`api/schemas.py` 둘 다 `audioOffsetMs`를 정확히 0으로 강제(Phase 3 전까지 임시 제한). 업로드·편집기저장·프론트 검증 세 경로 모두 거부 테스트 추가.

원문: `qa-evidence/T2-8/codex-modeC.md`, `-3.md`(2차는 1차 안에 통합 서술)

## Codex 모드A(독립 코드 검수) — 반박(재현 안 됨)
판정: P1 1건("A-B 루프 진행바가 카운트인 오프셋을 반영 안 한다") — **실제 실행으로 검증한 결과 틀린 지적**. `loopStartSeconds`/`loopEndSeconds` 계산은 이번 커밋 이전부터 이미 `songStartSeconds`를 포함하고 있었고(이번엔 그 변수 선언 위치만 위로 옮김), 디버그 계측으로 실측(`positionSeconds≈5.79s`일 때 `rawPercent≈47.36%`, 화면 진행바 폭도 정확히 `47%`)해 정확함을 확인 — 코드 수정 없이 기각. T2-4에서 Codex 지적을 검증 후 반박했던 선례와 같은 패턴(`qa-evidence/T2-8/codex-modeA.md`).

원문: `qa-evidence/T2-8/codex-modeA.md`

## 구현 근거 (실행 결과로 확인)
- **근본 원인 특정**: `scorePlayer.ts`의 노트 스케줄 식(`schedule.songStartSeconds + ticksToSeconds(...)`)과 `laneRenderer.ts`의 `noteTimeOf`(수정 전: `ticksToSeconds(...) + audioOffsetMs/1000`)를 나란히 놓고 비교해 `songStartSeconds` 누락을 코드로 직접 확인(실행 로그가 아니라 코드 대조 자체가 증거 — 이 종류의 버그는 Canvas/Tone.js라 jsdom 단위 테스트로 재현 불가, work/T2-2·T2-3부터 이어진 제약).
- **120bpm 4/4 1마디 = 2초**라는 구체적 수치로 "노트가 몇 초 일찍 보이는지" 계산 가능했고, 의뢰인이 보고한 "완전히 지나간 뒤 들림"(미세한 ms 단위가 아니라 뚜렷하게 체감되는 지연)이라는 증상 크기와 정확히 들어맞음 — 추측이 아니라 수치로 맞춰본 진단.
- **R/L 즉석 계산이 재생 로직에 영향 없음**: `playDrumScore()`가 `note.hand`/`note.handSource`를 전혀 읽지 않음을 코드로 확인 후, `displayScore`(표시 전용 사본)만 만들고 원본 `score`는 그대로 재생에 사용 — 저장도 하지 않아(연습 화면은 읽기 전용) REQ-12의 기존 "편집기에서 지정→저장" 흐름과 충돌 없음.
- **의뢰인 질문("R/L 자동계산이 정확한 정보를 줄 수 있냐")에 대한 답을 코드로 뒷받침**: `score/sticking.ts`의 규칙이 "오른손잡이 기본" 휴리스틱일 뿐 전문 검증 안 됐음을 재확인(Q-11) — 자동 계산 값은 반투명(50%)으로 표시돼 "추천"임을 구분하지만, 의뢰인이 "확신 없다"고 명시했으므로 보고 메시지에서 이 한계를 별도로 설명(아래 "실행한 검증" 뒤 사용자 안내 참고).

## 실행한 검증
`qa-evidence/T2-8/result.md`, `raw_log.txt` — 프론트 tsc/oxlint/vitest(131/131), 백엔드 ruff/pytest(81/81) 전부 PASS. 실제 FastAPI 서버+브라우저로 R/L 즉석 표시, 동기화 수정(카운트인 종료 시점과 첫 노트의 판정선 도달 시점 일치, 일반 재생·A-B 루프 양쪽)을 스크린샷으로 확인.
