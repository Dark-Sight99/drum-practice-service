> 한 줄 요약: T5-2(PWA 설치+오프라인 저장)·REQ-09를 의뢰인 결정으로 드롭. 미사용 상태였던 vite-plugin-pwa 설정·의존성 제거, intent 문서 5곳 갱신. 빌드·테스트 전부 통과, Codex 모드A 대기.

# T5-2 QA 증거 (Phase 5 — PWA 설치·오프라인 드롭)

## 배경
T5-2(PWA 설치 + 오프라인 저장) 착수를 앞두고 의뢰인에게 "서버가 꺼지면 어떻게 되는 건가"라는 질문을 받아 확인하는 과정에서, (1) 현재 `vite-plugin-pwa`는 manifest 설정만 있고 실제 서비스워커 등록 코드가 앱 어디에도 없어 전혀 작동하지 않는 상태였고, (2) REQ-09(오프라인 연습)가 실제로 되려면 곡 데이터(오디오·DrumScore) 캐싱과 별개로 **앱 자체(라이브러리·연습 화면의 HTML/JS/CSS)까지 서비스워커로 캐시**해야 서버가 꺼져도 페이지가 뜬다는 걸 설명.

의뢰인 결정: "서버가 꺼지면 그냥 작동 안 하는 방향으로 가자. 오프라인저장 의미없는 거 같아" — 추가 확인(AskUserQuestion)으로 PWA 설치(홈화면 아이콘)까지 포함해 전부 드롭 확정.

## 구현
### intent 문서 갱신 (기존 드롭 항목들의 표기 관례 — 취소선 + "드롭(날짜, 의뢰인 결정)" + 근거 — 그대로 따름)
- `intent/02-requirements.md` — REQ-09 전체 취소선 처리 + 드롭 사유 기록, REQ-07 수용 기준 중 REQ-09를 참조하던 조항도 함께 정리.
- `intent/05-todo.md` — T5-0/T5-1은 완료로 체크(증거 경로 기록), T5-2는 드롭 표기.
- `intent/03-architecture-stack.md` — 문서 상단 한 줄 요약·아키텍처 다이어그램에서 "PWA"·"오프라인 캐시" 표현 제거(다이어그램에 드롭 사유 주석 추가), 기술 선택 표의 PWA(vite-plugin-pwa) 행 취소선 처리.
- `intent/04-ui-ux.md` — 라이브러리 화면 요소 목록에서 "오프라인 저장 표시" 배지 취소선 처리.
- `intent/08-design.md` — Pretendard 자체 호스팅 사유에서 "오프라인 PWA 대응" 표현을 "PWA·오프라인은 드롭, 자체 호스팅(외부 CDN 의존 금지)은 계속 유효"로 수정 — T5-0에서 이미 적용한 자체 호스팅 자체는 되돌리지 않음(CDN 미의존은 오프라인과 무관하게 유효한 선택).

### 코드 정리
- `app/web/vite.config.ts` — `VitePWA` 플러그인·import·설정 블록 전부 제거(실제로 작동 안 하던 설정이라 제거해도 기능 손실 없음).
- `app/web/package.json`/`package-lock.json` — `npm uninstall vite-plugin-pwa`로 제거(314개 패키지, Workbox 관련 전이 의존성 포함).

## 테스트
- `npx tsc -b`: 에러 없음
- `npx vitest run`: **333 passed**(25 test files)
- `npm run build`: 프로덕션 빌드 정상 완료(`tsc -b && vite build`, 463ms) — `vite-plugin-pwa` 제거 후에도 빌드 깨지지 않음을 확인. 빌드 산출물(`dist/`)엔 서비스워커·manifest 파일이 더 이상 생성되지 않음(플러그인이 담당하던 부분이라 당연한 결과, 혹시 모를 잔존 참조 없는지 확인 차 직접 빌드해봄).

## Codex 모드A

### 1차 — REQUEST_CHANGES
- **C-001(권장)**: `CLAUDE.md`(프로젝트 한 줄 "웹앱(PWA)", 폴더 규칙 "app/web/ (PWA)"), `intent/09-agent-roles.md`(프론트 역할 설명에 "PWA 화면"·"오프라인 캐시"), `intent/06-pipeline.md`(위험 작업 목록에 "오프라인 캐시·세션 처리"), `app/web/src/index.css`(Pretendard 자체 호스팅 사유 주석에 "오프라인 PWA 대응") — 이번 diff가 안 건드린 다른 문서·코드 주석들에 여전히 "PWA"·"오프라인"이 남아 실제와 어긋남.
- **C-002(권장)**: `package-lock.json`이 PWA 패키지 제거 치고 너무 크게 바뀜(순변경 +1,017/-6,241줄) — `@coderline/alphatab`, `@oxlint/*`, `@rolldown/*` 등 PWA와 무관한 패키지 항목도 새로 추가돼 보여, `npm uninstall`이 의도치 않은 lockfile 변경을 포함했는지 확인 필요.

### 대응
- **C-001**: 지적된 4개 파일 전부 "PWA"·"오프라인" 표현을 정리(`CLAUDE.md` 프로젝트 한 줄에서 "(PWA)" 제거 + 드롭 사유 각주, 폴더 규칙에서 "(PWA)" 제거, `09-agent-roles.md` 프론트 역할에서 "PWA 화면"→"화면", "오프라인 캐시" 취소선, 담당 REQ 목록에서 09 제거, `06-pipeline.md` 위험 작업 목록에서 "오프라인 캐시" 제거+각주, `index.css` 주석에서 "오프라인 PWA 대응" 사유를 "PWA·오프라인은 드롭, 외부 CDN 미의존은 계속 유효"로 수정).
- **C-002**: `app/web/package.json`에서 `@coderline/alphatab`·`oxlint`가 diff 이전부터 있던 기존 의존성(버전 변경 없음)임을 확인 — `git show main:...package-lock.json`과 현재 버전을 직접 대조해 react/vite/alphatab/oxlint/tone/typescript 전부 **버전 동일**함을 확인. `npm install`(비파괴적 재검증, `npm ci`는 실행 중인 dev 서버가 쥐고 있던 `@rolldown` 네이티브 바이너리 파일에 Windows EPERM 잠금이 걸려 실패해 대신 사용)을 재실행한 결과 "added 87 packages, changed 29 packages, 0 vulnerabilities"로 정상 해소 — `vite-plugin-pwa`(Workbox 전이 의존성 포함 314개) 제거로 npm이 이전부터 살짝 어긋나 있던 lockfile(플랫폼별 optional 패키지 항목 일부 누락)을 같이 정리한 것으로 판단, 의도치 않은 버전 변경은 없음.

### 재검증
- `npx tsc -b` / `npx vitest run`(333 passed) 재실행 통과.

### 2차 — REQUEST_CHANGES(필수 수정 없음, 권장만)
- 1차 두 지적 모두 대부분 해소 확인(패키지 버전 동일 — react/vite/alphatab/oxlint/tone/typescript/lucide-react/@vitejs·plugin-react/vitest/jsdom 추가 대조, Pretendard `@font-face` 2개·폰트 URL 변경 없음 확인).
- **C-001(권장)**: `wiki/architecture.md`(당시 안 고친 상태였음), `intent/planning-log.md`("홈서버형 PWA" 표현)에 PWA/오프라인 잔여 언급.
- **C-002(권장)**: `work/`·`logs/`·`qa-evidence/`의 과거 PWA/오프라인 언급 — Codex 스스로 "당시 상태를 기록한 역사 자료로 보이므로 현재 기능을 약속한다고 단정할 수는 없다"고 판단.

### 대응
- `wiki/architecture.md`: "현재 코드 구조... 새 작업 시작 전 이 파일부터 확인"이라고 명시된 살아있는 참조 문서라 PWA 언급 2곳(`app/web/` 한 줄 설명, `npm run build` 주석) 수정 — Codex 2차 검수가 돌아가는 동안 이미 반영, 이번 커밋에 포함.
- `intent/planning-log.md`: 2026-10-23 기획 대화의 날짜 박힌 결정 기록(`logs/`와 같은 성격의 역사 자료) — OMR 드롭 때도 `planning-log.md`는 소급 수정하지 않은 전례를 따라 그대로 둠.
- `work/`·`logs/`·`qa-evidence/`(이번 T5-2 것 제외): Codex 2차 스스로 역사 자료로 판단했고, 끝없이 과거 산출물을 소급 수정하는 건 `CLAUDE.md` §1-5 "토큰을 낭비하지 마라"와도 맞지 않아 그대로 둠.
- `intent/09-agent-roles.md:78`("필수 시나리오"의 "오프라인" 항목): 재확인 결과 이건 "오프라인 상태에서도 기능이 된다"는 약속이 아니라 "네트워크 끊겼을 때 우아하게 실패하는지"를 보는 일반 QA 실패-경로 체크리스트 — REQ-09 드롭과 무관하게 여전히 유효한 테스트 범주라 수정하지 않음.

### 재검증
`npx tsc -b` / `npx vitest run`(333 passed) 재실행 통과(wiki 문서만 수정, 코드 변경 없어 실질 영향 없음 확인 차 재실행).

## 결론
의뢰인 결정에 따라 REQ-09(오프라인 연습)·T5-2(PWA 설치)를 전부 드롭. 작동하지 않던 미사용 설정을 정리했고, intent 문서 전반에 드롭 사유를 남겨 추후 재검토 시 왜 드롭했는지 추적 가능하게 함.
