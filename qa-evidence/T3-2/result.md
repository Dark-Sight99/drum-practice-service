> 한 줄 요약: T3-2(REQ-02 경로 A) DrumTranscriber(ADTOF-pytorch) 모듈 + 명시적 트리거(`POST /songs/{id}/transcribe`) 구현 완료. 자동 테스트 129개 전부 통과, 린트 0건. **실제 음원 2개로 전체 파이프라인(업로드→분리→채보) end-to-end 확인** — 특히 F-measure가 이미 측정된 MDB Drums 트랙으로는 T0-2와 완전히 같은 258개 노트·피치 분포가 재현됐고, 기존 연습 화면(T2-1~T2-8)이 프런트엔드 코드 변경 없이 그대로 재생함을 확인.

# T3-2 결과 — DrumTranscriber 모듈(ADTOF-pytorch) + 작업 연결

## 근거 REQ
REQ-02 드럼 MIDI 생성, 경로 A(오디오) — T3-1의 drums 트랙을 ADT(ADTOF-pytorch)로 채보해 DrumScore 생성. 수용 기준: "경로 A 샘플 1개 이상으로 DrumScore 생성 성공"(F-measure는 T0-2에서 이미 측정 완료, macro 0.7585), "생성 결과는 원본 보존 + 편집본 별도 저장"(기존 `DRUMSCORE_RAW`/`DRUMSCORE_EDITED` 구분 재사용).

## 설계 결정 — T3-1과 자동 연결 안 함
`POST /songs/{id}/transcribe`를 별도 엔드포인트로 신설(자동 체이닝 안 함). 이유: REQ-01(분리)과 REQ-02(채보)는 독립 요구사항(T3-3 다중 트랙 재생은 분리만으로도 가치 있음), Q-26(하이브리드 입력, 의뢰인 확정)이 "악보 추가 입력 기회" 흐름을 예정해뒀음, 이미 승인된 T3-1 코드를 안 건드림. 상세: `work/T3-2/plan.md` "T3-1과의 관계".

## 핵심 설계 결정 — 5-class→9-class 기본 매핑(추측 명시)
ADTOF는 하이햇(열림/닫힘)·탐(하이/미드/플로어)·심벌(크래시/라이드)을 각각 하나로 합쳐 출력(`LABELS_5=[35,38,47,42,49]`, 소스 확인). 합친 뒤 어떤 구체적 피스로 보여줄지는 명시적 기본값 선택 — **하이햇(합산)→`hihat_closed`, 탐(합산)→`tom_mid`, 심벌(합산)→`crash`**. `intent/07-open-questions.md` Q-26에 그대로 기록, 틀릴 수 있음을 숨기지 않음 — REQ-03 편집기(이미 구현됨)가 유일한 보정 수단.

## Codex 모드A(코드 검수) 지적·반영
1차 REQUEST_CHANGES(4건) — 전부 반영:
- **C-001(필수)**: `DRUMSCORE_RAW` find-or-create는 순차 재채보만 보호 — 워커를 여러 개 띄우면(Q-17 전제 위반) 두 작업이 동시에 "행 없음"으로 판단해 중복 생성 가능. **API 레벨에서 선제 차단**: `POST /songs/{id}/transcribe`가 같은 곡에 QUEUED/PROCESSING 상태인 TRANSCRIBE 작업이 이미 있으면 새로 안 만들고 그 Job을 그대로 반환(중복 클릭·중복 트리거 자체를 막음). 실제 HTTP 호출로 같은 job_id가 반환됨을 재확인.
- **C-002(권장)**: 실패 시 스테이징 파일 정리(`unlink`)가 실패하면 그 예외가 `Song.FAILED` 커밋을 막을 수 있었음 — 정리를 자체 try/except로 감싸 정리 실패는 로그만 남기고 원래 예외를 그대로 올리도록 수정.
- **C-003(권장)**: 핸들러의 맨 처음 "Song.PROCESSING" 커밋 자체가 실패하면 Song이 PENDING에 머문 채 Job만 끝나, `_sync_song_status_with_job` 안전망의 `song.status != PROCESSING` 조건을 피해갔음 — 조건을 "아직 종료 상태(COMPLETED/FAILED)가 아니면"으로 넓혀 PENDING도 커버(job_type 무관 범용 로직이라 T3-1 SEPARATE도 자동으로 같이 보호됨).
- **C-004(권장)**: 스테이징 후 승격의 핵심 실패 경계(DB 커밋 실패 시 기존 파일 보존, 승격 rename 실패 시 FAILED+정리)를 직접 재현하는 회귀 테스트 2개 신규 추가 — `SASession.commit`/`Path.replace`를 호출 횟수 기준으로 정확한 지점에서만 실패시키는 방식으로 정밀 재현, 둘 다 설계대로 동작함을 실제로 증명.

2차: C-002/C-003/C-004는 "수정 확인"(완전 해소). **C-001은 "부분 수정"으로 재지적** — API 레벨 가드가 "중복 클릭 후 재사용" 시나리오는 막지만, **조회(기존 Job 있나?)와 생성(새 Job INSERT) 사이의 진짜 동시 요청 경쟁**은 DB 수준 유일성 제약 없이는 여전히 닫히지 않는다는 지적(정확함).

### 마스터 최종 판단(C-001 잔여 — DB 마이그레이션 보류)
`intent/06-pipeline.md` §1-1 "재검수는 최대 3회" 규칙 — 이번이 2차 재검수라 1회 더 보낼 여지는 있으나, 추가 라운드가 결론을 바꾸지 않을 거라 판단해 여기서 직접 결정한다.

**지적이 유효한가**: 그렇다. 두 HTTP 요청이 진짜로 동시에 들어오면(같은 곡에 거의 같은 순간 `POST .../transcribe` 두 번) 둘 다 "기존 Job 없음"을 보고 각자 새 Job을 만들 수 있다 — API 가드가 막는 건 "이전 요청이 이미 끝난 뒤의 중복 클릭"뿐이다.

**왜 DB 마이그레이션을 지금 안 하는가**: 이 경쟁이 실제로 터져도 피해가 제한적이다 — (1) Q-17의 "워커는 1개만 운영" 전제 하에서는 두 Job이 생겨도 워커가 순차 처리하므로, 이미 테스트로 증명된 `DRUMSCORE_RAW` find-or-create 로직이 정상 동작해 결과 데이터(파일·Asset)는 여전히 1개로 수렴한다 — 낭비되는 건 ADTOF를 한 번 더 돌리는 GPU 시간(수 초) 뿐, 데이터 손상이나 사용자에게 보이는 오류는 없다. (2) 진짜 위험(두 Job이 서로 다른 워커 프로세스에 동시에 잡혀 파일 쓰기가 실제로 겹침)은 Q-17 전제 자체를 위반해야만 발생하는데, 이건 T3-1(C-006)이 이미 "의도된 트레이드오프"로 명시해둔 바로 그 전제다 — 이번 건을 위해서만 DB 마이그레이션(위험 작업, 별도 모드C 설계 검수 필요)을 추가하는 건 이 프로젝트가 이미 받아들인 위험 등급보다 더 엄격한 기준을 이 한 기능에만 적용하는 셈이라 불균형하다고 판단.
**결정**: C-001 잔여 위험은 Q-17과 같은 급의 "받아들인 트레이드오프"로 명시 기록하고 병합 진행. 운영상 워커를 여러 개 띄우게 되면(Q-17이 이미 그 경우의 재설계 필요성을 등록해둠) 이때 Job 테이블에 곡+유형+활성상태 기준 부분 유니크 인덱스를 추가하는 걸 같이 검토.

## Codex 모드C 설계 검수 경위(3라운드, 전부 반영)
1차 "수정 후 진행"(필수 C-001: 프로덕션 핸들러 등록 누락 — 계획에 빠져 있었음. 필수 C-002/C-003: 재채보 시 `DRUMSCORE_RAW` 중복 생성·기존 파일 커밋 실패 시 유실 가능. 권장 C-004~C-008: EDITED 우선순위 의도 확인·mkstemp fd 정리·사전조건 파일존재 확인·스키마 확장 영향범위·device 문자열 확정 시점) → 전부 1차 반영.
2차 "수정 후 진행"(C-003 잔여 — find-or-create로 재채보는 보호됐지만 **최초 채보**(신규 INSERT)·Song 상태 커밋 실패 경로는 여전히 열려있다고 정확히 재지적) → **스테이징 후 승격**(`drumscore.json.new`에 먼저 쓰고, DB 커밋 성공 후에만 원자적 rename으로 실제 파일 교체) 설계로 전면 해소.
3차 "진행 가능"(APPROVE) — 추가 지적 없음.

## 구현
- `app/server/modules/transcriber/adtof_transcriber.py` — ADTOF 서브프로세스 호출(`python -m adtof_pytorch.cli` — `adtof.exe` 콘솔스크립트가 이 PC에서 WinError 4551(애플리케이션 실행 정책)로 막혀 모듈 실행으로 우회, 실측 확인). `demucs_separator.pick_device()`를 공개 이름으로 바꿔 재사용(공용 장치 선택 로직 중복 방지).
- `app/server/modules/transcriber/midi_to_drumscore.py` — ADTOF MIDI → DrumScore dict 순수 변환 함수. `pretty_midi`의 `time_to_tick()`을 그대로 써서 초→틱 계산을 직접 재구현 안 함.
- `app/server/modules/transcriber/handler.py` — `transcribe_handler`: Song.PROCESSING 선언 → STEM_DRUMS 조회(행+파일 둘 다 확인) → ADTOF 실행 → DrumScore 생성+검증(`DrumScoreIn`) → **스테이징 후 승격** → `DRUMSCORE_RAW` find-or-create → Song.COMPLETED. 전체를 하나의 try/except로 묶어 실패 시 Song.FAILED+스테이징 정리+재발생(T3-1 패턴 그대로).
- `app/server/api/songs.py` — `POST /songs/{id}/transcribe`(인증+소유권 확인, STEM_DRUMS 행·파일 존재 사전 확인, QUEUED Job 생성).
- `app/server/api/schemas.py` — `ScoreSourcePhase2`에 `"audio"` 추가(TS `ScoreSource`와 점진 동기화, `PUT .../drumscore` 편집 저장도 자동으로 혜택 — 의도된 전제조건).
- `app/server/worker/runner.py` — `register_production_handlers()`에 `JobType.TRANSCRIBE` 등록 추가(모드C C-001 핵심 반영).
- `requirements.txt`·`wiki/tools.md` — ADTOF-pytorch 설치 경로 기록(PyPI 패키지 아님, `data/repos/ADTOF-pytorch` 로컬 편집 설치).

## QA 증거

### 자동 테스트
- `pytest`: **129개 전부 통과**(`pytest_output.txt`, T3-1까지 103개 + 신규 26개).
  - `test_midi_to_drumscore.py`(6개): 5-class 전부 매핑, 틱 변환, 미매핑 피치 스킵+집계, 메타 기본값, `DrumScoreIn` 검증 통과, 빈 MIDI도 유효.
  - `test_adtof_transcriber.py`(4개): 커맨드 조립, 실패 처리, 출력 누락 처리, device auto.
  - `test_transcribe_handler.py`(6개): 성공, **재채보 시 Asset 중복 안 생김(C-002 직접 회귀)**, **EDITED 보존 확인(C-004)**, **재채보 실패 시 기존 drumscore.json 완전 보존(C-003 직접 회귀 — 구현 중 처음부터 통과)**, 검증 실패 처리, STEM_DRUMS 없음 처리.
  - `test_songs_transcribe_api.py`(5개): 인증, STEM_DRUMS 행 없음 400, **파일 없음도 400(C-006)**, Job 생성, 다른 사용자 404.
  - `test_worker.py`(+1개): `register_production_handlers()`가 SEPARATE·TRANSCRIBE 둘 다 등록하는지 직접 확인(C-001 회귀 — 이게 빠지면 테스트 없이는 운영 중에만 드러났을 버그).
- `ruff check`: 0건.

### 실제 end-to-end(진짜 서버·워커·ADTOF, 모킹 없음)
`app/server/.venv`에 `adtof-pytorch`+`pretty_midi` 이번 세션에 신규 설치.
1. **song id=7**(T3-1 QA에서 이미 분리해둔 실제 음원): `POST /songs/7/transcribe` → 워커 실행(3.4초) → `DRUMSCORE_RAW` 생성, `source="audio"`, 노트 1개(20초 클립의 실제 드럼 내용이 희박해서 — 버그 아님, 원본이 그런 구간).
2. **song id=8**(MDB Drums `MusicDelta_Grunge_MIX.wav`, F-measure가 이미 측정된 기준곡): 업로드 → 분리(4.9초) → 채보(3.2초) → **258개 노트, 피치 분포가 T0-2의 원시 ADTOF 측정값과 정확히 일치**(`{35:83, 38:46, 42:120, 47:6, 49:3}` → `{kick:83, snare:46, hihat_closed:120, tom_mid:6, crash:3}`) — 변환 로직이 피치를 하나도 안 잃고 정확히 매핑함을 실데이터로 증명.
3. **프런트엔드 재생 확인**: 실제 브라우저로 song id=8을 열어 연습 화면이 스네어·탐·킥 노트를 정상 렌더링함을 스크린샷으로 확인 — **프런트엔드 코드를 전혀 안 건드렸는데도 작동**(`GET /songs/{id}/drumscore`가 이미 `DRUMSCORE_RAW`를 읽는 기존 T2-5 경로를 그대로 탐). 재생 버튼으로 실제 재생·정지까지 확인, 콘솔에 새 에러 없음(이전 세션들의 오래된 HMR 잔존 에러만 있었음, T2-15/16에서 이미 확인된 것과 동일).

## 가정·확인 필요(이미 Q-10/Q-26에 기록)
- `adtof.exe`(pip console-script) 직접 실행이 이 PC에서 막혀 있음(WinError 4551, 애플리케이션 실행 정책) — `python -m adtof_pytorch.cli`로 우회. 프로덕션 코드는 처음부터 이 방식으로 작성.
- Q-10 해소: ADTOF-pytorch CLI가 velocity=100을 하드코딩(모델 예측 아님) — 소스 코드로 확인.
- Q-26: 피치→피스 기본 매핑(hihat_closed/tom_mid/crash)은 명시적 추측, 틀릴 수 있음.
- `timeSignature`는 ADTOF가 추정 안 해서 `[4,4]` 고정(Q-25와 같은 구조적 한계 계열).
- 업로드 시 `Song.original_bpm`은 여전히 null(라이브러리 화면에 "BPM 미상"으로 표시) — DrumScore 내부 `meta.bpm`엔 실제 값이 들어있어 연습 화면 재생엔 영향 없음, 라이브러리 목록 표시만의 사소한 간극(이번 범위 밖, 필요하면 별도 작업).

## 재현
```
cd app/server
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check . --exclude .venv
```
실제 end-to-end는 `uvicorn` 기동(`app/server/.venv` 파이썬) + 로그인 + `POST /songs/audio` 업로드 + `worker.runner --once`(분리) + `POST /songs/{id}/transcribe` + `worker.runner --once`(채보, ffmpeg PATH 필요, `PYTHONIOENCODING=utf-8` 권장).
