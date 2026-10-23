> 한 줄 요약: 기획→개발→QA→위키 4단계 파이프라인, 에이전트 역할(Claude 개발 / Codex 읽기전용 검수), 토론·승인 절차, 증거 규칙.

# 06. 멀티 에이전트 파이프라인

## 1. 역할
| 역할 | 실행 주체 | 권한 | 책임 |
|---|---|---|---|
| 마스터 AI | Claude Code 메인 세션 | 전체 | 작업 분해, 토론 소집, 배정, 1차 검수, 최종 승인 |
| 기획 담당 | Claude 서브에이전트 | 읽기 + intent/ 제안서 작성 | 명세 해석, 누락 질문 정리 |
| 프론트 개발 | Claude 서브에이전트 | app/web 쓰기 | 구현 + 단위 테스트 |
| 서버·오디오 개발 | Claude 서브에이전트 | app/server 쓰기 | 구현 + 단위 테스트 |
| QA 담당 | Claude 서브에이전트 | 테스트 실행, qa-evidence 쓰기 | 시뮬레이션·E2E·캡처 |
| 위키 담당 | 경량 모델 서브에이전트 | wiki/ 쓰기 | 완료 작업 문서화 |
| 전략 실장 (검수) | **Codex CLI, 읽기 전용** | 코드 수정 불가 | 코드 리뷰, 리스크·전략 보완점, APPROVE/REQUEST_CHANGES |

### Codex 연동 초기 세팅 (사람이 1회 수행)
1. Codex CLI 설치·로그인: `npm install -g @openai/codex` → `codex login` (ChatGPT 구독 또는 OpenAI API 키 필요, 사용량은 Codex 한도에서 차감)
2. Claude Code에 OpenAI 공식 플러그인 설치(Claude Code 입력창에서):
   ```
   /plugin marketplace add openai/codex-plugin-cc
   /plugin install codex@openai-codex
   /reload-plugins
   /codex:setup
   ```
3. 리뷰 게이트(`/codex:setup --enable-review-gate`)는 **켜지 않는다** — Claude가 멈출 때마다 자동 리뷰가 돌아 사용량을 빠르게 소모할 수 있음(플러그인 README 경고). 필요해지면 사용자가 지켜볼 때만 켠다.
4. Claude가 매번 허락을 묻지 않도록 `.claude/settings.json`에 Codex 검수 명령만 허용(마스터가 T1-1에서 작성, 정확한 문법은 Claude Code 문서로 확인):
   허용 대상 = 검증된 읽기 전용 `codex exec` 명령 한 종류

### 호출 경로 2가지
| 경로 | 누가 실행 | 용도 |
|---|---|---|
| `/codex:review --base main`, `/codex:adversarial-review <관점>` | **사용자**가 입력 (Claude는 슬래시 명령을 스스로 실행하지 않음) | Phase 게이트에서 사람이 최종 검수 요청 |
| 셸에서 `codex exec` 읽기 전용 실행 | **마스터 AI가 자동** | 작업마다 자동 검수 루프 (아래) |
- `/codex:rescue`(작업 위임)는 코드를 수정할 수 있으므로 이 프로젝트에서 사용하지 않는다.

### Codex 호출 방법 (자동 검수)
- 마스터가 셸로 Codex CLI를 비대화형·읽기 전용 샌드박스로 실행한다(예: `codex exec --sandbox read-only "<검수 요청>"`).
- ⚠ 윈도우에서 읽기 전용 샌드박스가 실제로 적용되는지 T0 단계에서 확인(파일 쓰기 시도가 거부되는지 테스트)하고 결과를 `wiki/tools.md`에 기록.
- ⚠ 플래그명은 설치된 버전에서 `codex --help`, `codex exec --help`로 **먼저 확인**하고 확인된 명령을 `wiki/tools.md`에 기록한다. 추측으로 실행하지 않는다.
- Codex 지침은 루트의 `AGENTS.md`.
- 검수 요청에는 diff 범위, 관련 REQ ID, QA 증거 경로만 넘긴다.

## 2. 4단계 파이프라인
### ① 기획
- 사용자와 대화로 요구사항 확정 → `intent/`에 명세·투두 반영(사용자 승인 필요).
- 대화 요지는 `logs/YYYY-MM-DD-planning.md`에 기록.

### ② 개발
- 작업 시작 전 `work/<작업ID>/plan.md`: 목표, 근거 REQ, 바꿀 파일, 테스트 계획.
- 구현 후 `work/<작업ID>/report.md`에 **구현 근거** 필수:
  - 각 변경 → REQ ID
  - 사용한 외부 API/라이브러리 → 공식 문서 URL 또는 설치 버전의 타입 정의 위치
  - 확인 못 한 가정 → "가정:" 으로 명시
- 테스트 먼저 작성(가능한 범위에서 TDD).

### ③ QA (증거 기반)
- QA 담당이 직접 실행: 단위 테스트, Playwright E2E, 성능 측정(fps, 오디오 동기 ms, 처리 시간).
- `qa-evidence/<작업ID>/`에 저장: `result.md`(통과/실패 표), 테스트 로그, 스크린샷(PC·폰 뷰포트), 측정값.
- 실패 시: 작업 브랜치를 마지막 통과 커밋으로 되돌리고(롤백) 원인 기록 → 개발 재배정. **최대 3회** 반복 후에도 실패하면 사용자에게 보고하고 멈춤.
- Codex 검수 APPROVE 전까지 반복.

### ④ 위키
- 완료 시 `wiki/`에 갱신: `architecture.md`(구조 변화), `decisions.md`(결정·근거·날짜), `modules/<모듈>.md`, `tools.md`(검증된 명령어).
- 다음 작업은 wiki 요약부터 읽는다.

## 3. 업무 처리 절차 (오케스트레이션)
1. **지시 수신**: 사용자 → 마스터
2. **1차 토론**: 마스터가 관련 담당자를 소집, 각자 **최소 1개 의견**(접근법, 리스크, 질문)을 `logs/<날짜>-<작업ID>-discussion.md`에 남김. Codex도 리스크 의견 1개.
3. **분배·수행**: 토론 결과로 담당·범위 확정. 독립 작업은 병렬(∥). 결과물은 `work/<작업ID>/`, 각 문서 첫 줄 한 줄 요약.
4. **검수**: 마스터 1차 검수(명세 일치) → Codex 전략·리스크 검토
5. **최종 판단**: 마스터가 승인/반려. Phase 게이트는 사용자 승인.

## 4. 병렬·비용 최적화
- 큰 작업은 독립 하위 작업으로 쪼개 병렬 실행 후 마스터가 통합. 같은 파일을 동시에 수정하는 분할 금지.
- 서브에이전트 컨텍스트 = CLAUDE.md + 해당 REQ 문단 + 관련 파일 경로. 고정 순서로 넣어 캐시 재사용.
- 진행 중 맥락이 필요한 분기 작업은 포크 세션 사용.
- 단계별 모델 체급은 CLAUDE.md §2.

## 5. 감사(Audit) 추적 구조
```
logs/        기획 대화, 토론, 결정
work/        작업 계획·보고(구현 근거)
qa-evidence/ 테스트 로그·캡처·측정값
wiki/        누적 지식
```
git 커밋 메시지에 작업ID와 REQ ID 포함 (예: `T2-3 REQ-06 레인 렌더러`).
