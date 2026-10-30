# install-autostart.ps1로 등록한 로그인 자동 시작을 해제한다. 근거: T5-4.
$ErrorActionPreference = "Stop"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "드럼연습서비스-서버.lnk"
if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
    Write-Host "해제 완료: $ShortcutPath 삭제됨."
} else {
    Write-Host "등록된 자동 시작이 없습니다(할 일 없음)."
}
Write-Host "이미 떠 있는 서버는 그대로입니다 — 지금 끄려면 stop.ps1을 실행하세요."
