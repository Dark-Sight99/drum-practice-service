# 서버 수동 중지(윈도우). 근거: T5-4. 실제 로직은 scripts/stop.py(파이썬, OS 공용).
# start.ps1과 같은 이유로 $ErrorActionPreference = "Stop"은 쓰지 않는다(자식 프로세스의
# 정상 stderr 출력을 PowerShell 5.1이 오류로 착각하는 함정). start.ps1과 같은 이유로
# $LASTEXITCODE를 실행 전 초기화 + try/catch로 호출 자체의 실패도 명시적으로 처리
# (Codex 모드A 지적 C-003, 반영).
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Python = Join-Path $ProjectRoot "app\server\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Error "가상환경을 찾을 수 없습니다: $Python"
    exit 1
}
$global:LASTEXITCODE = 0
try {
    & $Python (Join-Path $ProjectRoot "scripts\stop.py")
} catch {
    Write-Error "서버 중지 실행 자체가 실패했습니다: $_"
    exit 1
}
exit $LASTEXITCODE
