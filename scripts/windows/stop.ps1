# 서버 수동 중지(윈도우). 근거: T5-4. 실제 로직은 scripts/stop.py(파이썬, OS 공용).
# start.ps1과 같은 이유로 $ErrorActionPreference = "Stop"은 쓰지 않는다(자식 프로세스의
# 정상 stderr 출력을 PowerShell 5.1이 오류로 착각하는 함정).
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Python = Join-Path $ProjectRoot "app\server\.venv\Scripts\python.exe"
& $Python (Join-Path $ProjectRoot "scripts\stop.py")
exit $LASTEXITCODE
