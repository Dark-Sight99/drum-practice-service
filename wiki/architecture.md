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
  db/             DB 스키마(Phase 1 T1-2에서 구현)
  storage/        파일 저장소

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

## 아직 없는 것 (다음 작업)
- 인증/세션, DB 스키마, 작업 큐 워커 (T1-2~T1-4)
- DrumScore 타입·GM 매핑 (T1-5)
- 실제 화면(연습·라이브러리·편집·믹서)은 Phase 2부터
