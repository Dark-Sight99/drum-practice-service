> 한 줄 요약: T2-5 — 라이브러리 화면(목록/검색/이름변경/삭제)·디지털 악보 업로드. 이 프로젝트 최초로 프론트가 백엔드와 실제로 통신하는 작업이라 로그인 화면(간단 아이디/비밀번호, Q-20)·파일 저장 경로·API 설계를 전부 새로 함 — "공개 API 변경"(위험 작업)이라 구현 전 Codex 모드C 설계 검수 대상.

# T2-5 계획

## 목표
`intent/05-todo.md` T2-5: "라이브러리 화면·업로드 (REQ-07)".

## 근거
- REQ-07: 곡 목록(제목/아티스트/원곡 BPM/입력 경로/처리 상태), 업로드/이름변경/삭제/검색, 곡별 저장(원본 파일·DrumScore·연습 설정). 수용 기준: "PC에서 올린 곡이 폰에서 목록에 보이고 재생됨".
- REQ-08: 로그인 없이는 어떤 곡 데이터에도 접근 불가. 백엔드는 T1-3에서 이미 구현(세션 쿠키)되어 있으나 **프론트 로그인 화면이 계획에 없었음** — 금일 대화로 발견, 의뢰인이 "일단 아이디/비밀번호로 T2-5 진행, Google 로그인은 나중에 별도 작업"으로 결정(Q-20, `intent/07-open-questions.md`).
- REQ-02: 세 경로 모두 DrumScore로 수렴. Phase 2는 경로 C(디지털 악보: MIDI/MusicXML/GP)만 — T1-5 결정대로 **브라우저가 파싱**(alphaTab, T2-1에서 이미 구현·검증됨)하고, 서버는 파싱 결과(JSON)와 원본 파일을 그대로 저장만 한다. 서버 쪽 파싱 재구현 없음.

## 범위 — 다룸 / 안 다룸
**다룸**
- 로그인 화면(아이디/비밀번호, 최소 디자인) — REQ-08 수용 기준을 실제 브라우저에서 확인하려면 필수.
- 라이브러리 화면: 곡 카드 목록(제목/아티스트/원곡 BPM/입력 경로/상태), 검색(클라이언트 쪽 필터 — 아래 "설계" §검색 참고), 이름 변경, 삭제, 업로드 버튼.
- 업로드 화면: 디지털 악보 파일(.mid/.midi/.musicxml/.mxl/.gp/.gp3~5/.gpx) 선택 → 브라우저에서 T2-1 `importScoreFile()`로 파싱 → 제목/아티스트 입력 → 업로드.
- 백엔드: `POST /songs`(업로드), `PATCH /songs/{id}`(이름변경), `DELETE /songs/{id}`(삭제), `GET /songs/{id}/drumscore`(재생용 DrumScore 조회). 기존 `GET /songs`·`GET /songs/{id}`(T1-2에서 읽기전용으로 이미 구현)는 응답에 `original_bpm`·`source_type` 추가해 REQ-07 목록 요구사항 충족.
- 파일 저장: `data/songs/<song_id>/`(루트 `data/`, 이미 `.gitignore` 대상·`intent/03-architecture-stack.md` §5 명시 경로) 아래 원본 파일 + DrumScore JSON.
- 업로드한 곡을 라이브러리에서 클릭 → 연습 화면(T2-3/T2-4의 `PracticeCanvas`)으로 이동해 **실제로 재생**(REQ-07 수용 기준의 "재생됨" 충족).

**안 다룸**
- Google OAuth 로그인(Q-20, 별도 작업으로 연기).
- 회원가입·관리자 계정 생성 UI(REQ-08 "가입 화면 없음" — `POST /admin/users`는 T1-3에 이미 있고 그대로 둠, UI는 범위 밖).
- 음원/사진 업로드(REQ-01/OMR, Phase 3/4) — 업로드 화면은 디지털 악보 1종만. `04-ui-ux.md`의 "입력 종류 선택(음원/사진/디지털 악보)" 3지선다 UI는 지금은 안 만들고 파일 선택기 하나만 — 다른 입력 경로가 실제로 동작할 때(Phase 3/4) 선택 UI를 추가하는 게 "안 되는 버튼을 미리 보여주는 것"보다 낫다고 판단(가정, 아래 §가정 참고).
- 연습 설정 저장(BPM/볼륨/루프 기억, REQ-07의 "연습 설정" 부분) — `practice_settings` 테이블은 이미 있지만 T2-4가 만든 BPM/루프 UI state를 서버에 영속화하는 건 범위 밖(다음 작업에서, 또는 T2-5 완료 후 별도 소작업으로).
- 편집기(T2-6)·스티킹(T2-7).
- CORS 미들웨어: Vite 개발 서버 프록시(`/api` → FastAPI)로 브라우저에서는 모두 동일 출처 요청이 되게 해서 CORS 자체가 필요 없게 설계(아래 §설계). 운영 배포 시 프론트·백엔드를 어떻게 한 origin으로 묶을지는 T5-4(서버 실행 스크립트) 범위.
- 최초 관리자 계정 생성 자동화(Q-21) — QA 때는 DB에 직접 계정을 넣어 테스트.

## 설계

### 1. 파일 저장 경로
`db/session.py`가 이미 쓰는 패턴을 그대로 따른다: `PROJECT_ROOT = Path(__file__).resolve().parents[N]`으로 저장소 루트를 계산(cwd 무관), `intent/03-architecture-stack.md` §5 "사용자 데이터는 루트 data/ 아래 저장"에 따라 `PROJECT_ROOT / "data" / "songs" / <song_id>`에 저장. 이미 `.gitignore`의 `data/` 규칙에 포함돼 추가 설정 불필요. (참고: T1-1에서 스캐폴드한 `app/server/storage/.gitkeep`은 이번에 안 쓰고 그대로 둔다 — 건드리지 않음, 범위 밖.)

신규 모듈 `app/server/file_storage.py`:
- `song_storage_dir(song_id: int) -> Path`: 디렉터리 생성 후 반환.
- `write_song_file(song_id, filename, content) -> str`: 파일을 쓰고 DB에 저장할 **상대 경로**(`<song_id>/<filename>`, `data/songs/` 기준)를 반환.
- `resolve_asset_path(file_path: str) -> Path`: DB의 `file_path`를 실제 파일 경로로 변환 — `Asset` 모델의 `CheckConstraint`(경로조작 패턴 거부)는 "최소한의 DB 레벨 방어선"이라고 스스로 주석에 적어뒀고 "실제 파일 접근 시 재검증하는 로직"을 요구함(모델 주석, `db/models.py:144`) — 이번이 그 "실제 파일 접근" 코드이므로, `(SONGS_ROOT / file_path).resolve()`가 `SONGS_ROOT.resolve()`의 하위 경로인지 `Path.is_relative_to()`로 반드시 재검증한다(Python 3.11, 기능 확인됨). 아니면 404로 처리(정보 노출 방지, 기존 songs.py의 "없으면 404" 관례와 통일).

### 2. 백엔드 API (`app/server/api/songs.py` 확장)
기존 `GET /songs`·`GET /songs/{id}`의 `SongOut`에 `original_bpm: float | None`, `source_type: str` 추가(REQ-07 "원곡 BPM, 입력 경로").

**`POST /songs`** (multipart/form-data, 로그인 필요)
- 필드: `file`(UploadFile, 원본 악보 파일), `title`(Form, 1자 이상), `artist`(Form, 선택), `drumscore`(Form, DrumScore JSON 문자열 — 브라우저가 T2-1 임포터로 이미 만든 것).
- 검증: 확장자 allowlist(`.mid/.midi/.musicxml/.mxl/.gp/.gp3/.gp4/.gp5/.gpx`), 파일 크기 상한(20MB — 이 포맷들은 보통 KB 단위라 넉넉한 상한, 디스크 보호용), `drumscore`는 `pydantic`으로 최소 구조 검증(버전·meta.bpm·meta.source·meta.timeSignature·ppq·notes 배열 — T1-5 `score/types.ts`의 `DrumScore`와 동일 구조, 완전한 의미 검증(T1-5 `validate.ts`의 전체 규칙)까지 서버에서 재구현하지는 않음 — 신뢰 경계는 아래 §가정 참고), `meta.source`가 `midi|musicxml|gp` 중 하나인지(Phase 2 범위).
- 처리: `Song` 행 생성(status=COMPLETED — 비동기 작업 없음, 브라우저가 이미 다 파싱해서 보냄) → `song_id`로 파일 저장 → `Asset(kind=ORIGINAL)`(원본 파일), `Asset(kind=DRUMSCORE_RAW)`(DrumScore JSON) 생성 → 실패 시(파일 쓰기 등) `Song` 행 롤백.
- 응답: `SongOut`(201).

**`PATCH /songs/{id}`** (JSON body `{title?, artist?}`, 로그인 필요, 본인 소유만 — 기존 `GET /songs/{id}`와 같은 "없으면 404" 패턴)
**`DELETE /songs/{id}`** (로그인 필요, 본인 소유만) — DB 행 삭제(Asset은 `cascade="all, delete-orphan"`로 자동) + 연결된 파일 전부 삭제(디스크 삭제는 DB 커밋 **후**에 수행 — 파일은 지웠는데 DB 커밋이 실패해 Asset 레코드가 남는 것보다, DB가 먼저 성공하고 파일 삭제가 best-effort인 쪽이 "고아 레코드가 가리키는 파일 없음" 에러보다 덜 위험하다고 판단, 파일이 없어도 예외 없이 넘어감).
**`GET /songs/{id}/drumscore`** (로그인 필요, 본인 소유만) — `DRUMSCORE_EDITED`가 있으면 그걸, 없으면 `DRUMSCORE_RAW`를 읽어 그대로 반환(T2-6 편집기가 생기기 전까지는 항상 RAW). `Response(content=..., media_type="application/json")`로 저장된 바이트 그대로 반환(서버가 재직렬화하지 않음 — 원본 보존).

### 3. 프론트엔드
**API 클라이언트** (`src/api/`)
- `client.ts`: `apiFetch(path, init)` — `/api` 접두사, `credentials: 'include'`, 2xx 아니면 서버 에러 메시지로 예외.
- `auth.ts`: `login(username, password)`, `logout()`, `me()`.
- `songs.ts`: `listSongs()`, `uploadSong(file, title, artist, drumScore)`, `renameSong(id, {title?, artist?})`, `deleteSong(id)`, `fetchSongDrumScore(id)`.

**Vite 개발 프록시** (`vite.config.ts`에 `server.proxy: { '/api': 'http://localhost:8000' }`) — 브라우저 입장에서 전부 동일 출처 요청이 되어 CORS·크로스 포트 쿠키 문제를 아예 피한다(§범위 "안 다룸" 참고). FastAPI 라우터들은 지금처럼 접두사 없이 유지하고, 프록시가 `/api` 접두사를 벗겨서 전달(`rewrite`).

**화면 전환**: 라우팅 라이브러리 없이 `App.tsx`가 `screen: 'login'|'library'|'upload'|'practice'` 상태로 전환(지금 화면 수가 4개뿐이고 URL 딥링크 요구사항이 없어 `react-router-dom` 추가는 과한 설계로 판단 — 가정, 필요해지면 나중에 교체). 마운트 시 `GET /api/auth/me`로 로그인 여부 확인 후 초기 화면 결정.

- `features/auth/LoginScreen.tsx`: 아이디/비밀번호 폼 → `login()` → 성공 시 라이브러리로.
- `features/library/LibraryScreen.tsx`: 마운트 시 `listSongs()`, 검색어 입력(클라이언트 쪽 `filterSongs(songs, query)` 순수 함수로 제목/아티스트 부분일치 — 사용자 최대 6명·개인 라이브러리라 서버 쪽 검색 API 없이도 충분하다고 판단, 가정), 카드 클릭 → `fetchSongDrumScore()` → 연습 화면으로, 이름변경(인라인 입력 → `renameSong()`), 삭제(확인 후 `deleteSong()`), "업로드" 버튼.
- `features/upload/UploadScreen.tsx`: 파일 입력(`accept` 속성으로 확장자 제한) → `importScoreFile()`로 파싱 → 실패 시 에러 표시(업로드 불가) → 성공 시 제목(파싱된 `meta.title` 또는 파일명 기본값)·아티스트 입력 → 제출 전 `validateDrumScore()`로 한 번 더 확인(T1-5) → `uploadSong()` → 성공 시 라이브러리로 복귀.
- `App.tsx`: 위 화면들을 전환하는 최소 셸로 교체(기존 Phase 1 플레이스홀더 제거).

### 4. 검증 신뢰 경계 (명시)
업로드 시 `drumscore` JSON은 "브라우저가 이미 T1-5 `validateDrumScore()`로 검증한 것"이 전제이지만, 서버는 그 호출을 신뢰하지 않고 **구조만** 다시 검증한다(타입 일치, 필수 키 존재) — **의미 검증(피스 9종 값이 정확한지, 틱이 음수가 아닌지 등 전체 규칙)은 재구현하지 않음**. 이 서비스는 로그인한 소유자 1인만 자기 데이터를 올리는 비공개 서비스(REQ-08, 최대 6명)라 완전한 방어적 재검증보다 "구조 깨짐으로 인한 크래시 방지"가 실질적 목표라고 판단 — 가정, Codex 모드C에서 다르게 보면 반영.

## 테스트 계획
**백엔드(pytest, `app/server/tests/test_songs_api.py` 확장 또는 신규)**
1. `POST /songs` 정상 업로드 → `GET /songs` 목록에 보임(`original_bpm`·`source_type` 포함), `GET /songs/{id}/drumscore`로 원본 그대로 조회됨.
2. 비로그인 시 전부 401(REQ-08 기존 패턴과 동일).
3. 다른 사용자의 곡에 `PATCH`/`DELETE`/`drumscore` 조회 시 404(소유자 아님 — 기존 "없으면 404" 패턴).
4. 허용 안 된 확장자·너무 큰 파일·깨진 JSON `drumscore` → 4xx, DB에 고아 행 안 남음.
5. `DELETE` 후 실제 파일이 디스크에서 사라짐, 같은 id로 `GET`하면 404.
6. `file_storage.resolve_asset_path()`에 `../`·절대경로가 섞인 `file_path`를 직접 넣었을 때 저장소 루트 밖으로 못 나가는지(경로조작 방어 재검증, 단위 테스트).
7. `PATCH`로 제목을 빈 문자열로 바꾸려 하면 거부.

**프론트(vitest)**
- `filterSongs()` 순수 함수: 제목/아티스트 부분일치(대소문자 무시), 빈 검색어는 전체 반환.
- `apiFetch()`가 비2xx 응답에서 서버 에러 메시지를 그대로 예외 메시지로 전달하는지(fetch를 모킹).

**수동 QA(실제 브라우저, Claude Browser pane)** — REQ-07 수용 기준이 명시적으로 "여러 기기/세션"을 요구하므로, 탭을 새로 열거나 완전히 새로고침해 "다른 기기에서 접근"을 흉내 낸다:
1. 로그인 → 빈 라이브러리 확인.
2. MIDI/MusicXML/GP 샘플 각 1개 이상 업로드 → 라이브러리에 제목/아티스트/BPM/입력경로 표시 확인.
3. 완전히 새 탭(또는 새로고침)에서 로그인 → 방금 올린 곡이 똑같이 보이는지(REQ-07 "PC에서 올린 곡이 폰에서 목록에 보이고" 수용 기준의 실질적 검증 — 실제 다른 기기 대신 새 세션으로 "서버가 영속화했다"는 핵심을 확인).
4. 곡 클릭 → 연습 화면으로 이동 → 재생 버튼 → 실제로 소리 남(REQ-07 "재생됨") — T2-2b/T2-3/T2-4가 이미 만든 재생 경로에 실제 서버 데이터가 처음 연결되는 지점이라 중요.
5. 이름 변경 → 목록에 반영.
6. 삭제 → 목록에서 사라짐, 새로고침해도 안 돌아옴.
7. 로그아웃 후 라이브러리 접근 시도 → 로그인 화면으로.
8. 콘솔 에러 0건 확인(기존 작업들과 동일 기준).

## 가정
- 업로드 화면의 "입력 종류 선택" 3지선다(음원/사진/디지털 악보)는 지금 안 만들고 파일 선택기 하나만 — 다른 경로가 실제로 동작하는 Phase 3/4에서 선택 UI 추가(§범위).
- 검색은 서버 API 없이 클라이언트 쪽 필터로 충분(사용자 규모가 작아서).
- 연습 설정(BPM/볼륨/루프) 서버 저장은 범위 밖.
- `drumscore` JSON은 구조만 재검증, 의미 검증은 브라우저를 신뢰(§4).
- 삭제는 완전 삭제(휴지통 없음) — REQ-07에 명시 안 됨.
- CORS 없이 Vite 프록시로 전부 동일 출처 처리 — 운영 배포 방식은 T5-4에서 재검토.
