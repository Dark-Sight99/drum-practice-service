> 한 줄 요약: 집 PC(서버)에 폰·맥·지인 기기에서 접속하기 위한 Tailscale 설치·연결 절차. 의뢰인이 직접 수행(REQ-08, T5-3).

# 원격 접속 안내 — Tailscale

이 문서는 에이전트가 아니라 **의뢰인이 직접 따라 하는** 절차입니다. 코드 변경이 필요한 부분은 이미 반영돼 있습니다(`app/web/vite.config.ts`의 `allowedHosts` 참고).

## 1. 왜 Tailscale인가

이 서비스는 "집 PC = 서버" 구조입니다(`intent/03-architecture-stack.md`). 집 PC는 공인 IP·포트 포워딩 설정 없이는 바깥에서 접속할 수 없는데, 포트 포워딩은 집 공유기를 인터넷에 직접 노출시켜 보안 위험이 큽니다. **Tailscale은 집 PC와 각 기기(폰·노트북 등) 사이에 사설망(VPN)을 만들어, 공유기 설정을 전혀 건드리지 않고도 마치 같은 집 와이파이에 있는 것처럼 안전하게 접속하게 해줍니다.**

- 비용: **개인(Personal) 무료 플랜**으로 충분(`intent/02-requirements.md` REQ-08, 2026-10-23 확정 — 비상업·소수 지인 최대 6명 범위 안).
- 이 서비스 자체의 로그인(아이디/비밀번호)과는 **별개**입니다. Tailscale은 "그 기기가 네트워크에 들어올 수 있는지"만 담당하고, "그 사람이 자기 계정으로 들어왔는지"는 여전히 이 앱의 로그인 화면이 담당합니다(REQ-08) — 즉 Tailscale에 초대된 사람이라도 이 서비스 계정이 없으면 로그인 화면에서 막힙니다. 계정은 의뢰인(관리자)이 직접 만들어줘야 합니다.

## 2. 집 PC(서버)에 Tailscale 설치

1. [tailscale.com/download](https://tailscale.com/download)에서 운영체제(윈도우/맥)에 맞는 설치 프로그램 다운로드.
2. 설치 후 실행 → 구글/마이크로소프트 계정 등으로 로그인(Tailscale 계정 생성 겸).
3. 로그인하면 이 PC가 자동으로 "tailnet"(의뢰인 개인 전용 사설망)에 연결됩니다. 작업 표시줄(윈도우) 또는 메뉴바(맥)의 Tailscale 아이콘으로 연결 상태 확인 가능.
4. 이 PC의 Tailscale 기기 이름을 확인해두세요(설치 시 자동 지정, 나중에 바꿀 수 있음) — 다른 기기에서 접속할 때 이 이름을 씁니다.

이미 설치·사용 중이라면(개발 중 `.tail756a35.ts.net`로 접속 테스트한 이력이 `app/web/vite.config.ts`에 남아있음) 이 단계는 넘어가도 됩니다.

## 3. 의뢰인 본인의 다른 기기(폰·맥북 등)에 설치

같은 방법으로 각 기기에 Tailscale 앱 설치 후 **같은 계정으로 로그인**:
- iPhone/iPad: App Store에서 "Tailscale" 검색·설치
- Android: Play 스토어에서 "Tailscale" 검색·설치
- 맥/윈도우 노트북: 2번과 동일한 설치 프로그램

같은 계정으로 로그인한 기기는 자동으로 같은 tailnet에 들어와, 추가 설정 없이 서버 PC에 접속 가능합니다.

## 4. 지인 초대하기 (최대 6명)

1. 브라우저에서 [login.tailscale.com/admin/users](https://login.tailscale.com/admin/users) (Tailscale 관리 콘솔) 접속 → 로그인.
2. "Invite external user" (또는 비슷한 이름의 "사용자 초대") 메뉴에서 지인의 이메일 주소 입력 → 초대 전송.
3. 지인은 이메일로 받은 초대 링크를 눌러 수락 → 자기 계정으로 Tailscale에 가입(본인도 무료).
4. 지인이 자기 기기(폰 등)에 Tailscale 앱을 설치하고 그 초대 수락한 계정으로 로그인하면, 의뢰인의 tailnet에 들어와 서버 PC에 접속할 수 있게 됩니다.
5. 지인에게는 **이 서비스 자체의 로그인 계정도 별도로 만들어줘야** 실제로 라이브러리에 들어올 수 있습니다(관리자 화면에서 생성 — 위 §1 참고).

관리 콘솔 메뉴 이름·위치는 Tailscale이 가끔 UI를 바꾸므로, 위 링크에서 안 보이면 [tailscale.com/kb/1136/tailnet](https://tailscale.com/kb/1136/tailnet)(공식 문서)에서 최신 절차 확인.

## 5. 접속 주소 (T5-4 완료로 확정됨)

서버 PC가 Tailscale에 연결돼 있고 아래 §5-1 설정을 한 번 해두면, 같은 tailnet의 어느 기기에서든 브라우저로:

```
https://desktop-2j6he5q.tail756a35.ts.net
```

로 접속합니다. 포트 번호는 안 붙여도 됩니다(https 기본 포트 443으로 Tailscale이 자동 연결해줌).

기기 이름(`desktop-2j6he5q`)이 나중에 바뀌면, 서버 PC 터미널에서 `tailscale status` 입력 — 맨 위에 본인 PC 줄이 나옵니다. `.tail756a35.ts.net`는 의뢰인의 tailnet 고유 주소(`app/web/vite.config.ts`의 `allowedHosts`에도 등록돼 있음).

### 5-1. (서버 PC에서, 한 번만) Tailscale Serve 설정

T5-4부터 서버(API)와 화면(프런트엔드)이 같은 포트(8000) 하나로 합쳐졌습니다(`scripts/start.py`로 띄움). Tailscale의 "Serve" 기능으로 그 포트를 tailnet 안에서 자동 HTTPS로 내보냅니다 — 인증서를 따로 관리할 필요가 없습니다(공식 기능, 출처: 서버 PC에 설치된 Tailscale의 `tailscale serve --help`).

서버 PC 터미널에서 (서버가 떠 있는 상태로) 한 번만:

```
tailscale serve --bg 8000
```

확인: `tailscale serve status` — `https://desktop-2j6he5q.tail756a35.ts.net`가 `proxy http://127.0.0.1:8000`을 가리키면 성공.

**참고**: 개발 중에는 이 설정이 Vite 개발 서버(5173번 포트)를 가리키고 있었습니다 — 위 명령을 실행하면 8000번(운영용 서버)으로 바뀝니다. 공개 인터넷에 노출되는 게 아니라 tailnet(의뢰인의 사설망) 안에서만 통하는 주소라 안전합니다(REQ-08 "비공개" 원칙 유지 — Funnel과 다름, §6 참고).

## 6. Funnel에 대해 (선택 사항 — 아직 채택 안 함)

Tailscale에는 "Funnel"이라는 기능도 있어, tailnet에 초대되지 않은 사람에게도 공개 인터넷 링크로 접속을 허용할 수 있습니다. 하지만:

- 이 서비스는 "비공개, 소수 지인 전용"이 원칙입니다(REQ-08). Funnel은 그 원칙과 반대로 **공인 인터넷에 노출**시키는 기능이라, 지금 이 안내서의 기본 절차(위 4번, tailnet 초대)는 Funnel을 쓰지 않습니다.
- Funnel 자체는 개인 무료 플랜에도 포함돼 있는 것으로 확인됐지만(`intent/07-open-questions.md` Q-13), **채택 여부는 의뢰인이 별도로 결정**하기로 돼 있습니다 — "지인이 Tailscale 앱 설치하는 것도 번거로우니 그냥 링크 하나로 열어주고 싶다" 같은 필요가 생기면 말씀해주세요. 그 경우 보안 범위(누구나 그 링크로 접속 가능해지는 점)를 다시 짚고 진행하겠습니다.

## 7. 문제가 안 풀릴 때

- 접속이 안 될 때: 서버 PC와 접속하려는 기기 양쪽 다 Tailscale 앱이 켜져 있고(로그아웃 상태 아님) "Connected"로 표시되는지 확인.
- 서버 PC가 잠자기 모드로 들어가거나, 서버 자체가 안 떠 있으면 접속 안 됨 — `scripts/start.py`(또는 `scripts/windows/start.ps1`)가 떠 있는지 확인(T5-4, 아래 "서버가 다운되면" 참고). 집 PC의 절전 설정도 같이 확인.
- 그 외 문제는 [tailscale.com/kb](https://tailscale.com/kb)(공식 문서)에서 검색하거나, 증상을 알려주시면 같이 확인하겠습니다.
