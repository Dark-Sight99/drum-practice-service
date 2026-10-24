> 한 줄 요약: T3-1(REQ-01) Demucs Separator 모듈 + 작업 큐 연결 완료. 자동 테스트 103개 전부 통과, 린트 0건, **실제 HTTP 업로드 → 실제 워커 → 실제 Demucs 분리**로 end-to-end 성공/실패 양쪽 경로 다 실측 확인 — 과정에서 Windows cp949 콘솔 환경에서만 재현되는 진짜 버그(subprocess 출력 디코딩 크래시)를 발견·수정.

# T3-1 결과 — Separator 모듈(Demucs) + 작업 연결

## 근거 REQ
REQ-01 오디오 분리 — mp3/wav/m4a/flac 업로드 → Demucs로 drums/bass/vocals/other 분리, 수용 기준(3~5분 곡 업로드 → 분리 완료 후 각 트랙 개별 재생 가능, 진행률/상태 표시, 처리 시간 로그 기록).

## 구현
- `app/server/modules/separator/demucs_separator.py` — `separate()` 순수 함수, device 자동 선택(cuda→mps→cpu), 서브프로세스로 `python -m demucs` 실행.
- `app/server/modules/separator/handler.py` — `separate_handler(job)`: ORIGINAL 에셋 조회 → Demucs 실행 → 4개 stem 저장+Asset 생성+Song.COMPLETED를 한 트랜잭션, 어느 단계든 실패하면 이번 시도에서 쓴 stem만 정리 후 Song.FAILED+재발생.
- `app/server/api/songs.py` — `POST /songs/audio`(인증 필요, REQ-01 확장자만 허용, 100MB 상한, 스트리밍 저장).
- `app/server/file_storage.py` — `write_song_file_streaming()` 추가(청크를 메모리에 두 번 안 들고 원자적 교체).
- `app/server/worker/runner.py` — `recover_orphaned_jobs()`가 Job과 함께 Song도 복구, `_sync_song_status_with_job()` 공용 안전망 신설.
- `app/server/requirements.txt` — demucs/numpy 추가(torch/torchaudio는 CUDA 전용 index-url로 별도 설치, 주석에 명시).

## 설계 검수 경위
"공개 API 변경 + 외부 모델 연동"(위험 작업) — Codex 모드C 3라운드(상세: `work/T3-1/plan.md`):
1차 "수정 후 진행"(필수 4건: 워커 강제종료 시 Song 상태, 부분 stem 정리, 임시 디렉터리 정리, 인증 명시) → 전부 반영.
2차 "수정 후 진행"(필수 1건: Asset 커밋 실패도 정리 대상에 포함) → 반영.
3차 BLOCKING(Asset 커밋 실패가 의사코드에 안 보임, Song 실패 커밋 자체가 실패하는 경우 복구 안 됨) — `intent/06-pipeline.md` 최대 3회 규칙에 따라 마스터가 직접 판단: §3을 확정 의사코드로 재작성 + `_run_job()` 레벨 공용 안전망(`_sync_song_status_with_job`) 신규 설계로 간극을 구조적으로 닫음(plan.md "마스터 최종 판단" 절에 사유 기록).

## QA 증거

### 자동 테스트
- `pytest`: **103개 전부 통과**(`pytest_output.txt`, 기존 81개 + 신규 22개).
  - `test_demucs_separator.py`(4개): 커맨드 조립, 비정상 종료 처리, stem 누락 처리, device auto 선택 — subprocess monkeypatch.
  - `test_separate_handler.py`(4개): 성공 시 Asset 4개+Song.COMPLETED, Demucs 실패 시 Song.FAILED+재발생, **부분 stem 쓰기 실패 시 이번 시도분만 정리**(C-002/C-011 직접 재현), **ORIGINAL 에셋 누락 시에도 Song.FAILED**(단위 테스트 작성 중 직접 발견한 간극 — 최초 구현은 이 경로가 Song.PROCESSING에 멈추는 버그였음, 즉시 수정).
  - `test_worker.py`(+6개): `recover_orphaned_jobs`가 Song도 복구, 안전망이 정상 흐름에선 no-op, Job 실패/성공 양쪽에서 Song이 PROCESSING에 멈춰있으면 안전망이 FAILED로 맞춤.
  - `test_songs_audio_upload_api.py`(9개): 인증 필요, REQ-01 4개 확장자 허용, mp4 거부, Song/Asset(ORIGINAL)/Job(QUEUED) 생성, 100MB 초과 거부(Song 고아 행 안 남음), 다른 사용자 404.
- `ruff check`: 0건(`ruff_output.txt`).

### 실제 end-to-end(진짜 서버·워커·Demucs, 모킹 없음)
`app/server/.venv`에 실제로 torch(cu128)+demucs 설치(이 세션에서 신규 — 기존엔 프로젝트 루트 `.venv`에만 있었음), ffmpeg도 이 세션에서 winget 설치. 실제 uvicorn(`app/server/.venv` 파이썬)으로 서버 기동 후:

1. **성공 경로**: 의뢰인이 제공한 실제 mp4 음원(`음원/backnumber.mp4`, 삭제 전 `.gitignore` 대상)에서 ffmpeg로 30초 wav 클립 추출 → `POST /songs/audio`로 실제 업로드 → `python -m worker.runner --once`로 실제 Demucs 분리(4.5초) → Song.status=completed, Asset 4개(stem_drums/bass/other/vocals) 생성, 전부 표준 `wave` 모듈로 재생 가능한 44.1kHz 스테레오 30초 WAV로 확인.
2. **실패 경로**: 임의 바이트(`/dev/urandom` 1000바이트, `.wav` 확장자만)를 업로드 → Demucs가 실제로 디코딩 실패(returncode=1) → Song.status=failed, Asset은 ORIGINAL만 남고 stem은 생성 안 됨, Job.error_message에 Demucs의 실제 Python 트레이스백이 읽을 수 있는 UTF-8로 저장됨.
3. **버그 발견·수정**: 첫 성공 경로 실행 중 `subprocess`의 내부 리더 스레드가 `UnicodeDecodeError: 'cp949' codec can't decode byte...`로 죽는 걸 실제로 목격(Demucs 진행률 표시줄의 유니코드 문자를 이 PC의 기본 콘솔 로캘(cp949)로 디코딩하려다 발생) — 이번엔 운 좋게 반환값 처리에 영향 없이 넘어갔지만, **진짜 실패 상황이었다면 `proc.stderr`가 깨지거나 비어 있어 에러 메시지도 같이 깨질 수 있었음**. `subprocess.run()`에 `encoding="utf-8", errors="replace"`를 명시해 수정, 동일 입력으로 재실행해 크래시 메시지 없이 깨끗하게 끝남을 재확인. 회귀 테스트(`test_separate_builds_expected_command_and_returns_stem_paths`에 `encoding`/`errors` kwarg 검증 추가)로 봉인.

## 가정·범위 밖
- 프런트엔드 음원 업로드 화면은 이번 범위 밖(백엔드 모듈·API·큐 연결만, `work/T3-1/plan.md` §범위).
- mp4 등 비디오 입력은 `POST /songs/audio`의 허용 확장자에 넣지 않음(REQ-01 명시 범위 밖) — Separator 모듈 자체가 ffmpeg를 통해 처리 가능함은 확인해뒀을 뿐(`demucs_mp4_spike.md`).
- 단일 워커가 분리 작업(수 초~수십 초) 동안 다른 작업을 블로킹하는 건 Q-17 전제에 따라 이번 범위에서 수용(`work/T3-1/plan.md` C-006).

## 재현
```
cd app/server
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check . --exclude .venv
```
실제 end-to-end는 `.venv/Scripts/python.exe -m uvicorn api.main:app` + 로그인 + `POST /songs/audio` 업로드 + `python -m worker.runner --once`(ffmpeg가 PATH에 있어야 함, PYTHONIOENCODING=utf-8 권장 — cp949 콘솔에서 한글 로그 출력 시 크래시하는 별개의 익숙한 함정, T2-14/T2-16과 동일).
