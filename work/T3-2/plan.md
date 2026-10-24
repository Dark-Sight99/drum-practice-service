> 한 줄 요약: ADTOF-pytorch 드럼 채보 모듈(Transcriber) 구현 + 작업 큐 연결 — T3-1이 만든 drums 스템을 입력받아 DrumScore JSON을 생성·저장. "공개 API 변경 + 외부 모델 연동 + 스키마(허용 source 값) 확장"(위험 작업)이라 구현 전 Codex 모드C 설계 검수 필요.

# T3-2 plan — DrumTranscriber 모듈(ADTOF-pytorch) + 작업 연결

## 근거 REQ
REQ-02 드럼 MIDI 생성, 경로 A(오디오) — REQ-01의 drums 트랙(T3-1 산출물) → 드럼 채보 모델(ADT) → DrumScore. 수용 기준: "경로 A: 기준곡으로 분류별 F-measure 측정·기록"(T0-2에서 이미 측정 완료, macro 0.7585), "생성 결과는 원본 보존 + 편집본 별도 저장"(기존 `AssetKind.DRUMSCORE_RAW`/`DRUMSCORE_EDITED` 구분을 그대로 재사용하면 충족).

## T3-1과의 관계 — 자동 연결 안 함(설계 결정)
T3-1(분리)이 끝나자마자 자동으로 채보까지 이어서 돌리지 않는다. 이유:
1. REQ-01(분리)과 REQ-02(채보)는 명세상 독립 요구사항 — T3-3(다중 트랙 동기 재생)은 분리된 트랙만으로도 가치가 있는 별개의 연습 모드라, 모든 음원 업로드가 자동으로 채보까지 거쳐야 한다고 가정하면 안 됨.
2. Q-26(하이브리드 입력, 의뢰인 확정)이 "음원 필수 + 악보 선택 보조"를 Phase 3 설계 방향으로 못박아뒀다 — 악보 업로드(Phase 4, 아직 미구현)가 생기면 "분리 끝나자마자 바로 채보"가 아니라 "사용자가 악보를 추가로 올릴 기회를 준 뒤 채보 시작" 흐름이 더 맞다. 지금 자동 연결해버리면 나중에 그 흐름과 충돌해 되돌리는 작업이 필요해짐.
3. 이미 병합된 T3-1 코드(Codex 모드C 3라운드+모드A 2라운드 거쳐 승인됨)를 건드리지 않고 순수 추가로만 구현 가능 — 범위·리스크 최소화.

대신 **명시적 트리거 엔드포인트**(`POST /songs/{id}/transcribe`)를 신설 — 프런트엔드가 생기면 "분리 완료" 상태를 보여준 뒤 사용자가 누르는 버튼으로 연결하면 됨(이번 범위는 백엔드만, T3-1과 동일 패턴).

## 이미 있는 것(재사용)
- DB 스키마: `AssetKind.DRUMSCORE_RAW`(이미 T2-5가 씀), `JobType.TRANSCRIBE`(이미 정의됨) — **마이그레이션 불필요**.
- 작업 큐: T1-4/T3-1 그대로 재사용. `worker/runner.py`의 `_sync_song_status_with_job()` 안전망은 job_type 무관 범용 로직이라 TRANSCRIBE도 자동으로 혜택(T3-1에서 이미 이렇게 설계해둔 이유).
- 파일 저장: `file_storage.write_song_file()` 그대로.
- DrumScore 검증: `api/schemas.py`의 `DrumScoreIn`(Pydantic) — T1-5가 "Python 생성 로직은 Phase 3/4에서 이 타입과 교차 검증"이라고 이미 계획해둔 그 지점. **단, 현재 `ScoreSourcePhase2 = Literal["midi","musicxml","gp"]`가 "audio"/"omr"을 명시적으로 거부하도록 좁혀져 있음**(T2-5 코드 주석: "Phase 2는 디지털 악보만, audio/omr은 Phase 3/4라 여기선 거부") — TS 쪽 `ScoreSource` 타입(`app/web/src/score/types.ts`)엔 이미 `'audio'|'omr'`이 포함돼 있어, 이번 작업에서 Python Literal에 `"audio"`를 추가하는 게 **예정된 확장**이지 범위 밖 작업이 아님. DB 스키마 변경은 없음(순수 Pydantic Literal 확장).
- 읽기 경로: `GET /songs/{id}/drumscore`(T2-5)가 이미 `DRUMSCORE_EDITED`→`DRUMSCORE_RAW` 순으로 찾아서 반환 — 이번 작업이 `DRUMSCORE_RAW` Asset을 만들어두기만 하면, **프런트엔드 연습 화면(T2-1~T2-8)이 코드 변경 없이 그대로 재생 가능**.

## 모델 확인(이번 세션 실측)
- 설치: `pip install -e data/repos/ADTOF-pytorch`(저장소는 `data/`라 `.gitignore` 대상, `wiki/tools.md`에 clone 명령 이미 기록됨) + `pretty_midi`. `app/server/.venv`엔 이번에 새로 설치(이전엔 프로젝트 루트 `.venv`에만 있었음, T3-1의 torch/demucs와 같은 상황).
- **CLI 실행 파일(`adtof.exe`, pip console-script)이 이 세션 환경에서 Windows 애플리케이션 실행 정책(WinError 4551)에 막혀 직접 실행 안 됨** — 대신 `python -m adtof_pytorch.cli --audio <입력> --out <출력.mid> --device <device>`로 같은 CLI를 모듈로 실행하면 정상 동작(실측 확인, 아래 가정 참고). Demucs를 `python -m demucs`로 돌린 것과 같은 이유로 같은 해법.
- 출력 MIDI 실측(`data/t0-2-work/MusicDelta_Grunge.mid`, T0-2 산출물 재확인 + 이번 세션 직접 재실행 둘 다): `resolution(ppq)=220`, 템포 이벤트 1개(120bpm), 음표 피치는 정확히 `{35,38,42,47,49}`(kick/snare/hihat/tom/cymbal, `adtof_pytorch/post_processing.py`의 `LABELS_5` 그대로) 다섯 가지만 나옴. **velocity는 전부 100 — 모델 예측값이 아니라 CLI 소스코드(`cli.py`)에 `activations_to_pretty_midi(..., velocity=100, note_duration=0.1, ...)`로 하드코딩된 상수임을 소스로 확인**(Q-10 "셈여림 정확도 미검증"을 "셈여림 정보 자체가 없음"으로 갱신 필요 — 아래).
- 가중치는 저장소에 번들(`adtof_pytorch/data/adtof_frame_rnn_pytorch_weights.pth`) — 추론 시 네트워크 불필요, 재현성 좋음.
- 처리 시간: 20초 음원 약 3.4초(GPU) — 가볍다.

## 설계

### 1. `app/server/modules/transcriber/adtof_transcriber.py`
- `transcribe(input_path: Path, output_path: Path, device: str | None = None) -> None` — **`device` 인자를 받은 즉시 `chosen_device = device or demucs_separator._pick_device()`로 실제 문자열("cuda"/"mps"/"cpu")로 먼저 확정한 뒤**(모드C C-008 명확화 — `None`이 서브프로세스 인자에 그대로 들어가는 일은 없음, `demucs_separator.separate()`의 기존 패턴과 완전히 동일), `[sys.executable, "-m", "adtof_pytorch.cli", "--audio", str(input_path), "--out", str(output_path), "--device", chosen_device]`를 서브프로세스로 실행(`encoding="utf-8", errors="replace"` 처음부터 적용 — T3-1에서 실제로 재현된 cp949 버그를 알고 있으니 이번엔 처음부터 반영).
- device 자동 선택은 `demucs_separator._pick_device()`를 그대로 import해서 재사용(함수 하나뿐이라 공용 유틸 모듈로 미리 빼는 건 과설계로 판단).
- 실패(returncode≠0)면 stderr 포함 예외.

### 2. `app/server/modules/transcriber/midi_to_drumscore.py` (순수 함수, 가장 중요한 설계 결정)
`pretty_midi.PrettyMIDI` 객체를 받아 `DrumScoreIn` 호환 dict를 반환.

**피치→DrumPiece 매핑(5-class ADTOF → 9-class 우리 스키마)**:
```python
PITCH_TO_PIECE = {
    35: "kick",          # 명확
    38: "snare",         # 명확
    42: "hihat_closed",  # ADTOF는 열림/닫힘 구분 안 함 — 더 흔한 쪽을 기본값으로
    47: "tom_mid",        # ADTOF는 하이/미드/플로어 구분 안 함 — 중간값을 기본값으로
    49: "crash",          # ADTOF는 크래시/라이드 구분 안 함 — REQ-02 명세 순서(크래시가 라이드보다 먼저 언급)를 따름
}
```
**이 매핑은 추측이 아니라 명시적 기본값 선택이고, 정확하지 않을 수 있음을 숨기지 않는다** — `intent/02-requirements.md`의 "모델이 구분 못 하는 분류는 상위 분류로 합친다"는 이미 승인된 원칙이지만, "합친 뒤 어느 이름으로 보여줄지"는 이번에 처음 내리는 구체적 결정이라 `intent/07-open-questions.md` Q-26에 명시적으로 기록하고 보고서에도 강조한다. 더 나은 방법(QMUL 음량 휴리스미나 하이브리드 악보 입력)은 이미 Q-26에 "향후 검토"로 등록돼 있어 지금 범위가 아님.
- `tick = pretty_midi_obj.time_to_tick(note.start)`(pretty_midi 내장 메서드 — 직접 초→틱 계산식을 다시 구현하지 않고 라이브러리가 이미 검증된 방식을 그대로 씀, T2-1의 "계산은 라이브러리에 맡긴다" 원칙과 동일).
- `velocity = note.velocity`(값 자체를 그대로 씀 — 항상 100이라는 사실은 알고 있지만 하드코딩하지 않고 원본 그대로 전달, CLI가 나중에 실제 velocity를 예측하도록 바뀌어도 이 변환 함수는 안 바뀜).
- `hand = None`(REQ-12 스티킹은 프런트엔드가 `recommendSticking()`으로 즉석 계산 — T2-8에서 이미 "저장 없이 연습 화면에서 즉석 자동계산"으로 정함, 여기서 추천 손을 미리 계산 안 함).
- `meta.bpm`: `pretty_midi_obj.get_tempo_changes()`의 첫 템포값(ADTOF 출력은 항상 템포 이벤트 1개, 실측 확인) — 여러 개면(모델이 바뀌어 템포 맵을 내보내게 되면) 첫 값만 쓰고 Q-25(고정 BPM 구조적 한계)에 이미 등록된 한계로 남김.
- `meta.timeSignature`: ADTOF는 박자 정보를 전혀 안 만듦(태생적으로 온셋 분류 모델이라 마디 개념이 없음, 실측 확인) — **기본값 `[4,4]` 사용**(REQ-02에 다른 기준 없음, 가장 흔한 박자). 이것도 Q-26에 한계로 기록.
- `ppq`: `pretty_midi_obj.resolution`을 그대로 씀(실측 220) — 임의로 다른 값으로 재조정 안 함(원본 데이터 보존 원칙).

### 3. `app/server/modules/transcriber/handler.py`의 `transcribe_handler(job)`
T3-1 `separate_handler`와 같은 뼈대를 쓰되, 모드C가 지적한 "재채보" 고유 리스크(C-002/C-003)를 추가로 반영:
- Song.PROCESSING 선언.
- Song.PROCESSING 이후의 모든 실패(STEM_DRUMS 에셋 조회·파일 존재 확인 실패·임시 파일 생성 실패·ADTOF 실패·MIDI 파싱 실패·DrumScore 검증 실패·파일 쓰기 실패·Asset 커밋 실패)를 **하나의 try/except**로 묶어 Song.FAILED+재발생(T3-1 C-011과 동일 원칙, 처음부터 전체를 감쌈).
- **임시 파일 처리(모드C C-005 반영)**: `fd, tmp_path = tempfile.mkstemp(suffix=".mid")` → **`os.close(fd)`를 즉시 호출**(ADTOF 서브프로세스가 `--out`으로 그 경로에 직접 쓰므로 우리가 그 파일 디스크립터로 쓸 일이 없음 — 열어둔 채로 두면 Windows에서 서브프로세스가 같은 파일에 쓰려 할 때 충돌 가능). `try/finally`로 `Path(tmp_path).unlink(missing_ok=True)` — ADTOF 실패·MIDI 파싱 실패 등 어느 단계에서 끊기든 이 임시 .mid 파일은 항상 정리됨(T3-1 C-003과 같은 원칙, 디렉터리가 아니라 파일 하나라 더 단순).
- 성공 시: MIDI를 `pretty_midi`로 파싱 → `midi_to_drumscore()`로 dict 생성 → `DrumScoreIn.model_validate(dict)`로 검증(실패하면 버그이지 사용자 탓이 아니므로 그대로 예외 전파, T1-5가 예정해둔 "Python 생성 로직 교차검증"이 바로 이 지점) → JSON 직렬화 → `write_song_file(song.id, "drumscore.json", content)`(검증을 먼저 통과한 내용만 쓰므로, 쓰는 시점엔 이미 유효한 DrumScore라는 게 보장됨 — 아래 C-003 대응의 전제).
- **기존 `DRUMSCORE_RAW` 에셋 처리(모드C C-002/C-003 반영)**: T2-6의 `_find_edited_asset`과 같은 "조회 후 있으면 그대로 두고, 없으면 생성" 패턴을 `DRUMSCORE_RAW`에도 적용 — `file_path`가 애초에 항상 고정값(`f"{song.id}/drumscore.json"`)이라 기존 행이 있으면 **DB에 새로 쓸 내용이 없음**(파일 경로가 안 바뀌므로), 없으면 새로 `Asset(kind=DRUMSCORE_RAW, ...)` 1행만 생성. 이렇게 하면: (a) 재채보를 여러 번 돌려도 `DRUMSCORE_RAW` 행이 중복 생성되지 않고(C-002 해소), (b) 재채보(기존 행 있음) 케이스는 파일 쓰기 이후 DB 쪽에 커밋할 내용이 사실상 없어(행이 이미 있으므로) "파일은 새로 바뀌었는데 DB 커밋이 실패해 상태가 꼬이는" 윈도우 자체가 거의 사라짐(C-003 대부분 해소) — 유일하게 남는 위험은 **그 곡의 첫 채보**(신규 Asset INSERT 필요)인데, 이건 T3-1의 stem 쓰기와 완전히 같은 위험 등급이라 새로운 리스크가 아님(기존에 이미 수용한 범위).
- 마지막으로 `Song.status=COMPLETED` 커밋.
- **`DRUMSCORE_EDITED`는 절대 안 건드림**(사용자가 직접 편집한 결과). **모드C C-004 확인**: `GET /songs/{id}/drumscore`가 EDITED를 RAW보다 우선 반환하므로, 이미 편집본이 있는 곡을 재채보해도 사용자가 보는 화면은 안 바뀐다 — 이건 버그가 아니라 **의도된 동작으로 확정**한다(REQ-03 "편집 → 저장 → 재로드 시 동일" 원칙 연장, 자동 재채보가 수동 편집을 조용히 덮어쓰면 안 됨). 재채보 결과를 EDITED와 비교·병합하는 UI는 프런트엔드가 생길 때(범위 밖) 다룰 문제로 남김.

### 4. `POST /songs/{id}/transcribe` (`api/songs.py`에 추가)
- 인증: `get_current_user`(기존 패턴, `get_owned_song` 의존성 재사용 — 다른 사용자 곡이면 404).
- **사전 조건 검사(모드C C-006 반영)**: `STEM_DRUMS` Asset 행 존재 여부만 보지 않고, T3-1 `separate_handler._original_asset_path()`와 같은 패턴으로 **`resolve_asset_path()`로 실제 파일 경로를 구해 `.exists()`까지 확인** — 행은 있는데 파일이 지워졌거나 경로가 안전 범위 밖이면 400으로 바로 거부(불필요한 Job을 큐에 안 넣음). 파일이 존재해도 내용 자체가 손상된 경우(오디오 디코딩 실패 등)는 이 사전 검사로 못 거르고 핸들러 실행 시점에 실패 처리됨 — 이건 사전 검사의 한계로 인정하고 핸들러의 실패 경로(위 §3)가 책임진다.
- `Job(job_type=TRANSCRIBE, status=QUEUED)` 생성, 응답 `{job_id: int}`.

### 5. `api/schemas.py` 확장
`ScoreSourcePhase2 = Literal["midi","musicxml","gp"]` → `"audio"` 추가. **모드C C-007 확인(의도된 영향)**: 이 확장은 `PUT /songs/{id}/drumscore`(T2-6 편집기 저장)에도 적용되는데, 이건 부작용이 아니라 **필요한 전제조건**이다 — 이번 작업으로 오디오 기반 `DrumScore`가 생기면, 사용자가 기존 편집기(T2-6, 이미 구현됨)로 그 음표들을 수정해 저장할 때도 `meta.source="audio"`가 그대로 유지된 채 저장되므로, 이 값이 허용 목록에 없으면 편집 저장 자체가 422로 막혀버린다. 반대로 디지털 악보 업로드(`POST /songs`)는 확장자-소스 일치 검사(`ALLOWED_EXTENSIONS[ext] != parsed.meta.source`)가 별도로 있어 "audio"가 그 경로로 새어 들어올 길은 없음(교차 확인 완료). `"omr"`은 아직 Phase 4 범위라 이번엔 안 넣음(과한 선확장 방지).

### 6. 프로덕션 핸들러 등록(모드C C-001 반영, 필수)
`worker/runner.py`의 `register_production_handlers()`에 `register_handler(JobType.TRANSCRIBE, transcribe_handler)` 추가 — 이걸 빠뜨리면 큐에 쌓인 TRANSCRIBE 작업을 워커가 **영원히 "핸들러 없음"으로 실패 처리**(T3-1에서 이미 이 정확한 동작을 만들어놨다는 게 역설적으로 이 실수를 "조용한 버그"가 아니라 "바로 눈에 띄는 실패"로 만들어주긴 하지만, 그래도 빠뜨리면 안 됨). 실제 end-to-end QA에서 이 등록이 빠지지 않았는지 직접 확인.

### 7. 의존성
`app/server/.venv`에 `adtof-pytorch`(로컬 경로, `pip install -e ../../data/repos/ADTOF-pytorch`)+`pretty_midi` 추가 설치 필요(이미 이번 세션에서 설치·실측 완료). `requirements.txt`에 주석으로 설치 경로 기록(T3-1의 torch 주석과 같은 패턴) — PyPI 패키지가 아니라 `pip install -r requirements.txt`만으로는 안 깔림, `wiki/tools.md`의 clone 명령 참조.

## 위험 분류·Codex 검수
"공개 API 변경"(`POST /songs/{id}/transcribe`) + "외부 모델 연동"(ADTOF 서브프로세스) + "스키마 확장"(Pydantic Literal에 값 추가, DB 마이그레이션은 아니지만 검증 규칙 변경) = **위험 작업**. 구현 전 Codex 모드C 설계 검수 진행(T3-1에서 정립된 실패처리 패턴을 처음부터 반영해뒀으니 라운드 수가 줄 것으로 기대하되, 장담하지 않고 실제 검수 받음).

## 테스트 전략
- `midi_to_drumscore.py`: 합성 `pretty_midi.PrettyMIDI` 객체(직접 노트 추가)로 피치 매핑·tick 변환·DrumScoreIn 검증 통과를 단위 테스트. 실제 ADTOF 출력 파일(`data/t0-2-work/MusicDelta_Grunge.mid`, 이미 레포에 있는 Phase 0 산출물은 아님 — `data/`라 git 추적 안 됨, 재현 시 다시 생성 필요)로도 한 번 변환해 258개 음표가 전부 유효한 DrumScore가 되는지 통합 확인.
- `adtof_transcriber.py`: subprocess monkeypatch로 성공/실패 단위 테스트(T3-1 `demucs_separator` 테스트와 같은 패턴).
- `handler.py`: 성공/실패/부분실패 경로(T3-1 `separate_handler` 테스트 세트를 그대로 변형) + **재채보 시 `DRUMSCORE_RAW` 행이 중복 생성 안 됨**(모드C C-002 직접 회귀 테스트 — 같은 Job을 두 번 돌리거나 Asset을 미리 만들어둔 상태에서 핸들러 실행 후 `Asset` 행 개수가 여전히 1개인지 확인) + **`DRUMSCORE_EDITED`가 있으면 재채보 후에도 `GET drumscore`가 여전히 EDITED를 반환**(C-004 의도된 동작 확인).
- `POST /songs/{id}/transcribe`: 인증 필요, STEM_DRUMS 에셋 행도 파일도 없으면 400(C-006), 둘 다 있으면 Job 생성, 다른 사용자 404.
- `worker/runner.py`의 `register_production_handlers()`: `JobType.TRANSCRIBE`가 실제로 등록돼 `get_handler()`로 조회되는지 직접 검증(모드C C-001 회귀 테스트 — 이걸 빠뜨리면 테스트 없이는 "조용히" 안 걸리고 운영 중에만 드러날 뻔했음).
- **실제 end-to-end**: T3-1로 이미 분리해둔 실제 음원(song id=7, `data/songs/7/stem_drums.wav`)으로 실제 ADTOF 돌려 DrumScore 생성 → 생성된 JSON이 `DrumScoreIn`을 통과하는지, 그리고 실제 브라우저 연습 화면이 코드 변경 없이 재생하는지까지 확인(REQ-02 수용 기준 "경로 A: 기준곡 생성 성공"을 진짜 end-to-end로 증명).

## 가정·확인 필요
- `adtof.exe`(pip console-script) 직접 실행이 이 PC에서 막혀 있음(WinError 4551) — `python -m adtof_pytorch.cli`로 우회. 프로덕션 코드는 처음부터 이 방식으로 작성(exe 경로에 의존 안 함).
- 피치→피스 기본 매핑(hihat_closed/tom_mid/crash)은 명시적 추측이며 100% 정확하지 않을 수 있음 — Q-26에 등록, 의뢰인이 Phase 3 게이트에서 실제 정확도를 평가할 때 이 한계를 알고 봐야 함.
- Q-10(셈여림 정확도) 갱신 필요: "미검증"이 아니라 "ADTOF-pytorch CLI가 velocity=100을 하드코딩 — 셈여림 정보 자체가 없음"으로 정정.
- 박자표(`timeSignature`)는 ADTOF가 아예 추정 안 해서 `[4,4]` 고정 — 실제 곡이 다른 박자면 레인의 마디선이 틀릴 수 있음(기존 `DrumScore` 구조적 한계, Q-25와 같은 계열).
