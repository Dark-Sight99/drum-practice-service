# 서버 수동 시작(윈도우). 근거: T5-4, intent/03-architecture-stack.md §3 "수동 시작 스크립트".
# 더블클릭하거나 PowerShell에서 실행하세요. 실제 로직은 scripts/start.py(파이썬, OS 공용)에 있음 —
# 이 .ps1은 "venv 파이썬으로 그걸 실행"만 담당.
#
# $ErrorActionPreference = "Stop"을 안 쓴다 — alembic 등 자식 프로세스가 stderr에 정상
# INFO 로그만 남겨도(exit code는 0) PowerShell 5.1이 NativeCommandError로 착각해
# 스크립트를 중단시키는 함정이 있다(이 세션에서 실제로 재현·확인). 대신 종료 코드로
# 직접 성공 여부를 판단한다.
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Python = Join-Path $ProjectRoot "app\server\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Error "가상환경을 찾을 수 없습니다: $Python`napp/server에서 'python -m venv .venv' 후 의존성을 설치해주세요."
    exit 1
}
& $Python (Join-Path $ProjectRoot "scripts\start.py") @args
exit $LASTEXITCODE
