> 한 줄 요약: T3-72(다운비트 자동 보정) QA 증거 — 단위 테스트 전부 통과(백엔드 238·프런트 332), 실제 song 9 데이터로 재앵커 로직 검증 완료. 단, 실제 재채보를 통한 "실기기 재생/청취" 검증은 백엔드 프로세스 재시작이 필요해 보류 중.

# T3-72 QA 증거

## 1. 백엔드 단위 테스트

명령: `& ".venv\Scripts\python.exe" -m pytest -q` (app/server)

결과: **238 passed**

- `tests/test_tempo.py`: `estimate_downbeat_offset_seconds()` 신규 테스트 7개 — 정상 위상 복원, 경계(0 근접) 위상에서 순환평균이 산술평균(오답, 약 0.594)과 다르게 올바른 값(약 0.99, 오차 0.03 이내)을 내는지, 분산된 위상→0.0 폴백, 비트 4개 미만→0.0, librosa 디코드 실패→0.0, bpm이 0/음수/NaN/Inf일 때 0.0, 반환값이 항상 `[0, period)` 범위인지.
- `tests/test_midi_to_drumscore.py`: `downbeat_offset_seconds` 파라미터로 틱이 재앵커되는지(5개 신규 테스트) — tick 0 재설정, 모든 노트가 동일한 양만큼 이동, 오프셋보다 이른 노트는 tick 0으로 clamp, `audioOffsetMs`에 오프셋(ms)이 저장되는지, 기본값 0일 때 기존 동작과 동일한지.
- `tests/test_transcribe_handler.py`: `handler.py`가 `estimate_downbeat_offset_seconds()`를 호출해 `midi_to_drumscore()`에 전달하는 배선 검증.
- `tests/test_songs_upload_api.py`: `DrumScoreIn` 검증 — `audioOffsetMs`가 한 박 길이 이상이면 거부, 음수면 거부, 범위 내(280ms)면 201 허용.

## 2. 프런트엔드

명령: `npx tsc -b` / `npx oxlint` / `npx vitest run` (app/web)

결과:
- `tsc -b`: 에러 없음.
- `oxlint`: 기존부터 있던 무관한 경고 4개만(Drawer.tsx 1개, PracticeCanvas.tsx exhaustive-deps 3개) — 이번 변경과 무관.
- `vitest run`: **332 passed** (25 test files)
  - `src/audio/timing.test.ts`: `audioTrackPositionSeconds()` 4번째 인자(오프셋) 관련 6개 신규 테스트 — 기본값 0이면 기존 동작과 동일, 곡 시작 위치=오프셋, 루프 재진입 시에도 오프셋 적용, 결과가 항상 ≥0임을 직접 증명하는 테스트 포함.
  - `src/score/validate.test.ts`: `audioOffsetMs` 범위 검증(음수 거부, 한 박 이내 허용) 테스트.
  - `src/features/editor/EditorScreen.test.tsx`: `audioOffsetMs`가 0이 아니어도 음원 트랙을 더 이상 막지 않는지 확인(기존 "신스 드럼만 재생" 안내문이 사라지고 "원곡 음원을 불러오는 중…" 상태로 진입하는지로 검증 — jsdom 환경 특성상 실제 로드 완료까지는 재현 불가하나, `canUseAudioTracks` 게이트가 통과한다는 사실 자체는 이 상태 전환으로 증명됨).

## 3. 실제 데이터(song id=9, Pretender) 기반 재앵커 로직 검증

**실제 백엔드 프로세스(uvicorn/worker)를 건드리지 않고**, 기존에 저장된 `data/songs/9/drumscore.json`의 틱을 역산해 각 노트의 원래 `note.start`(초)를 복원한 뒤, 새로 구현한 `estimate_downbeat_offset_seconds()`를 그 드럼 스템(`stem_drums.wav`)에 직접 돌려 새 틱을 재계산하는 스크립트로 검증(같은 오디오·같은 모델이면 `note.start`는 바뀌지 않으므로, 모델을 재실행하지 않고도 재앵커 수식 자체를 실데이터로 검증 가능).

```
bpm=92.0 ppq=220 t0(estimated)=0.2818s (282ms)
offset in ticks = 95

piece         old_tick  new_tick   delta
kick              3606      3511      95
hihat_closed      3606      3511      95
crash             3606      3511      95
hihat_closed      3718      3623      95
hihat_closed      3775      3680      95
snare             3829      3734      95
hihat_closed      3829      3734      95
hihat_closed      3944      3849      95
hihat_closed      3990      3895      95
kick              3994      3899      95
(first 10 of 1809 notes shown)

delta is constant=True (all non-clamped notes shift by exactly offset_ticks=95)
notes that would clamp to tick 0 (old_tick < offset_ticks): 0 / 1809
```

- `t0=0.2818s`(282ms)는 세션 초반 독립적으로 측정했던 "평균 오프셋 +0.2789s(표준편차 0.0356s)"와 오차 3ms 이내로 일치 — 같은 버그를 같은 방향·비슷한 크기로 다시 잡아낸 것으로, 새 로직이 올바르게 동작함을 뒷받침.
- 1809개 노트 전부가 정확히 95틱(=282ms 상당)만큼 균일하게 이동 — 설계(§1 재앵커)대로 "전체 노트가 조금씩 밀려있는" 현상이 상수 오프셋 하나로 교정됨을 확인.
- clamp(음수 틱→0) 대상 0건 — 이 곡에는 다운비트 이전 노트가 없어 clamp 분기는 실데이터로는 미검증(단, `test_midi_to_drumscore.py`의 합성 데이터 단위 테스트로는 검증됨).

## 4. 미검증 항목 (실기기/실브라우저 end-to-end)

아래 항목은 **실제 재채보(업로드 파이프라인 재실행)와 브라우저 재생**이 필요해 아직 수행하지 못했다. 이유: 현재 실행 중인 백엔드 서버(uvicorn --reload)와 워커(worker.runner) 프로세스를 재시작해야 새 코드로 재채보할 수 있는데, Claude Code 권한 시스템이 실행 중인 프로세스 강제 종료(`Stop-Process -Force`)를 **"Interfere With Workloads"**로 분류해 거부했다. 지어내지 않고 솔직히 "미확인"으로 남긴다(CLAUDE.md 1조).

- [ ] 실제 신규 업로드(또는 song 9 재채보)로 `audioOffsetMs≠0`인 DrumScore가 실제로 생성되는지
- [ ] 편집기/연습 화면에서 `audioOffsetMs≠0`일 때 음원 트랙(분리 스템) 재생이 더 이상 막히지 않는지(신스 폴백이 아니라 실제 음원이 나오는지)
- [ ] A-B 루프 재진입 시 오프셋이 적용된 위치로 올바르게 seek되는지(끊김/중복 없음)
- [ ] **가장 중요**: 음원 트랙 재생이 실제 파일의 처음 `t0`초(다운비트 이전 구간)를 건너뛰는데, 이 구간을 건너뛰는 것이 청감상 문제없는지 — plan.md §5에서 "증명되지 않은 가정"으로 명시한 트레이드오프, 실제로 들어봐야 함
- [ ] 편집기→연습 화면 핸드오프 시 `audioOffsetMs≠0` 곡에서 리그레션 없는지

## 5. 결론

코드 레벨 정확성(단위 테스트 570개 전부 통과)과 실데이터 기반 수식 검증은 완료. 그러나 CLAUDE.md 3조("완료 주장 전에 증거를 첨부")를 지키려면, 위 §4의 실기기 검증 없이 "완료"로 선언할 수 없음 — 마스터(의뢰인) 확인 필요.
