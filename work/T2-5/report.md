> 한 줄 요약: 라이브러리 화면(목록/검색/이름변경/삭제)·디지털 악보 업로드(MIDI/MusicXML/GP) 구현. 이번 작업에서 프론트와 백엔드의 실제 통합을 구현·확인 — 로그인 화면(간단 아이디/비밀번호)·업로드 API·파일 저장을 전부 새로 만들었고, 구현 전 Codex 모드C 설계 검수 3회를 거쳤다. 실제 서버+브라우저로 업로드→서버 재시작 후에도 영속→실제 재생까지 전체 플로우 확인.

# T2-5 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/server/file_storage.py`(신규) | `data/songs/<song_id>/` 저장 경로 계산, 고정 파일명 생성, 읽기/쓰기 양쪽 경로조작 재검증 | REQ-07, Codex 모드C C-001 |
| `app/server/api/schemas.py`(신규) | 업로드 DrumScore JSON의 구조+수치 불변식 Pydantic 검증 | REQ-02, Codex 모드C C-002 |
| `app/server/api/songs.py`(확장) | `POST/PATCH/DELETE /songs`, `GET /songs/{id}/drumscore` 추가, `SongOut`에 `original_bpm`·`source_type` 추가, 소유자 검사 공용화(`get_owned_song`) | REQ-07, REQ-08 |
| `app/server/tests/test_songs_upload_api.py`(신규) | 테스트 26개 | work/T2-5/plan.md 테스트계획 |
| `app/web/vite.config.ts` | `/api` → FastAPI 개발 프록시 | REQ-08, CORS 회피 설계 |
| `app/web/src/api/{client,auth,songs}.ts`(신규) | 백엔드 호출 공통 래퍼·로그인·곡 API 클라이언트 | REQ-07, REQ-08 |
| `app/web/src/features/auth/LoginScreen.tsx`(신규) | 아이디/비밀번호 로그인 화면 | REQ-08, Q-20 |
| `app/web/src/features/library/{LibraryScreen,filterSongs}.tsx/ts`(신규) | 곡 목록·검색·이름변경·삭제·업로드 진입·재생 진입 | REQ-07 |
| `app/web/src/features/upload/UploadScreen.tsx`(신규) | 파일 파싱(T2-1 재사용)→검증→업로드 | REQ-07, REQ-02 |
| `app/web/src/App.tsx`(교체) | 화면 전환 셸(로그인/라이브러리/업로드/연습) | work/T2-5/plan.md §설계 3 |

## 범위 결정
`intent/05-todo.md` T2-5는 "라이브러리 화면·업로드 (REQ-07)"만 명시하지만, REQ-08(로그인)의 프론트 화면이 계획에 아예 없던 것을 설계 중 발견 — 의뢰인에게 확인 후(Q-20) 간단 아이디/비밀번호 로그인으로 이번에 같이 구현(Google OAuth는 별도 작업으로 연기). 음원/종이 악보 업로드 선택 UI, 연습 설정 서버 저장, 메트로놈 UI, CORS 미들웨어는 범위 밖 — 상세 근거는 `work/T2-5/plan.md` §범위.

## 구현 근거 (실행 결과로 확인)
- **이 작업은 "공개 API 변경"(위험 작업)이라 구현 전 Codex 모드C(설계 검수) 3회를 거쳤다**(`qa-evidence/T2-5/codex-modeC.md`, `-2.md`, `-3.md`) — 1차 REQUEST_CHANGES(업로드 파일명 미신뢰, DrumScore 수치 불변식 검증, Secure 쿠키 비-localhost 한계 등) → 반영 → 2차는 테스트 계획 누락 지적 → 반영 → 3차 "진행 가능". 코드는 이 설계를 그대로 구현.
- **업로드 파일명 미신뢰(C-001)**: `file_storage.write_song_file()`이 사용자가 보낸 원본 파일명을 디스크 경로 구성에 전혀 쓰지 않고 서버가 `original<ext>`/`drumscore.json` 고정 파일명을 생성 — 실제 브라우저로 업로드 후 `data/songs/<id>/`를 직접 확인해 검증(`qa-evidence/T2-5/result.md`).
- **DrumScore 수치 불변식(C-002)**: `app/web/src/audio/timing.ts`의 `secondsPerBeat(bpm) = 60/bpm` 등 거의 모든 타이밍 계산이 bpm으로 나누므로, bpm이 0 이하거나 비유한이면 Infinity/NaN이 전파됨을 실제 코드로 확인 후 서버 Pydantic 모델에 유한·양수 검증 추가. pytest 12개 케이스로 개별 검증.
- **쿠키 Secure 속성(C-003)**: `app/server/api/auth.py`의 로그인 쿠키가 `secure=True`임을 확인 — `http://localhost`가 W3C "potentially trustworthy origins"의 예외로 Secure 쿠키를 지원한다는 전제로 Vite 프록시 설계를 채택했고, 실제 브라우저에서 `/api/songs` 인증 호출이 성공함으로 검증했다(근거: 실제 호출 성공, `qa-evidence/T2-5/raw_log.txt`).
- **Tone.js·Canvas 2D 의존 코드가 아니라 네트워크 I/O가 핵심이라 jsdom 한계와는 다른 이유로 수동 QA가 필요**: 실제 FastAPI 서버 프로세스를 띄우고 실제 HTTP 요청을 주고받는 통합 동작(세션 쿠키, 멀티파트 업로드, 파일 영속성)은 vitest의 jsdom 환경만으로 검증할 수 없어 실제 브라우저+실제 서버로 확인.
- `python-multipart` 패키지가 설치돼 있지 않아(`pip list`로 직접 확인) `requirements.txt`에 추가하고 설치.

## 실행한 검증
`qa-evidence/T2-5/result.md`, `raw_log.txt` — 프론트 tsc/oxlint/prettier/vitest(81/81), 백엔드 ruff/pytest(66/66, C-001 NaN 검증+업로드 조기중단 회귀 테스트 반영) 전부 PASS. 실제 FastAPI 서버+브라우저로 MIDI/MusicXML/GP 3종 업로드, 서버 프로세스 재시작 후 영속성 확인, 실제 재생, 이름변경, 검색, 삭제(파일 실제 제거 확인), 로그아웃/비로그인 차단 확인.

## Codex 모드A 검수 반영
`qa-evidence/T2-5/codex-modeA.md` — 판정 REQUEST_CHANGES, 필수 수정 1건(C-001).

- **C-001(재현됨, 수정 완료)**: `schemas.py`의 `audioOffsetMs` 검증이 `value in (inf, -inf)` 비교를 썼는데, 이 비교는 NaN을 못 거른다(NaN은 IEEE 754 특성상 어떤 값과도 `==`/`in`이 성립 안 함). 실제로 pydantic-core의 JSON 파서가 `NaN` 리터럴 토큰을 파싱해 필드 값으로 통과시킴을 직접 실행으로 확인 — 실제 버그. `bpm`·`audioOffsetMs` 둘 다 `math.isfinite()`로 통일해 수정.
- 재검증: NaN `audioOffsetMs`를 실제로 보내는 pytest 추가(`test_upload_rejects_nan_audio_offset`) — 422 거부 확인. 수정 후 ruff/pytest 재실행 — 전부 클린, 65/65 통과.

## Codex 모드B 검수 반영
1차 REQUEST_CHANGES: report.md/result.md의 테스트 통과 수가 C-001(NaN) 수정 전 수치로 남아 raw_log.txt의 최신 결과와 불일치(C-001, 필수). 2차에서 문서의 다른 곳(요약 줄·결과 표)에 남아있던 이전 수치 표기를 전부 최신(65/65)으로 수정.
권장 C-002(2라운드 끝에 반영 완료): 업로드 핸들러가 `file.read()`를 인자 없이 호출해 20MB 제한을 검사하기 전에 파일 전체를 메모리로 읽고 있었음 — 1MB 청크 단위로 읽으며 상한 초과 시 즉시 중단하도록 수정. 1라운드에서 "기존 오버사이즈 테스트로 검증했다"고 적었으나, 그 테스트의 입력(100바이트)이 청크 크기보다 작아 조기 중단을 실제로 증명 못 한다는 모드B 2차 지적이 맞아 `UploadFile.read()` 호출 횟수를 직접 세는 새 테스트(`test_upload_oversized_file_stops_reading_early`)를 추가해 보강.

## 가정
- 업로드 화면은 디지털 악보 파일 선택기 하나만(음원/사진 선택 UI는 Phase 3/4).
- 검색은 서버 API 없이 클라이언트 쪽 필터.
- `drumscore` JSON은 구조+핵심 수치 불변식만 검증, 전체 의미 검증은 브라우저를 신뢰.
- 삭제는 완전 삭제(휴지통 없음).
- REQ-07 "폰에서 보임"은 localhost 멀티세션+서버 재시작으로 검증, 실제 원격 다중기기는 Phase 5 게이트 항목.
- 최초 관리자 계정 생성은 수동(Q-21, 부트스트랩 자동화는 범위 밖).

## 질문
- 없음(Q-20, Q-21로 등록해 해소).

## 남은 문제
- T2-6(편집기)이 `DRUMSCORE_EDITED` 자산을 만들면 `GET /songs/{id}/drumscore`가 이미 그걸 우선하도록 설계돼 있어 추가 변경 없이 연결될 것으로 예상(재확인 필요).
- Google OAuth 로그인 전환(Q-20).
- 최초 관리자 계정 부트스트랩(Q-21).
- REQ-07 "폰" 실제 원격 검증(Phase 5, Tailscale HTTPS).
- 연습 설정(BPM/볼륨/루프) 서버 저장, 메트로놈 켜기/끄기 UI(믹서, T3-4).
