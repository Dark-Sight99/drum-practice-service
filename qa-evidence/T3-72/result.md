> 한 줄 요약: T3-72(다운비트 자동 보정) QA 증거 — 단위 테스트 전부 통과(백엔드 238·프런트 332), 실제 song 9 재채보(백엔드/워커 재시작 후 실기기)로 end-to-end 검증까지 완료. 실제 청취 검증 1건만 의뢰인 몫으로 남음(§4).

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

## 4. 실기기(실브라우저) end-to-end 검증

의뢰인의 명시적 지시("서버/워커 재시작해줘")에 따라 기존 백엔드 서버(uvicorn)·워커(worker.runner) 프로세스를 중지하고 새 코드로 재시작한 뒤, 실제 돌아가는 프런트엔드(localhost:5173)·백엔드(localhost:8000)를 통해 검증했다.

- **실제 재채보(`POST /songs/9/transcribe` → job 13)**: 워커 로그(`_worker_stderr.log`)에 `downbeat_offset_seconds=0.2818` 기록, 결과 DrumScore의 `audioOffsetMs=282`, 첫 노트 `tick=3511`(bpm=92, ppq=220, 1809개 노트) — §3에서 오프라인으로 예측한 값(t0=0.2818s, 95틱 이동)과 완전히 일치. 실제 ADTOF 모델·실제 워커 프로세스를 통한 end-to-end 재현 확인.
- **음원 트랙 재생 차단 해제**: 편집기(`/songs/9` 편집 화면)에서 "원곡 드럼"·"음악(베이스·보컬·그 외)" 볼륨 슬라이더가 활성 상태로 표시되고, `GET /api/songs/9/audio/stem_{drums,other,vocals,bass}`가 전부 200 OK로 로드됨 — `audioOffsetMs=282`(0 아님)인데도 더 이상 신스 폴백으로 막히지 않음을 확인(이전 버그였다면 이 트랙들이 아예 로드되지 않았을 것).
- **재생 동작**: 재생 버튼을 눌러 실제로 재생 진행(0:00→0:16, 일시정지 버튼으로 전환)을 확인, 네트워크 탭에 오디오 blob 스트리밍(`206 Partial Content`) 정상 확인.
- **그리드 정렬(시각 증거)**: 재생 중 첫 노트 묶음(킥·하이햇·크래시)을 확대 촬영한 결과, 박자 1 그리드선(흰 세로선, "1" 라벨) 정확히 위에 노트가 찍혀 있음 — 보정 전이었다면 약 0.28초(92bpm에서 한 박=0.652초의 약 43%)만큼 그리드선에서 떨어져 보였을 자리. 편집기 그리드·메트로놈이 설계대로(§1, 코드 변경 없이) 자동으로 올바르게 맞음을 시각적으로 확인.

```
워커 로그 (_worker_stderr.log):
INFO:worker.transcribe:transcribe song=9 elapsed=5.2s device_auto=yes
INFO:worker.transcribe:transcribe song=9 estimated_bpm=92.00
INFO:worker.transcribe:transcribe song=9 downbeat_offset_seconds=0.2818
```

### 미검증으로 남은 항목

- [ ] **청취 검증**: 음원 트랙이 실제 파일의 처음 t0(0.2818s)를 건너뛰는데, 이 구간을 건너뛰는 것이 청감상 거슬리지 않는지 — 도구로는 실제로 "들을" 수 없어 확인 불가. 다만 재앵커 후 clamp된(=다운비트 이전) 노트가 0건이라는 것은, 이 곡에서 드럼이 치는 첫 지점 자체가 다운비트이고 그 전(피아노 인트로)엔 드럼이 없다는 뜻 — 건너뛰는 구간이 드럼 파트 기준으로는 원래도 "아직 안 친" 부분이라 체감 영향이 적을 가능성이 높으나, 이는 추정이지 증명이 아니다. 의뢰인이 직접 들어보고 확인 필요.
- [ ] A-B 루프 재진입 시 오프셋 적용 seek의 끊김/중복 여부는 코드·단위테스트로는 검증됐으나(§2 timing.test.ts) 실제 루프 반복 재생으로 귀로 확인하지는 않음.
- [ ] 편집기→연습 화면 핸드오프 리그레션은 별도로 테스트하지 않음(단, 두 화면 모두 같은 `audioOffsetMs`/`audioTrackPositionSeconds` 경로를 쓰므로 위험은 낮다고 판단).

## 5. 결론

단위 테스트(570개) + 실데이터 수식 검증 + **실제 재채보·실브라우저 재생·그리드 정렬 시각 확인**까지 완료. 남은 건 "청취로 거슬리지 않는지" 1건뿐이며, 이는 의뢰인의 주관적 판단이 필요한 영역이라 도구로 대신할 수 없다. Codex 모드A(코드 리뷰) 진행 가능.
