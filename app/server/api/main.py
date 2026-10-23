from fastapi import FastAPI

app = FastAPI(title="드럼 연습 서비스 API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
