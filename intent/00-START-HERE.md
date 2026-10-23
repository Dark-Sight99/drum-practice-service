> 한 줄 요약: Claude Code(마스터 AI)에게 처음 붙여넣는 실행 지시문. 읽을 문서 순서와 첫 작업을 지정한다.

# 00. 시작 지시문 (Claude Code에 그대로 붙여넣기)

아래 블록 전체를 Claude Code 첫 메시지로 붙여넣는다.

```
너는 이 프로젝트의 마스터 AI다. 이 폴더(드럼연습서비스)에서 "드럼 연습 웹앱"을 만든다.

1. 다음 문서를 순서대로 읽어라. 읽기 전에는 어떤 코드도 작성하지 마라.
   - CLAUDE.md                     (상시 업무 지침 — 항상 우선)
   - intent/01-vision.md           (상위 목표·핵심 변수·근거 자료)
   - intent/02-requirements.md     (기능 명세 + 수용 기준)
   - intent/03-architecture-stack.md (아키텍처·기술 스택·라이선스)
   - intent/04-ui-ux.md            (화면 설계)
   - intent/08-design.md           (디자인 가이드: 색·폰트·킷 피스 표현)
   - intent/06-pipeline.md         (4단계 파이프라인·오케스트레이션·증거 규칙)
   - intent/09-agent-roles.md      (에이전트 역할 정의 — Phase 1에서 .claude/agents/로 변환)
   - intent/07-open-questions.md   (미결정·검증 필요 항목)
   - intent/05-todo.md             (작업 목록 — 이 순서대로 진행)
   - intent/planning-log.md        (기획 대화 기록)

2. 읽은 뒤, 문서들 사이의 모순·누락·검증 불가 항목을 목록으로 보고하라.
   네가 임의로 채우지 말고 사용자에게 질문하라.

3. 사용자가 승인하면 intent/05-todo.md 의 Phase 0 (환경 검증 스파이크)부터 시작하라.
   Phase 0 결과(벤치마크·라이선스 확인)를 사용자에게 보고하고 승인받기 전에는
   Phase 1 로 넘어가지 마라.

4. 모든 작업은 intent/06-pipeline.md 의 규칙(근거 명시, QA 증거, Codex 검수, 위키 기록)을 따른다.
```

## 사람(재우)이 미리 준비할 것
- [ ] 이 폴더가 git 저장소인지 확인 (아니면 `git init` — 규칙은 CLAUDE.md §5)
- [ ] Codex 연동 세팅: `intent/06-pipeline.md` §1 "Codex 연동 초기 세팅" 1~3번 수행
- [ ] 테스트용 자료: 종이 드럼 악보 사진 2~3장, 연습하고 싶은 음원 2~3곡(개인 소장분)
- [ ] 서버 후보 PC 두 대(윈도우 RTX 5060 / 맥 M1)에 접근 가능한 상태
