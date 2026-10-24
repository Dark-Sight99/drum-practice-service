> 한 줄 요약: T2-5 QA — 프론트(tsc/oxlint/prettier/vitest 81/81)·백엔드(ruff/pytest 64/64) 전부 통과. 실제 FastAPI 서버+브라우저로 MIDI/MusicXML/GP 3종 업로드→서버 영속화(재시작 후에도 유지)→실제 재생까지 전체 플로우 확인, 삭제 시 파일 실제 제거·경로조작 방어 확인.

# T2-5 QA 결과(2026-10-24)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 프론트 타입체크 | `npx tsc -b` | PASS |
| 프론트 lint | `npx oxlint` | PASS |
| 프론트 포맷 | `npx prettier --check`(T2-5가 바꾼 파일) | PASS |
| 프론트 단위 테스트 | `npx vitest run` | PASS (81/81, T2-5 신규 7개 — `filterSongs` 6개 + `App.test.tsx` +1) |
| 백엔드 lint | `ruff check`(T2-5가 바꾼 파일) | PASS |
| 백엔드 포맷 | `ruff format --check`(T2-5가 바꾼 파일) | PASS |
| 백엔드 단위 테스트 | `pytest` | PASS (64/64, T2-5 신규 26개) |
| 수동(실제 브라우저+실제 서버) | 업로드·재생·이름변경·삭제·검색·재시작 영속성 | PASS |

전체 로그: `raw_log.txt`

## 신규 백엔드 테스트(26개, `tests/test_songs_upload_api.py`)
- 업로드 성공→목록/상세/DrumScore 조회 일치
- 비로그인 401, 타 사용자 접근 404(PATCH/DELETE/drumscore/GET 전부)
- 허용 안 된 확장자 4종, 과대 용량, 깨진 JSON 거부
- `drumscore` 수치 불변식 12종 개별 위반 케이스(bpm 0/음수, ppq 0/음수, timeSignature 길이/0, audioOffsetMs 비숫자, velocity 범위 밖, piece 미지원값, tick 음수) — 전부 422 거부 + 고아 DB 행 안 남음 확인
- 확장자-source 불일치 거부
- 이름변경(빈 제목 거부, artist만 null로 변경 등 부분 업데이트)
- 삭제 시 실제 파일 제거
- `resolve_asset_path()` 경로조작(`../`, 절대경로, 섞인 패턴) 차단

## 수동 QA(실제 브라우저 + 실제 FastAPI 서버) — 확인 항목
Claude Browser pane + 실제 `uvicorn`(127.0.0.1:8000) + Vite 프록시(5173→8000)로 확인했다. 상세 경과는 `raw_log.txt`. 파일 선택은 Claude Browser 도구에 네이티브 OS 파일 피커 조작 기능이 없어, 실제 샘플 파일 바이트를 `DataTransfer`로 `<input type=file>`에 주입하고 `change` 이벤트를 발생시키는 방식으로 진행(React의 `onChange` 핸들러가 실제 사용자 선택과 동일하게 실행됨 — 파싱·검증·업로드 로직 자체는 실제 코드 경로 그대로 탄다).

### Secure 쿠키(Codex 모드C C-003 검증)
로그인 직후 `/api/songs`를 `credentials:'include'`로 직접 호출 → 200(인증됨). `document.cookie`는 빈 문자열(HttpOnly라 정상) — `localhost` 예외로 Secure 쿠키가 실제로 저장·전송됨을 확인. 비-localhost(Tailscale 등) 환경에 대한 검증은 범위 밖(Phase 5).

### 업로드 — 디지털 악보 3종 전부 확인
- MIDI(`MusicDelta_Grunge.mid`, MDB Drums 실제 샘플): 노트 175개, BPM 120 인식 → 업로드 성공, 라이브러리에 "BPM 120 · MIDI · completed" 표시
- MusicXML(`qa-evidence/T0-4/drum_test.musicxml`, Phase 0 실제 샘플): 노트 4개 인식 → 업로드 성공
- Guitar Pro(`qa-evidence/T2-1/drum_test_roundtrip.gp`, T2-1이 만든 실제 GP7 바이너리): 노트 4개 인식 → 업로드 성공, "Guitar Pro" 라벨 표시

### 영속성 — REQ-07 "PC에서 올린 곡이 폰에서 목록에 보이고"의 핵심 검증
- 완전히 새 탭에서 로그인 → 두 곡이 동일하게 보임(세션 공유 + 서버 조회 확인)
- **FastAPI 서버 프로세스를 실제로 종료 후 재시작** → 새로고침해도 곡 목록이 그대로 유지됨 — SQLite(`data/db/app.db`)와 파일(`data/songs/`)에 실제로 디스크 저장됐음을 확인(메모리 캐시가 아님). Codex 모드C C-005가 요구한 검증.
- REQ-07의 "폰" 부분(비-localhost 원격 기기)은 Secure 쿠키 제약(C-003)으로 이번엔 검증 범위 밖 — Phase 5(Tailscale HTTPS 인프라)에서 재검증 필요(`work/T2-5/plan.md` §가정에 명시).

### 재생 — REQ-07 "재생됨"
업로드한 MIDI 곡을 라이브러리에서 클릭 → 연습 화면으로 이동 → **서버에서 가져온 실제 DrumScore**로 레인·드럼킷이 렌더링됨 → 재생 버튼 클릭 → 3초간 정상 재생(콘솔 에러 0건) → 정지. T2-2b~T2-4가 만든 재생 엔진에 이번 작업에서 실제 서버 데이터를 연결해 확인.

### 이름변경·검색·삭제
- 이름변경: 인라인 입력으로 즉시 반영
- 검색: "Grunge" 입력 시 일치하는 1곡만 필터링, 지우면 전체 복원
- 삭제: `window.confirm()`을 브라우저 자동화 도구가 기본적으로 취소 처리하는 특성이 있어, `javascript_tool`로 `window.confirm`을 임시 accept로 스텁한 뒤 테스트(실제 코드의 확인 로직 자체는 안 바꿈 — 테스트 환경의 다이얼로그 처리 한계를 우회한 것). 삭제 후 목록에서 즉시 사라짐 + `data/songs/<id>/` 디렉터리가 실제로 디스크에서 제거됨을 bash로 직접 확인

### 파일명 고정 생성(Codex 모드C C-001 실측 확인)
남은 곡의 `data/songs/<id>/` 안을 직접 확인 — `original.mid`, `drumscore.json` 고정 파일명만 존재(업로드 시 보낸 원본 파일명 `MusicDelta_Grunge.mid`가 디스크 경로 어디에도 쓰이지 않음을 실측 확인).

### 로그아웃·비로그인 차단
로그아웃 → 로그인 화면 전환. URL 재방문(새로고침)해도 라이브러리로 안 새고 로그인 화면 유지 확인.

### 콘솔 에러
세션 전체에서 `/api/auth/me` 401 4건(로그인 전 최초 확인, React StrictMode가 개발 모드에서 effect를 두 번 실행해 2탭×2회) 외 추가 에러 없음 — 업로드·재생·삭제·이름변경 등 실제 동작 중에는 에러 0건.

## 수용 기준(REQ-07) 충족 여부
- [x] 곡 목록(제목/아티스트/원곡 BPM/입력 경로/처리 상태) — 라이브러리 카드로 확인
- [x] 업로드 — MIDI/MusicXML/GP 3종 확인
- [x] 이름 변경 — 확인
- [x] 삭제 — 확인(파일까지 실제 제거)
- [x] 검색 — 확인(클라이언트 쪽 필터)
- [x] 곡별 저장(원본 파일, DrumScore) — `data/songs/<id>/` 실측 확인
- [x] "PC에서 올린 곡이 … 목록에 보이고" — localhost 멀티세션 + 서버 재시작으로 검증(원격 기기는 Phase 5)
- [x] "… 재생됨" — 서버 데이터로 실제 재생 확인

## Codex 모드A 검수 반영 — C-001(재현됨, 수정 완료)
Codex 모드A(독립 코드 검수, `codex-modeA.md`)가 REQUEST_CHANGES로 지적:
> `app/server/api/schemas.py:76–79` `audioOffsetMs` 검증은 양·음의 무한대만 거부하고 NaN은 통과시킵니다. `math.isfinite(value)`로 유한성을 검사하십시오.

**재현 확인**: `value in (float("inf"), float("-inf"))` 비교는 NaN을 못 거른다(NaN은 자기 자신을 포함해 어떤 값과도 `==`/`in`이 성립하지 않는 IEEE 754 특성) — 실제로 `float("nan") in (float("inf"), float("-inf"))`가 `False`임을 확인. 더 나아가 pydantic-core의 JSON 파서가 `NaN` 리터럴 토큰(Python `json.dumps(allow_nan=True)`가 만드는 비표준 JSON)을 실제로 파싱해 필드 값으로 통과시킴을 직접 실행으로 확인 — 수정 전 코드는 이 입력을 그대로 저장했을 것.

**수정**: `bpm`·`audioOffsetMs` 검증 둘 다 `math.isfinite()`로 통일(inf·-inf·NaN 전부 정확히 거름 — Python 공식 문서 `math.isfinite` 동작). `bpm`은 기존에 `value > 0` 비교가 NaN에 대해 우연히 `False`가 되어 결과적으로 막혔지만(정확한 설계는 아니었음), `isfinite` 사용으로 의도를 명확히 함.

**재검증**: `score["audioOffsetMs"] = float("nan")`을 `json.dumps(allow_nan=True)`로 직렬화해 실제 업로드 API에 보내는 pytest(`test_upload_rejects_nan_audio_offset`)를 추가 — 422 거부 + 고아 Song 행 없음을 확인. 수정 후 `ruff check`/`ruff format --check`/`pytest` 재실행 — 전부 클린, 65/65 통과.

## 가정/한계
- `window.confirm()` 자동화 한계로 QA 중 1회 스텁 처리(실제 코드는 변경 없음).
- 원격(비-localhost) 기기 접근은 Secure 쿠키 제약으로 검증 범위 밖(Phase 5).
- 최초 관리자 계정은 Q-21에 따라 QA용으로 DB에 직접 삽입(부트스트랩 CLI는 범위 밖).
- 연습 설정(BPM/볼륨/루프) 서버 저장, 메트로놈 UI는 범위 밖(기존 계획대로).
