> 한 줄 요약: BPM 92 vs 184 옥타브 의심을 Beat This!(독립 SOTA 신경망)로 재검증 — 92가 맞았고 기존 코드 수정 불필요. 조사 중 발견한 Tailscale 원격 접속 502/403 버그를 별도로 수정.

# T3-46 결과 — BPM 재검증(코드 수정 없음) + Tailscale 접속 버그 수정

## 배경
Pretender 공식영상에서 추정 BPM이 92였는데 외부 소스(songscription)가 184를 표기해
"옥타브 오류"로 의심 — madmom/tempocnn/BeatNet 등 더 정교한 라이브러리를 조사했으나
전부 환경(Python 버전·TensorFlow 1.15 등) 비호환으로 설치 불가.

## 실측 — Beat This!(CPJKU, MIT 라이선스) vs 기존 librosa
3개 소스(공식영상/녹화버전/기존 결함 mp4) 전부에서 Beat This!의 비트 추정이
**90.9bpm**(librosa 92.2bpm과 같은 대역)으로 수렴 — 184가 아니라 **92가 맞음**을
확인. 다운비트 간격(×4)도 내부적으로 같은 값과 일치. 전체 수치:
`work/T3-45-hihat-detection-experiment/beat_this_vs_librosa_result.json`.

**결론: 기존 `tempo.py` 코드는 처음부터 정확했음 — 수정 없음.**

## 부수 발견 — Tailscale 원격 접속 502/403 (수정함)
BPM 검증 중 YOASOBI 곡에서 "노트보다 소리가 늦게 들린다" 제보가 들어와 조사하다,
의뢰인이 Tailscale로 맥에서 접속을 시도하며 발견:
1. vite 개발 서버가 IPv6(`[::1]:5173`)에만 바인딩돼있는데 Tailscale serve는
   IPv4(`127.0.0.1:5173`)로 연결 시도 → 502. `tailscale serve`를 `localhost:5173`
   기준으로 재설정해 해결.
2. 그러자 Vite 5+ 보안 기능(알 수 없는 Host 헤더 차단)이 Tailscale 호스트명을
   막아 403. `app/web/vite.config.ts`에 `server.allowedHosts: ['.tail756a35.ts.net']`
   추가해 해결(본인 소유 tailnet 전용이라 DNS 리바인딩 공격 시나리오에 해당 안 함).

커밋에 포함된 수정: `app/web/vite.config.ts`만(운영 코드). Tailscale 자체 설정
(`tailscale serve ...`)은 이 PC의 OS 레벨 설정이라 레포에는 안 남음 — 재부팅 등으로
초기화되면 `tailscale serve --bg --https=443 http://localhost:5173` 재실행 필요.

## "노트보다 소리가 늦게 들린다"(YOASOBI) — 원인은 블루투스 지연(앱 버그 아님)
노트 생성·오디오 스케줄링 코드를 전부 점검(백엔드 온셋 정확도, 화면 렌더링 식 vs
소리 스케줄 식 동일 여부, 트랙 간 동기화)했으나 버그 없음 확인. 의뢰인이 맥 내장
스피커로 재확인한 결과 **블루투스 이어폰의 물리적 지연**(100~300ms 안팎)이 원인으로
확정 — 후속 작업(T3-47 예정: 오디오 지연 보정 기능)으로 대응.

## 범위
운영 코드 변경: `app/web/vite.config.ts`(Tailscale 허용 호스트)만. `tempo.py` 등
채보 파이프라인은 변경 없음.
