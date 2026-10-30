# 윈도우 로그인 시 서버 자동 시작 등록. 근거: T5-4, intent/03-architecture-stack.md §3
# "서버는 사용자 로그인 시 자동 시작".
#
# 방식: 윈도우 시작프로그램 폴더(shell:startup)에 바로가기(.lnk)를 하나 만든다 — 관리자
# 권한이 필요 없고(작업 스케줄러 방식보다 간단), 윈도우가 "로그인할 때"마다 그 폴더의
# 항목을 실행해주는 표준 메커니즘(Microsoft 공식 동작). pythonw.exe(콘솔창 없는 파이썬)를
# 써서 로그인할 때 검은 창이 뜨지 않게 한다.
#
# 실행: PowerShell에서 `.\install-autostart.ps1` (한 번만 실행하면 됨 — 재부팅마다 다시
# 실행할 필요 없음, 바로가기가 Startup 폴더에 남아있는 한 계속 적용됨)
# 해제: `.\uninstall-autostart.ps1`

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PythonW = Join-Path $ProjectRoot "app\server\.venv\Scripts\pythonw.exe"
$StartScript = Join-Path $ProjectRoot "scripts\start.py"

if (-not (Test-Path $PythonW)) {
    Write-Error "가상환경을 찾을 수 없습니다: $PythonW`napp/server에서 'python -m venv .venv' 후 의존성을 설치해주세요."
    exit 1
}

$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "드럼연습서비스-서버.lnk"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PythonW
$Shortcut.Arguments = "`"$StartScript`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "드럼연습서비스 API 서버 + 워커 자동 시작(T5-4)"
$Shortcut.Save()

Write-Host "등록 완료: $ShortcutPath"
Write-Host "다음 로그인부터 서버가 자동으로 시작됩니다. 지금 바로 시작하려면 start.ps1을 실행하세요."
