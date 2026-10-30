# 서버 수동 시작(윈도우). 근거: T5-4, intent/03-architecture-stack.md §3 "수동 시작 스크립트".
# 더블클릭하거나 PowerShell에서 실행하세요. 실제 로직은 scripts/start.py(파이썬, OS 공용)에 있음 —
# 이 .ps1은 "venv 파이썬으로 그걸 실행"만 담당.
#
# $ErrorActionPreference = "Stop"을 안 쓴다 — alembic 등 자식 프로세스가 stderr에 정상
# INFO 로그만 남겨도(exit code는 0) PowerShell 5.1이 NativeCommandError로 착각해
# 스크립트를 중단시키는 함정이 있다(이 세션에서 실제로 재현·확인). 대신 종료 코드로
# 직접 성공 여부를 판단한다.
#
# 2026-10-30(T5-4) — Codex 모드A 지적(C-003, 반영): Test-Path로 확인한 직후에도 실행 자체가
# 실패할 수 있는데(권한 문제 등), 그 경우 $LASTEXITCODE가 이전 호출의 값을 그대로 들고
# 있어 "성공"으로 잘못 보고될 위험이 있었다 — 실행 전 0으로 초기화하고, 호출 자체가
# 예외를 던지는 경우(명령을 찾지 못함 등)는 try/catch로 명시적으로 1을 반환한다.
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Python = Join-Path $ProjectRoot "app\server\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Error "가상환경을 찾을 수 없습니다: $Python`napp/server에서 'python -m venv .venv' 후 의존성을 설치해주세요."
    exit 1
}
$global:LASTEXITCODE = 0
try {
    & $Python (Join-Path $ProjectRoot "scripts\start.py") @args
} catch {
    Write-Error "서버 시작 실행 자체가 실패했습니다: $_"
    exit 1
}
exit $LASTEXITCODE
