from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from api import admin, auth, debug_log, jobs, songs

app = FastAPI(title="드럼 연습 서비스 API")

# 2026-10-30(T5-4) — 개발 중(Vite dev server, intent/03-architecture-stack.md §2)엔
# vite.config.ts의 /api 프록시가 "/api"를 벗겨 이 라우터들의 원래 경로(/songs 등)로
# 보낸다. 운영(scripts/start.py로 띄운 서버 하나가 API+화면을 같은 포트에서 같이
# 서빙)에선 그 프록시가 없어 프런트가 호출하는 "/api/..." 경로를 이 서버가 직접
# 받아야 한다 — 기존 라우터 등록(접두사 없음, 아래)은 그대로 둔 채 "/api" 접두사로도
# 한 번 더 등록한다(동일 핸들러를 두 경로에 노출 — 상태 없는 함수라 안전).
for prefix in ("", "/api"):
    app.include_router(auth.router, prefix=prefix)
    app.include_router(admin.router, prefix=prefix)
    app.include_router(songs.router, prefix=prefix)
    app.include_router(jobs.router, prefix=prefix)
    # T6-11 임시 진단(2026-10-31, debug_log.py 상단 주석 참고) — 조사 끝나면
    # 이 줄도 같이 삭제.
    app.include_router(debug_log.router, prefix=prefix)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# 2026-10-30(T5-4) — 빌드된 프런트(app/web/dist, `npm run build`)가 있으면 이 서버가
# 같은 포트에서 같이 서빙한다 — Tailscale로 접속할 때 포트 하나만 열면 되게(REQ-08
# 원격 접속 단순화, docs/원격-접속-안내-Tailscale.md 참고). API 라우터들을 전부
# 등록한 "뒤"에 이 catch-all 마운트를 추가해야 한다 — Starlette는 먼저 등록된 경로
# 매칭을 우선하므로, 순서가 바뀌면 /songs 같은 API 경로도 정적 파일 마운트가
# 가로채 404를 내게 된다. dist가 없으면(개발 중 프런트는 npm run dev로 따로 보는
# 경우) 조용히 건너뛴다 — API만 떠도 되는 기존 개발 흐름을 안 깨기 위함.
# 이 앱은 URL 기반 라우팅이 없어(App.tsx 주석: "라우팅 라이브러리 없이 상태로 화면
# 전환") html=True의 "그 외 경로는 index.html로" 기본 동작까지는 필요 없지만, 끄면
# 손해볼 것도 없어 기본값 그대로 둔다.
_WEB_DIST = Path(__file__).resolve().parent.parent.parent / "web" / "dist"
if (_WEB_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=_WEB_DIST, html=True), name="static-frontend")
