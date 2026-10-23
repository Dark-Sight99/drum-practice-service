> 한 줄 요약: Phase 0 게이트에서 확정된 주요 결정과 근거. 이후 Phase의 결정도 이 파일에 이어서 기록한다.

# 결정 기록 (decisions.md)

## Phase 0 게이트 (2026-10-23)

| 결정 | 선택 | 근거 | 관련 |
|---|---|---|---|
| 드럼 채보 모델 | ADTOF-pytorch (원본 ADTOF 대안) | 원본은 madmom 빌드 블로커(Windows, MSVC/WSL 없음). MDB Drums 5트랙 F-measure macro 0.7585 | Q-02, T0-2 |
| 음정 유지 속도 변경 | HTMLMediaElement `preservesPitch` | SoundTouch(AudioWorklet)는 iPhone 13 Pro·iPad mini 5 실기기에서 오디오 엔진이 간헐적으로 수 초씩 밀리는 현상 재현 확인 | Q-04, T0-5 |
| PDF→이미지 라이브러리 | pypdfium2 | Apache-2.0/BSD-3-Clause(비카피레프트). PyMuPDF는 AGPL/상업 듀얼이라 제외 | Q-12, T0-6 |
| 원격 접속 | Tailscale 개인 무료 플랜 | 최대 6명, 비상업. Funnel 포함 확인(베타) | Q-06, Q-13 |
| 서비스 범위 | 비공개, 지인 포함 최대 6명, 비상업 | 의뢰인 결정(2026-10-23 기획 대화) | Q-07 |

## 보류/추가 검증 필요 (Phase 0에서 닫지 못함)

| 항목 | 상태 | 재검증 시점 |
|---|---|---|
| 서버 PC(윈도우 vs 맥) | 윈도우를 기본값으로 MVP 진행. 맥 미입수로 실측 못함 | 맥미니 입수 후 (`qa-evidence/T0-1/INSTALL.md`의 공용 스크립트 사용) |
| 오디오-화면 동기 허용 오차(±30ms) | T0-5는 두 내부 클록 비교 방식의 한계로 확정 못함 | Phase 2~3, 실제 메트로놈·분리 오디오 트랙 end-to-end 테스트 |
| ADTOF-pytorch 라이선스 | LICENSE 파일 없음, 사용 권한 불명확 | Phase 3(T3-2) 채택 전 저자 문의/재확인 |
| Audiveris(AGPL)·ADTOF(NC) 다중 사용자 라이선스 해석 | 조사 완료, 법적 결론 아님 | 전문가 확인 권장, Audiveris 코드 직접 수정 시 재검토 |
| 종이 악보 OMR 품질 | 압축 한 줄 표기에서 낮음(완전 인식 40%). REQ-03 편집기 필수 확인 | 표준 5선 표기 샘플이 생기면 추가 비교 |

## Phase 1 게이트 (2026-10-23, 태그 `phase-1`)

| 결정 | 선택 | 근거 | 관련 |
|---|---|---|---|
| DrumScore 구현 위치 | app/web(TypeScript)만, Python 쪽은 안 만듦 | "모든 화면이 이 형식만 읽음" 원칙(`03-architecture-stack.md` §1) + 경로C(MIDI/MusicXML/GP)가 브라우저에서 처리됨. 경로A/B의 Python 생성은 Phase 3/4에서 이 타입과 교차 검증 | T1-5 |
| 관리자가 관리자 생성 가능 여부 | 제한 없이 그대로 둠(의뢰인 1명 전제) | Codex 지적(Q-16)이지만 현재 1인 관리자 구조에서 위험 낮다고 판단, 최종 결정은 보류 | T1-3, Q-16 |
| 워커 다중 실행 지원 여부 | "워커는 항상 1개만 띄운다"는 운영 규칙으로 대응, 스키마 변경 안 함 | 다중 워커 지원엔 Job에 워커 식별자 컬럼 추가가 필요해 범위 밖으로 판단 | T1-4, Q-17 |

## Phase 2 진행 중 결정 (2026-10-23)

| 결정 | 선택 | 근거 | 관련 |
|---|---|---|---|
| MIDI/MusicXML/GP 가져오기 아키텍처 | alphaTab으로 파싱 → alphaTab 자신의 MIDI 생성기로 표준 MIDI 바이너리 재수출 → @tonejs/midi로 재파싱, `.mid` 직접 가져오기와 같은 변환기로 합류 | 틱·템포·타이 계산을 alphaTab에 전부 맡기고 "MIDI 이벤트→DrumScore" 로직은 한 곳만 유지. 실제 Phase 0 샘플(`qa-evidence/T0-4/drum_test.musicxml`)로 검증 | T2-1 |
| 오디오 엔진 마스터 클록 | Tone.js Transport를 감싸는 자체 래퍼(`clock.ts`) | "단일 마스터 클록" 원칙(`03-architecture-stack.md` §1), Tone 직접 참조를 다른 모듈에 안 흘려 교체 가능하게 유지 | T2-2 |
| **MIDI 드럼 소리 최종 선택** | **Virtuosity Drums(Versilian Studios/Karoryfer, CC0) 실제 녹음 샘플** — Tone.js 내장 신스(초안)는 폐기 | 의뢰인이 신스 음색을 "실제 소리 같지 않다"고 피드백 → 사운드폰트(FluidR3Mono, MIT)·샘플팩(Virtuosity Drums, CC0) 조사 후 Virtuosity Drums로 교체 지시 → 교체 후 의뢰인이 직접 듣고 승인("소리 좋은데") | T2-2b, Q-19 |
| 톰 3종(high/mid/floor) ↔ 샘플팩 2종(Low/High) 불일치 처리 | 피치시프트 등 가공 안 함, Low Tom의 실제 타법(center=mid, off-center=floor)으로 구분 | 근거 없는 음원 가공 금지(CLAUDE.md 규칙1) | T2-2b |

## 환경/인프라

| 항목 | 내용 |
|---|---|
| 서버 PC(현재) | 윈도우 PC, RTX 5060, CUDA 12.8+ PyTorch(torch 2.11.0+cu128 확인) |
| 원격 접속 | Tailscale 설치·연결 완료(이 PC + iPhone 13 Pro + iPad mini 5) |
| Git | 로컬 저장소 초기화 완료, 원격 미연결 |
| Codex | codex-cli 0.163.0 설치·로그인 완료, 검수 모드 A~D 체계 도입(`AGENTS.md`, `06-pipeline.md` §1-1) |
