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
- MIDI 드럼 소리는 **실제 드럼 샘플 오디오**(T2-2b, 2026-10-23 교체) — 처음엔 Tone.js 내장 신스였으나 의뢰인이 "실제 소리 같지 않다"고 피드백해 교체.

## 드럼 샘플 교체 (T2-2b, 2026-10-23)
- `drumVoices.ts`: Tone.js 신스 → 실제 WAV 샘플(**Virtuosity Drums**, Versilian Studios/Karoryfer, **CC0**) 재생. 9종 선정 내역·원본 파일명은 `qa-evidence/T2-2b/result.md`.
- Tone.js 공식 문서: 리피치가 필요 없는 재생엔 `Sampler` 대신 `Player`를 쓰라고 명시 — 우리는 항상 같은 음높이로만 재생하므로 `Player` 채택.
- `Tone.Player`는 모노포닉(Source 상속, 실제 타입 정의로 확인)이라 같은 피스가 빠르게 겹치면 이전 소리를 끊고 재시작함 — 트리거마다 **새 Player 인스턴스**를 만들고 끝나면(`onstop`) 스스로 `dispose()`하는 "발사 후 소멸" 패턴으로 자연스러운 겹침(디케이)을 허용.
- `createDrumVoices()`가 fetch+디코딩이 필요해 **동기→비동기**(`Promise<DrumVoiceMap>`)로 바뀜. 일부 샘플만 로드 실패하면 `Promise.allSettled`로 성공분을 전부 `dispose()`하고 에러를 던짐(Codex 모드A C-001).
- `sampleVoice().dispose()`는 재생 중인 Player를 전부 강제 정지·폐기하고 공유 버퍼도 같이 정리함(처음엔 빈 함수였음 — Codex 모드A C-002, 실제로는 항상 아무것도 안 지워지고 있었음).
- 톰은 팩에 실제로 2종(Low/High)뿐이라 우리 스키마의 3종(high/mid/floor)과 안 맞음 — 피치시프트 등 가공 없이 Low Tom의 서로 다른 실제 타법(center=mid, off-center=floor)으로 구분.
- 라이선스: `public/audio/drums/LICENSE.txt` + `intent/03-architecture-stack.md` §4.

## 연습 화면 렌더러 (T2-3, 2026-10-24)
- `app/web/src/render/layout.ts` — 노트 Y좌표, 낙하 속도(`pixelsPerSecond`), 보이는 노트 필터링, 마디/박선, 판정선 히트 판정을 전부 **순수 함수**로 분리(Tone.js·Canvas 의존 없음). `LANES` 상수로 8레인(HH, CR, SN, T1, T2, FT, RD, KK — 하이햇 닫힘/열림이 한 레인 공유)·피스별 모양(`intent/08-design.md` §3)을 정의.
- **jsdom은 Canvas 2D 컨텍스트가 없음**(실제 실행으로 확인 — `document.createElement('canvas').getContext('2d')`가 `null`, "Not implemented" 경고) — T2-2의 Web Audio와 같은 사유. 그래서 `layout.ts`(순수 계산)만 단위 테스트(15개)하고, 실제 그리기(`laneRenderer.ts`, Canvas 2D)와 fps는 **실제 브라우저**로 수동 QA.
- `laneRenderer.ts`: 노트 9종 모양(X/X+원/큰X/마름모/둥근사각형/원/큰원/막대)을 Canvas 2D로 직접 그림. `layout.ts`의 `barBeatLines`는 **반열림 구간**(`[start, end)`)으로 설계 — 닫힌 구간으로 하면 스크롤되는 인접 프레임 창끼리 경계(마디 끝=다음 마디 시작)에서 선이 중복 그려지는 걸 처음엔 못 보고 지나쳤다가 테스트로 발견·수정.
- `PracticeCanvas.tsx`: rAF 루프로 마스터 클록 위치를 매 프레임 읽어 `laneRenderer`+`KitIllustration`(SVG 킷 점등)을 구동. **재생 중일 때만** 활성 피스를 계산 — 재생 여부와 무관하게 항상 계산하면 정지 중(클록 위치 고정) 그 근처 노트가 계속 "히트"로 잡혀 킷이 켜진 채 남는 버그가 있었음(Codex 모드A C-001, 실제 재현 후 `isPlayingRef`로 수정). 상태 전환은 `useEffect` 대신 `handlePlay`/`stopPlayback` 이벤트 핸들러 안에서 직접 수행(oxlint `react(set-state-in-effect)` 규칙).
- **fps 30→60 버그**: 렌더 루프가 매 프레임(최대 60회/초) 새 `Set` 객체로 `setActivePieces`를 호출해, 활성 피스가 안 바뀌는 대부분의 프레임에도 React가 `PracticeCanvas`+`KitIllustration`을 통째로 리렌더하고 있었음(실측 평균 33.3ms/프레임≈30fps). 직전 프레임의 활성 피스 집합을 문자열 키로 캐싱해 내용이 실제로 바뀔 때만 `setState`하도록 수정 — 재검증 평균 16.68ms/프레임(**약 60fps**, `requestAnimationFrame` 180프레임 실측 원자료 `qa-evidence/T2-3/raw_log.txt` §5).
- 드럼킷 일러스트는 `intent/07-open-questions.md` Q-09(의뢰인 디자인 승인 필요, 미해결)에 따라 정밀 그래픽이 아닌 단순 도형(원+글자) placeholder. 폰 세로의 "킷 축소 아이콘"은 완전히 숨김으로 단순화(아이콘 디자인은 범위 밖).
- Codex 모드B가 1차 검수에서 fps·테스트 통과 수치가 QA 증거에 **원자료 없이 요약만** 있어 대조 불가하다고 REQUEST_CHANGES — 실제 명령 출력(`reverify-20261024.txt`)과 fps 실측 JSON(`raw_log.txt` §5)을 보강한 뒤 2차 APPROVE. 교훈: 측정값 주장은 요약 문장만으로는 검수자가 재현·대조할 수 없으므로 원자료를 QA 증거에 항상 같이 남길 것.

## BPM 변경·A-B 루프 (T2-4, 2026-10-24)
- `app/web/src/audio/timing.ts`에 순수 함수 3개 추가: `ticksPerBar`(한 마디의 틱 수), `barIndexForTick`(틱이 속한 마디 번호, 곡 전체 마디 수·루프 입력 범위 제한에 씀), `computePlaybackSchedule`(BPM·카운트인·A-B 루프 설정 → 실제 Transport 스케줄링에 필요한 초 단위 값). 루프가 있으면 카운트인을 곡 맨 앞이 아니라 **루프 시작 바로 앞**에 둬서, 루프 밖 구간을 처음부터 재생하지 않고 곧장 루프 구간으로 진입(`loop.startBar===0`이면 루프 없음과 수식상 동일).
- `scorePlayer.ts`의 `playDrumScore`에 `playbackBpm`(연습 BPM, 기본 `score.meta.bpm`)·`loop`(0-기준 `[startBar,endBar)`) 옵션 추가. `transport.start(undefined, playbackStartSeconds)`로 재생 시작 위치를 직접 지정(루프가 중간 마디부터면 그 위치부터 바로 시작).
- **A-B 루프는 Tone.js Transport의 네이티브 `loop`/`loopStart`/`loopEnd`를 그대로 사용** — 커스텀 재스케줄링 로직 없음. 근거(실제 설치된 버전 v15.1.22의 소스, `node_modules/tone/build/esm/core/clock/`로 직접 확인):
  - `Transport.js` `_processTick()`: 루프 중 `ticks>=loopEnd`가 되면 클록 틱을 `loopStart`로 되돌리고 `_timeline.forEachAtTime(ticks,...)`로 그 위치의 이벤트를 호출 — `transport.schedule()`(드럼 노트·카운트인 클릭)로 예약한 이벤트는 `once:true`가 아닌 한 호출 후에도 제거되지 않아(`TransportEvent.invoke()`) 루프가 같은 위치를 다시 지나갈 때 자동 재발화.
  - `TransportRepeatEvent.js`(`scheduleRepeat()`, 메트로놈이 씀)는 `transport.on("loopStart", this._boundRestart)`로 루프 시작을 직접 구독해 다음 이벤트들을 재계산·재스케줄 — 끊김·중복 없이 이어짐.
  - 실제 브라우저로 16마디 중 2~3마디만 루프해 18초(~4.5바퀴) 재생, 콘솔 에러 0건으로 재확인.
- `laneRenderer.ts`의 `render()`에 `playbackBpm` 선택 인자 추가(기본 `score.meta.bpm`) — 연습 BPM을 낮추면 레인 낙하 속도도 실제로 느려짐.
- `PracticeCanvas.tsx`: BPM 슬라이더+숫자 입력(원곡 대비 50~150%), A-B 루프 켜기/끄기+마디 입력(UI는 1-기준, 내부는 0-기준), 마디 진행바. `playbackBpmRef`/`loopRef`로 rAF 루프가 리렌더 없이 최신 설정을 읽음(ref를 렌더 중 직접 쓰면 oxlint `react(refs)`가 걸려 effect에서 동기화).
  - **Codex 모드A C-001(수정됨)**: 진행바가 루프 중에도 "곡 전체 대비"로 계산되면, 긴 곡의 짧은 루프(예: 16마디 중 2마디)는 진행바가 좁은 구간(12.5~18.75%)에서만 움직여 거의 멈춘 것처럼 보임 — 루프가 켜져 있으면 "루프 구간 안에서의 위치"(0~100%)로 계산하도록 변경.
  - 재생 중엔 BPM·루프 입력을 `disabled={isPlaying}`로 잠금(Codex 모드B 권장) — 이미 시작한 재생은 재생 시작 시점 값으로만 스케줄돼 있어, 재생 중 바꿔도 지금 재생엔 반영 안 됨.
- "오디오 트랙은 음정 유지 상태로 속도 변경"(REQ-04)은 Phase 2엔 분리된 원곡 오디오 트랙이 아직 없어(Demucs 분리는 Phase 3 T3-1) 범위 밖 — MIDI는 속도를 바꿔도 음정이 안 변해 적용 대상 자체가 없음. `preservesPitch` 채택(Q-04)은 실제 오디오 엘리먼트가 생기는 T3-3에서 적용 예정.

## 라이브러리·업로드·로그인 (T2-5, 2026-10-24)
이번 작업에서 프론트(`app/web`)와 백엔드(`app/server`)가 실제로 처음 통신하게 됐다 — T2-1~T2-4는 전부 프론트 단독 데모였다. "공개 API 변경"(위험 작업, `intent/06-pipeline.md` §1-1)이라 구현 전 Codex 모드C 설계 검수 3회를 거쳤다.

- **파일 저장**: `app/server/file_storage.py` — `PROJECT_ROOT/data/songs/<song_id>/`(루트 `data/`, `intent/03-architecture-stack.md` §5 명시 경로, 이미 `.gitignore` 대상). `db/session.py`의 `PROJECT_ROOT` 계산 패턴을 그대로 따름(`Path(__file__).resolve()`로 cwd 무관). **업로드 원본 파일명은 신뢰하지 않음** — 서버가 고정 파일명(`original<ext>`, `drumscore.json`)을 생성해 디스크 경로 구성에 사용자 입력이 전혀 안 섞이게 함(Codex 모드C C-001). `Asset.file_path`를 실제 파일 경로로 바꿀 때(읽기)와 새 파일을 쓸 때(쓰기) 양쪽 다 `Path.is_relative_to()`로 저장소 루트 이탈을 재검증 — `db/models.py`의 Asset `CheckConstraint` 주석이 "DB 레벨 최소 방어선, 실제 파일 접근 시 재검증 필요"라고 요구한 바로 그 코드.
- **DrumScore 업로드 검증**: `app/server/api/schemas.py`(Pydantic) — 구조뿐 아니라 핵심 수치 불변식도 검증(Codex 모드C C-002): `meta.bpm`(유한한 양수 — `audio/timing.ts`의 `secondsPerBeat(bpm)=60/bpm`이 나누기 때문에 0 이하·비유한이면 Infinity/NaN이 전파됨), `ppq`(양의 정수), `meta.timeSignature`(둘 다 양의 정수), `audioOffsetMs`(유한), `notes[].velocity`(0~127), `piece`(9종 `Literal`, TS 타입과 수동 동기화). **의미 검증 전체(T1-5 `validate.ts`의 모든 규칙)까지는 재구현 안 함** — 로그인한 소유자 1인만 자기 데이터를 올리는 비공개 서비스 규모에 맞춘 선. 업로드 핸들러는 파일을 1MB 청크로 읽으며 20MB 상한을 넘는 순간 즉시 멈춤(전체를 다 읽고 나서 거부하지 않음 — Codex 모드B 지적, `UploadFile.read()` 호출 횟수를 직접 세는 테스트로 조기 중단을 실측 증명).
- **인증**: T1-3에서 이미 구현된 세션 쿠키 로그인(아이디/비밀번호)에 프론트 화면만 새로 연결(`features/auth/LoginScreen.tsx`). Google OAuth 전환은 Q-20으로 별도 작업 연기 — 이미 병합된 T1-3 구조를 바꾸는 작업이라 "라이브러리 화면" 범위 밖으로 판단.
- **CORS 없이 Vite 프록시로 해결**: `vite.config.ts`의 `server.proxy`가 `/api`를 FastAPI로 전달 — 브라우저 입장에서 전부 동일 출처 요청이 되어 CORS 설정도, 크로스 포트 쿠키 문제도 생기지 않음. 로그인 쿠키가 `secure=True`인데, `http://localhost`는 W3C "potentially trustworthy origins" 예외로 Secure 쿠키를 지원한다는 전제로 이 설계를 채택 — 실제 브라우저에서 인증 호출 성공으로 검증. **비-localhost(Tailscale 등) 원격 접속에선 이 전제가 깨짐** — REQ-07 "폰에서 보임"은 이번엔 localhost 멀티세션+서버 프로세스 재시작(실제로 종료 후 재시작해 데이터가 디스크에 남아있는지 확인)으로만 검증, 진짜 원격 다중기기 검증은 Phase 5(Tailscale HTTPS 인프라) 게이트 항목으로 미룸.
- **화면 전환**: 라우팅 라이브러리 없이 `App.tsx`가 `screen` 상태(`login`/`library`/`upload`/`practice`)로 전환 — 화면 4개뿐이고 URL 딥링크 요구사항이 없어 당장은 과한 설계라고 판단. 나중에 URL 공유·뒤로가기가 필요해지면 재검토 필요(Codex 모드C 리스크 의견으로 기록해둠).
- **업로드→재생 연결**: 라이브러리에서 곡을 클릭하면 `GET /songs/{id}/drumscore`로 서버가 저장한 DrumScore를 가져와 T2-3/T2-4가 만든 `PracticeCanvas`에 그대로 넘긴다 — 이 연결로 T2-1(가져오기)·T2-2~T2-4(오디오 엔진·레인·BPM)가 비로소 실제 영속 데이터로 동작하는 것을 확인했다(실제 FastAPI 서버 재시작 전후로 재생까지 전체 플로우 확인).

## 드럼 편집기 (T2-6, 2026-10-24)
피아노롤 방식 편집기. "DB 스키마 변경(부분 유니크 인덱스)+공개 API 추가"(위험 작업)라 구현 전 Codex 모드C 설계 검수 3회를 거쳤다.

- **격자 수학**: `app/web/src/features/editor/grid.ts` — `GridUnit = '4n'|'8n'|'16n'|'8nt'`(8분음표 셋잇단 포함), `ticksPerGridUnit(unit, ppq) = ppq / {4n:1,8n:2,16n:4,'8nt':3}[unit]`. **ppq가 분할 수로 나누어떨어지지 않으면(예: ppq=100에 '8nt') 비정수 틱이 나올 수 있어**(Codex 모드A 지적, 실제 재현됨 — `score/validate.ts`가 정수 틱만 허용) `snapTick`이 최종 결과를 반올림하고, `EditorScreen.tsx`의 방향키 이동도 반드시 `snapTick`을 거치도록 함(직접 덧셈 금지).
- **행 구성**: `EDITOR_ROWS`(9행, 하이햇 닫힘/열림을 별도 행으로 분리 — T2-3 `LANES`의 8레인과 다름, 편집기는 정밀한 피스 지정이 필요하기 때문). 행 레이블은 `position: sticky`로 가로 스크롤과 무관하게 항상 보이게 함(수동 QA 중 발견한 버그 — 악보를 못 읽는 사용자에게 레이블이 유일한 행 식별 수단이라 치명적이었음).
- **실행취소/다시실행**: `editHistory.ts` — `{past, present, future}` 스냅샷 방식, `MAX_HISTORY=100`(REQ-03 요구 ≥20보다 여유 있게).
- **노트 식별**: `DrumScore`/`DrumNote`엔 안정적인 id가 없어 편집기 내부에서만 쓰는 `EditableNote { ..._editorId: number }`를 로드 시 순차 부여, 저장 직전 destructuring으로 제거.
- **편집기는 Canvas가 아니라 DOM/SVG** — T2-3(Canvas 2D)·T2-2(Tone.js/Web Audio)와 달리 jsdom이 못 구현하는 API에 의존하지 않아, 유일하게 React Testing Library로 클릭·키보드 조작까지 jsdom에서 직접 테스트 가능(`EditorScreen.test.tsx`). 키보드 단축키(방향키/Delete/1·2·3)는 그리드 컨테이너(`tabIndex=0`)에만 바인딩 — BPM/박자표 입력창에 포커스가 있을 때는 이벤트가 거기까지 버블링되지 않아 자동으로 격리됨(별도 "input이면 무시" 분기 불필요).
- **저장 API**: `PUT /songs/{id}/drumscore` — `get_owned_song`·`DrumScoreIn`(T2-5와 동일 모델) 재사용. 기존 `DRUMSCORE_EDITED` Asset을 조회해 있으면 UPDATE, 없으면 INSERT하되 **DB 레벨 부분 유니크 인덱스**(`Asset(song_id) WHERE kind='drumscore_edited'`, `sqlite_where`)로 동시 요청 간 중복 삽입을 막고, `IntegrityError` 발생 시 `db.rollback()` 후 재조회→UPDATE로 복구(ORM 세션은 rollback 없이 추가 쿼리 시 `PendingRollbackError`가 남을 실제 실행으로 확인). 전역 `(song_id, kind)` 유니크가 아니라 `DRUMSCORE_EDITED`에만 범위를 한정한 이유: Phase 4의 `SHEET_IMAGE`가 곡당 여러 행을 가져야 함.
- **파일 쓰기 원자성**: `file_storage.write_song_file()`을 같은 디렉터리+요청별 고유(`uuid4`) 임시파일명으로 재작성(`Path.replace()`는 같은 디렉터리/볼륨 안에서만 원자적) — T2-5의 업로드 경로도 같은 함수를 공유해 함께 강화됨.
- **편집→연습 연동**: `fetchSongDrumScore()`를 편집기·연습 화면이 동일하게 사용, `GET /songs/{id}/drumscore`가 T2-5에서 구현한 DRUMSCORE_EDITED 우선 로직을 그대로 타 저장한 편집본이 `PracticeCanvas`에도 반영됨을 확인(T2-5↔T2-6 end-to-end 최초 연결 확인).

## 아직 없는 것 (다음 작업)
- 큐에 작업을 넣는 공개 API(업로드 트리거), 실제 처리 핸들러(Demucs/ADTOF/Audiveris) 등록 — Phase 3/4
- 스티킹(hand 필드, 자동 추천, 편집기 일괄 교대, 레인·킷 R/L 표시) — T2-7
- 편집기 마우스 드래그 이동, 곡 중간 템포변경, OMR 원본 대조 패널 — 범위 밖으로 명시 보류(`work/T2-6/plan.md` §범위)
- REQ-04 공식 ±30ms 측정(Q-05) — 분리 오디오 트랙(Phase 3)과 BPM UI 모두 있어야 가능
- 관리자 콘솔 UI 없음(API만) — 계정 생성은 지금은 API 직접 호출 필요
