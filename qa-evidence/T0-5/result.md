> 한 줄 요약: 측정 페이지 제작·데스크톱 스모크테스트 완료. 폰·태블릿 실측은 HTTPS 배포 방법(Tailscale 미설치) 결정 대기로 블록.

# T0-5 진행 상황 — 속도 변경 동기화 측정(2026-10-23)

## 근거 REQ
REQ-04 — 60%/130% 재생 시 오디오-메트로놈 어긋남 측정(목표 ±30ms)

## 완료한 것
1. **사전 조사**(①②③): `qa-evidence/T0-5/research.md` — iOS 무음 스위치, 저장소 삭제, AudioWorklet/WakeLock 지원 현황. 출처 포함.
2. **측정 페이지 제작**: `qa-evidence/T0-5/sync-test/index.html`
   - 저작권 문제 없는 합성 클릭트랙을 `OfflineAudioContext`로 그 자리에서 생성(외부 파일 불필요)
   - 후보1(HTMLMediaElement `preservesPitch=true`) vs 후보2(`@soundtouchjs/audio-worklet`, MPL-2.0, CDN 로드) 두 방식 모두 구현
   - 측정 방법: `AudioContext.currentTime`(메트로놈이 쓸 기준 클록)과 `<audio>` 엘리먼트 자체의 `currentTime`(실제 오디오 진행)을 주기적으로 비교해 어긋남(ms) 계산. 두 클록이 다른 소스(미디어 디코드 클록 vs 오디오 하드웨어 샘플 클록)라 실제 드리프트를 반영함.
   - 기능 감지(보안 컨텍스트/AudioWorklet/WakeLock)를 페이지 로드 시 자동 표시
   - 버튼 1개로 4구간(후보×속도) 순차 자동 실행, 결과를 복사 가능한 텍스트 영역에 표시
   - 출력 장치(유선/블루투스) 선택 드롭다운 — 실제 라우팅은 OS가 결정하므로 라벨만 기록
3. **데스크톱 스모크테스트** (Chrome, `http://localhost`): 4구간 모두 오류 없이 완료 확인. 수치 자체는 데스크톱용이라 참고치일 뿐 폰 실측 대체 아님(로그: `smoke_test_log.txt`).
   - 이 테스트로 **HTTPS(또는 localhost) 필요성을 직접 재현 확인**: `file://`로 열면 AudioWorklet/WakeLock이 `false`, `http://localhost`로 열면 `true` — research.md의 조사 결과와 일치.

## 블록 사유 — 폰·태블릿에 HTTPS로 전달하는 방법
`qa-evidence/T0-5/sync-test/`는 지금 이 PC의 `localhost`에서만 안전 컨텍스트로 열림. 아이폰·아이패드가 열려면 **HTTPS로 네트워크 너머에서 접근** 가능해야 함. 의뢰인이 지정한 방법(Tailscale serve/Funnel)은 **이 PC에 Tailscale이 설치되어 있지 않음**(확인: `tailscale version` → 명령 없음). 설치에는 (T0-3 Audiveris 때처럼) 관리자 권한이 필요할 가능성이 높음 — 의뢰인 확인 후 진행 필요.

## 다음 단계 (의뢰인 결정 필요)
- Tailscale 설치를 의뢰인이 직접 하거나, 이 세션에 관리자 권한을 부여하는 방법을 알려주면 설치 후 `tailscale serve`로 이 폴더를 HTTPS로 올리겠음
- 설치 후: `tailscale serve https / qa-evidence/T0-5/sync-test` (정확한 명령은 설치된 버전의 `tailscale serve --help`로 재확인 후 실행 — 추측 금지)
- 배포되면 의뢰인이 아이폰 13 Pro·아이패드 미니 5의 Safari로 접속 → 출력 장치 선택(유선 1회, 블루투스 1회) → "측정 시작" 1번 누르고 대기(각 약 12분) → 결과 텍스트를 복사해 전달
