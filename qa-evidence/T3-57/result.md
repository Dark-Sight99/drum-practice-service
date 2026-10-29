> 한 줄 요약: 계정 관리 화면에서 아이디 변경·관리자 권한 부여/제거·계정 삭제까지 할 수 있게 확장(비밀번호 재설정은 T3-56에서 이미 있었음). 겸사겸사 개발 서버가 멈춰있던(오래된 고아 프로세스) 문제도 고침.

# T3-57 결과

## 배경 (의뢰인 요청, 2026-10-29)
T3-56으로 만든 "계정 관리" 화면을 의뢰인이 직접 열어보니 "Method Not
Allowed" 에러가 떴다(스크린샷). 확인해보니 원인은 화면이 아니라
개발 서버 자체 — Windows에서 `uvicorn --reload`가 띄운 워커 프로세스가
부모(reloader)가 죽어도 안 죽고 고아로 남는 고질적 버그(이전 작업에서도
겪음)로, 오전에 띄워둔 서버가 몇 시간째 T3-56 이전 코드로 응답하고
있었다 — `GET /admin/users`(목록) 라우트 자체가 그 서버엔 없어서 405.

문제를 고치는 과정에서 실제 DB를 들여다보다가 의뢰인이 "관리자 계정이
뭔지 나도 모른다"고 함 — 조사해보니 기존 계정 3개가 전부 예전 작업 중
자동 생성된 QA용이었고, 관리자 권한은 의뢰인이 실제로 안 쓰는 계정에만
있었음. 의뢰인 확인 하에 안 쓰는 계정 2개 삭제 + 실제 쓰는 계정을
관리자로 전환 + 아이디를 `admin94`로 변경(전부 1회성 DB 직접 작업,
qa-evidence 밖에서 처리, 아래 "서버 문제" 절 참고).

그 다음 의뢰인 요청: "계정관리 페이지에 현재 등록되어있는 계정정보도
볼 수 있게 해주고 여기서 내가 계정권한 설정도 할수있게 해줘 삭제나,
관리자권한이나, 관리자권한제거나, 아이디비밀번호 변경같은 기능들을 이
페이지에서 할 수 있게" — 이 작업의 범위.

## 서버 문제 (코드 변경 아님, 운영 문제)
- 증상: `curl /openapi.json`이 `GET /admin/users`·
  `/admin/users/{id}/reset-password`가 전혀 없는, T3-56 이전 스키마를
  계속 반환. 내 작업 도구(PowerShell/Bash)에서 `Stop-Process`·`taskkill`
  둘 다 "프로세스를 찾을 수 없음"이라고 했는데, 실제로는 **내 작업
  도구가 보는 프로세스 목록이 사용자의 실제 호스트와 분리돼 있어서**였다
  — 사용자의 실제 터미널(`mcp__terminal__run_in_terminal`, 샌드박스
  밖에서 실행)로 다시 확인하니 `Get-CimInstance Win32_Process`에서
  `parent_pid=28964`(이미 죽은 reloader)로 생성된 고아
  `multiprocessing.spawn_main` 자식 PID 31040이 오전 10시 56분부터 계속
  살아서 포트 8000을 물고 있었음(netstat은 이걸 죽은 부모 PID로 잘못
  표시해 더 헷갈리게 함). `taskkill /F /PID 31040`으로 실제 범인을 잡아
  종료 → 깨끗한 서버를 다시 띄우고(`mcp__terminal__run_in_terminal`,
  tab `c3`) `/openapi.json`에 새 라우트가 다 보이는 것·실제 요청이 그
  서버 로그에 찍히는 것까지 확인.
- 교훈(향후 세션 참고용): 이 환경에서 `Stop-Process`/`taskkill`이
  "프로세스 없음"이라고 해도 실제로는 살아있을 수 있다 — 작업 도구의
  PowerShell/Bash는 호스트와 프로세스 목록이 분리된 샌드박스라
  신뢰할 수 없고, 반드시 `mcp__terminal__run_in_terminal`(사용자
  터미널, 샌드박스 밖)로 다시 확인해야 한다. 또한 netstat의 PID
  귀속은 부모가 죽고 자식만 남은 경우 부모 PID로 잘못 표시될 수 있어,
  `Get-CimInstance Win32_Process`로 `ParentProcessId`까지 같이 봐야
  진짜 살아있는 프로세스를 찾을 수 있다.

## 구현 (화면 기능 확장)

### 백엔드 (`app/server/api/admin.py`)
- `UpdateUserRequest`를 전부 선택값(`username`·`is_admin`·`is_active`
  모두 `| None = None`)으로 바꿔, 하나의 PATCH로 바뀐 필드만 보낼 수
  있게 함(기존 `{"is_active": false}`만 보내는 호출도 그대로 동작).
  아이디 중복 시 409(생성과 같은 처리).
- `DELETE /admin/users/{id}` 신규 — 그 계정이 올린 곡들을 먼저
  지우고(처리 중인 곡이 있으면 통째로 거부, `delete_song`과 같은
  보호장치) `file_storage.delete_song_files()`로 파일까지 정리, 믹서
  설정 삭제, 마지막으로 계정 자체 삭제(세션은 `User.sessions`의
  cascade로 자동 삭제).
- **자기 자신 보호**(API 레벨, 프런트가 버튼을 막아도 직접 호출로
  우회할 수 있으므로 서버가 최종 권위): 본인 관리자 권한 해제·본인
  정지·본인 계정 삭제 전부 400으로 거부. Q-16(`intent/07-open-questions.md`,
  "의뢰인 혼자 관리자인 전제")과 같은 근거.

### 프런트엔드
- `app/web/src/api/admin.ts` — `updateUser(id, {username?, is_admin?})`,
  `deleteUser(id)` 추가.
- `app/web/src/features/admin/AdminScreen.tsx` — 각 계정 행에 [수정]
  [비밀번호 재설정] [정지/정지해제] [삭제] 4개 버튼.
  - [수정] → 아이디·관리자 체크박스가 있는 모달. 본인 행은 관리자
    체크박스 자체가 비활성화(위 서버 보호와 같은 이유, 프런트에서도
    먼저 막아 더 명확한 메시지).
  - [삭제] → 확인 모달(LibraryScreen의 곡 삭제 확인과 같은 패턴 —
    `window.confirm` 대신 모달, 되돌릴 수 없는 작업이라 확인 단계).
    본인 행은 버튼 자체가 비활성화.
  - 본인 행에 "(본인)" 표시 추가.

## 테스트
- `app/server`: `pytest -q` — 221/221 통과(신규 9개: username/is_admin
  동시 수정, 아이디 중복 409, 본인 관리자 해제 거부, 본인 정지 거부(API
  직접 호출 우회 시나리오), 계정 삭제+곡 cascade 확인, 본인 삭제 거부,
  비관리자 삭제 거부, 없는 사용자 삭제 404). `ruff check` — 통과.
- `app/web`: `npx tsc -b`·`npx oxlint`(기존 경고 4건만) 통과. `npx
  vitest run` — 292/292 통과(신규 4개: 수정 모달 아이디 변경,
  본인 행 관리자 체크박스 비활성화, 삭제 확인 모달 동작, 본인 행
  삭제·정지 버튼 비활성화).

## 브라우저 수동 QA
서버를 고친 뒤 `/openapi.json`으로 신규 라우트(`PATCH`가 username/
is_admin도 받는지, `DELETE` 존재)가 실제 서버에 반영됐는지 확인. 로그인
세션은 여전히 없어 실화면 캡처는 못 함 — T3-56과 같은 이유로 jsdom
컴포넌트 테스트로 대체.

## 남은 작업
- Codex 모드A 검수 → APPROVE 후 `main` 병합.
- 의뢰인이 실제로 새로고침해서 "계정 관리" 화면이 이제 정상 동작하는지
  확인 필요.
