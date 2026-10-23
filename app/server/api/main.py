from fastapi import FastAPI

from api import admin, auth, jobs, songs

app = FastAPI(title="드럼 연습 서비스 API")
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(songs.router)
app.include_router(jobs.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
