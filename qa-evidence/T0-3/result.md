> 한 줄 요약: T0-3(OMR) 블록 상태. 사진 미제공 + Audiveris 설치에 관리자 권한 필요(현재 세션엔 없음).

# T0-3 결과 — OMR 확인(블록, 2026-10-23)

## 근거 REQ
REQ-02 드럼 채보 모델 — 경로 B(종이 악보 OMR)

## 진행한 것
- Audiveris CLI 사용법 조사(공식 핸드북 확인, 추측 아님): 기본 문법 `audiveris -batch -transcribe -export -output <폴더> <입력이미지>`. 출처: https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/
- 최신 릴리스 확인: 5.11.0 (GitHub Releases API), Windows용 `Audiveris-5.11.0-windows-x86_64.msi` 다운로드 완료 → `data/installers/`(git 제외 대상)
- 설치 시도 → **실패**. `msiexec /i ... /quiet /l*v <log>` 결과 Exit Code 1603, 로그에 명시:
  > Error 1925. You do not have sufficient privileges to complete this installation for all users of the machine. Log on as administrator and then retry this installation.

## 블록 사유
1. **관리자 권한 없음**: 이 세션(에이전트)은 시스템 전역 설치 권한이 없음. 되돌릴 수 없는 시스템 변경(CLAUDE.md §7)에 해당해 에이전트가 우회 설치를 시도하지 않음.
2. **테스트용 사진 없음**: `data/samples/sheets/`에 의뢰인이 넣기로 한 종이 악보 사진이 아직 없음(2026-10-23 확인).

## 필요한 조치 (의뢰인)
- 다운로드된 설치 파일을 관리자 권한으로 직접 실행: `data/installers/Audiveris-5.11.0-windows-x86_64.msi` (더블클릭 후 관리자 승인, 또는 "관리자 권한으로 실행")
- 또는 이 세션에 관리자 권한을 부여할 방법이 있다면 알려주면 재시도
- 종이 드럼 악보 사진 2~3장을 `data/samples/sheets/`에 추가

## 재현 명령 (설치 완료 후 실행할 것)
```bash
audiveris -batch -transcribe -export -output qa-evidence/T0-3/out "data/samples/sheets/<파일명>"
```
