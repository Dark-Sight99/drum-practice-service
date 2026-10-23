> 한 줄 요약: 현재 코드 구조와 각 영역의 실행 방법. 새 작업 시작 전 이 파일부터 확인.

# 아키텍처 현황

## 구조 (T1-1, 2026-10-23)
```
app/web/      Vite + React 19 + TypeScript. PWA(vite-plugin-pwa). 린트=oxlint, 포맷=Prettier, 테스트=Vitest+Testing Library
  src/
    features/{practice,library,editor,mixer,auth}/   화면별 기능(아직 빈 폴더, Phase 2+에서 채움)
    audio/ render/ score/ offline/                    공용 모듈(아직 빈 폴더)
    styles/tokens.css                                 디자인 토큰 — 색·폰트·간격은 여기 한 곳에만(intent/08-design.md §7)

app/server/   FastAPI(Python). 자체 .venv(루트 .venv는 Phase 0 스파이크 전용, 건드리지 않음). 린트=ruff, 테스트=pytest
  api/            FastAPI 앱(현재 /health만)
  worker/         작업 큐 워커(Phase 1 T1-4에서 구현)
  modules/{separator,transcriber,omr,importer}/   REQ-01/02 처리 모듈(인터페이스로 교체 가능하게 설계 예정, 03-architecture-stack.md §1)
  db/             SQLAlchemy 2.0 모델(models.py) + 세션 팩토리(session.py) — T1-2 완료
  alembic/        DB 마이그레이션(초기 리비전 1개)
  storage/        (현재 미사용 — 실제 DB/파일은 루트 data/ 아래. 용도 생기면 채움)

data/         (git 제외) 사용자 음원·악보, Phase 0 스파이크 산출물
qa-evidence/<작업ID>/   QA 증거
work/<작업ID>/          작업 plan.md·report.md
wiki/          이 폴더(architecture.md, decisions.md, tools.md)
logs/          기획 대화·Codex 검수 로그
```

## 실행 방법
```bash
# web
cd app/web
npm install   # 최초 1회
npm run dev       # 개발 서버
npm run lint       # oxlint
npm run test       # vitest
npm run build      # tsc + vite build (PWA 서비스워커 포함)
npm run format     # prettier --check

# server
cd app/server
python -m venv .venv   # 최초 1회
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m pytest
```

## DB 스키마 (T1-2, 2026-10-23)
5개 테이블: `users`(계정, is_admin/is_active), `songs`(user_id로 소유, status/needs_review), `assets`(song_id, kind, file_path), `jobs`(user_id+song_id 복합 FK — 다른 사용자 곡 참조 DB 레벨에서 차단), `practice_settings`(song_id 1:1).
- SQLite FK는 `db/session.py`의 `create_sqlite_engine()`으로 연결마다 `PRAGMA foreign_keys=ON` 켜야 동작(기본은 꺼져 있음 — 실제 재현 확인됨).
- enum 컬럼은 `str_enum_column()` 헬퍼로 `.value`(소문자) 저장(기본은 `.name`을 저장해 대문자가 됨 — 실제 재현 확인됨).
- `assets.file_path`는 CHECK 제약으로 `..`/절대경로(`/`,`\`,드라이브 문자)를 막음(완전한 경로 검증은 아님, Phase 3 파일 저장 코드에서 보강 필요).
- 마이그레이션: `cd app/server && ./.venv/Scripts/python.exe -m alembic upgrade head`

## 인증/세션 (T1-3, 2026-10-23)
- 비밀번호: argon2(`auth/security.py`). 세션: 서버 사이드(`user_sessions` 테이블), 쿠키엔 무작위 토큰만, DB엔 SHA-256 해시만 저장.
- `api/deps.py`의 `get_current_user`가 **요청마다** `is_active`를 재확인 — 관리자가 계정을 정지하면 이미 로그인된 세션도 다음 요청부터 바로 막힘(REQ-08 "즉시" 요구사항).
- 로그인 실패(아이디 없음/비밀번호 틀림/계정 정지) 응답은 **내용과 처리 비용을 전부 동일하게** 맞춤 — 계정 존재·상태가 새지 않도록(더미 argon2 해시로 상수 비용 유지).
- 엔드포인트: `POST /auth/login`·`/logout`, `GET /auth/me`, `POST /admin/users`·`PATCH /admin/users/{id}`(관리자 전용, 가입 화면 없음), `GET /songs`·`/songs/{id}`(로그인한 사용자 자신의 곡만 — 다른 사용자 곡은 403이 아니라 404).
- 쿠키는 `httponly`+`secure`+`samesite=lax` — 로컬 테스트 시 `TestClient(app, base_url="https://testserver")`로 HTTPS를 시뮬레이션해야 쿠키가 왕복함(http://testserver 기본값으로는 secure 쿠키가 전송 안 됨).

## 작업 큐 워커 (T1-4, 2026-10-23)
- API 서버(uvicorn)와는 별개 프로세스: `cd app/server && ./.venv/Scripts/python.exe -m worker.runner`(무한 루프) 또는 `--once`(하나만 처리, 수동 QA용).
- `worker/runner.py`: `_claim_next_job()`이 `UPDATE ... WHERE id=? AND status='queued'` 단일 문장으로 작업을 원자적으로 선점 — 워커 프로세스를 2개 이상 띄워도 같은 작업을 이중 처리하지 않음(Codex 모드A C-001, 실제 재현 후 수정). 시작 시 `recover_orphaned_jobs()`가 `PROCESSING`으로 멈춰있는 작업을 전부 `FAILED` 처리(재시작 복구) — 단, 워커 소유자를 구분하지 않아 **워커를 2개 이상 동시에 운영하면** 안전하지 않음(Q-17, 지금은 "워커 1개만 운영"이 전제).
- `worker/handlers.py`: `JobType -> Callable[[Job], None]` 레지스트리, 지금은 비어 있음 — 등록된 핸들러가 없는 작업은 크래시 없이 "구현 안 됨"으로 FAILED 처리(실제 Demucs/ADTOF/Audiveris 연결은 Phase 3/4).
- `db/session.py`의 `SessionLocal`은 `expire_on_commit=False` — 기본값(True)이면 세션을 닫은 뒤 ORM 객체 속성에 접근할 때 `DetachedInstanceError`가 남(실제로 `worker.runner --once`를 독립 서브프로세스로 돌리다 재현됨 — pytest의 `TestClient`/직접 세션 호출 방식은 이 패턴을 안 건드려서 못 잡았음).
- 엔드포인트: `GET /jobs`(내 작업 목록), `GET /jobs/{id}`(다른 사용자 작업은 404 — songs.py와 동일 원칙). 큐에 작업을 **넣는** API는 아직 없음(업로드 플로우가 Phase 3 범위).

## DrumScore 타입·GM 매핑 (T1-5, 2026-10-23)
- `app/web/src/score/`(TypeScript) — "모든 화면이 이 형식만 읽음" 원칙 + 경로C(MIDI/MusicXML/GP)가 `@tonejs/midi`·alphaTab로 브라우저에서 처리되므로 이쪽에 둠. 경로A(ADT)·B(OMR)의 Python 생성 로직은 Phase 3/4에서 이 타입과 교차 검증.
- `types.ts`: `DrumPiece`(9종: kick/snare/hihat_closed·open/tom_high·mid·floor/crash/ride), `DrumScore`(version/meta/notes/ppq/audioOffsetMs).
- `gmMapping.ts`: `PIECE_TO_GM_NOTE`/`GM_NOTE_TO_PIECE`(양방향) — General MIDI Level 1 퍼커션 키맵 공식 문서로 재확인(값 전부 일치, `qa-evidence/T1-5/result.md` 참고).
- `validate.ts`: `validateDrumScore`가 예외를 절대 던지지 않고 `{valid, errors}` 반환(REQ-02 "부분 인식도 크래시 없이 진입") — 필드 접근 중 예외(예: getter)가 나도 try/catch로 흡수(Codex 모드A C-001, 실제 재현 후 수정).

## 디지털 악보 가져오기 (T2-1, 2026-10-23)
- `app/web/src/score/import/` — MIDI(.mid)/MusicXML(.musicxml/.mxl)/Guitar Pro(.gp/.gp3~.gp5/.gpx)를 DrumScore로 변환.
- 핵심 설계: alphaTab(`importer.ScoreLoader.loadScoreFromBytes`)으로 MusicXML/.mxl/GP를 파싱 → alphaTab 자신의 `midi.MidiFileGenerator`+`midi.AlphaSynthMidiFileHandler`로 표준 MIDI 바이너리 재수출 → `@tonejs/midi`로 재파싱 — `.mid` 직접 가져오기와 **같은 변환기**(`midiEvents.ts`의 `midiToDrumScore`)로 합류. 틱·템포·타이 계산을 alphaTab에 전부 맡김.
- 퍼커션 트랙 판별: `track.instrument.percussion`(=`channel===9`, @tonejs/midi 소스로 확인). GM 노트 번호는 T1-5의 `GM_NOTE_TO_PIECE`로 변환 — 9종 밖 노트(카우벨 등)는 임의로 끼워 맞추지 않고 건너뛰며 `unmappedNoteCount`로 집계.
- `importScoreFile(bytes, filename)`이 확장자로 라우팅하는 통합 진입점. 손상된 파일은 두 파서 모두 예외를 던지는 것을 실제 확인했기에 try/catch로 감싸 `{ok:false}` 반환(크래시 없음).
- 실제 검증: MusicXML은 `qa-evidence/T0-4/drum_test.musicxml`(Phase 0 샘플). GP는 그 샘플을 alphaTab의 `Gp7Exporter`로 실제 GP7 바이너리로 만들어 왕복 검증(사람이 만든 파일은 아님 — Q-18 부분 해소).

## 오디오 엔진 (T2-2, 2026-10-23)
- `app/web/src/audio/` — 마스터 클록(Tone.js Transport 래퍼)·MIDI 드럼 신스·메트로놈·카운트인.
- **jsdom은 Tone.js(Web Audio API)를 전혀 지원 안 함**(실제 실행으로 확인 — `Tone.getTransport()`가 예외 없이 "객체"를 반환하지만 내부적으로 깨져 있고, `new Tone.MembraneSynth()`는 바로 예외). 그래서 `timing.ts`(틱→초, 박/마디 계산)만 Tone 의존 없는 순수 함수로 분리해 단위 테스트하고, `clock.ts`/`drumVoices.ts`/`metronome.ts`/`scorePlayer.ts`(Tone.js를 실제로 쓰는 코드)는 **실제 브라우저로 수동 QA**.
- `scorePlayer.ts`: 노트를 Transport의 틱 체계(기본 PPQ=192)가 아니라 DrumScore 자신의 ppq로 초 단위를 직접 계산해 예약(PPQ 불일치 회피). 재생 시작 전 항상 `transport.stop(); transport.position = 0` — 메트로놈을 먼저 돌리다 멈춘 뒤 재생하면 노트가 전부 과거 시각에 예약돼 무음이 되는 실제 버그를 수동 QA로 발견·수정.
- `transport.timeSignature`에는 분자만 넘기면 안 됨(4가 아닌 분모에서 마디 길이가 틀어짐, 예: 6/8을 6으로 넘기면 Transport가 6/4로 취급 — Codex 모드A C-001, 실제 재현 후 수정) — 항상 `[분자,분모]` 배열 전체를 넘긴다.
- `metronome.ts`의 강박 판정은 `Transport.getTicksAtTime()`으로 그 순간의 절대 틱을 읽어 계산(로컬 카운터 방식은 Transport가 마디 경계 아닌 위치에서 이미 돌고 있으면 틀어짐 — Codex 모드A C-002).
- MIDI 드럼 소리는 Tone.js 내장 신스(합성음), 실제 샘플 오디오 아님 — 음색 승인 필요(Q-19).

## 아직 없는 것 (다음 작업)
- 큐에 작업을 넣는 공개 API(업로드 트리거), 실제 처리 핸들러(Demucs/ADTOF/Audiveris) 등록 — Phase 3/4
- 파일 선택 UI(input/드래그앤드롭), 가져온 DrumScore의 서버 저장(원본+편집본) — T2-5(라이브러리 화면)
- BPM 슬라이더·A-B 루프(T2-4), 연습 화면 렌더러가 마스터 클록에 동기화(T2-3)
- REQ-04 공식 ±30ms 측정(Q-05) — 분리 오디오 트랙(Phase 3)과 BPM UI 모두 있어야 가능
- 실제 화면(연습·라이브러리·편집·믹서)은 Phase 2부터
- 관리자 콘솔 UI 없음(API만) — 계정 생성은 지금은 API 직접 호출 필요
