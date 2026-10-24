> 한 줄 요약: Phase 0(검증) → 1(뼈대) → 2(디지털 악보 연습) → 3(오디오) → 4(종이 악보) → 5(기기·오프라인) 순 작업 목록. 각 항목은 근거 REQ와 완료 증거를 가진다.

# 05. 투두리스트

규칙: 각 Phase 끝에 사용자 승인. 항목 완료 = 증거가 `qa-evidence/<ID>/`에 있고 Codex 검수 APPROVE.
병렬 가능 표시 ∥ 는 마스터가 서브에이전트로 동시 진행 가능. ⏱ 는 속도·지연·fps 측정이 들어가는 작업으로 **단독 실행**(다른 작업과 동시에 돌리지 않음). 병렬 규칙 상세(worktree, 동시 최대 3개)는 `06-pipeline.md` §4-1.

## Phase 0 — 환경 검증 스파이크 (코드는 버려도 됨)
**진행 규칙(가벼운 절차, 2026-10-23 확정)**: 필수 — 스파이크별 결과 보고(측정값·로그·실행 명령), `qa-evidence/T0-x/`에 증거 저장, 검증된 명령어는 `wiki/tools.md`에 기록. 생략 — 토론 로그, `work/<ID>/plan.md`, 스파이크별 Codex 검수, 위키 아키텍처 문서. **단, Phase 0 게이트 직전에 결과 보고서 묶음(T0-1~T0-6의 `result.md`와 결론 요약)을 Codex로 1회 검수한다(`06-pipeline.md` §1-1 모드 B 방식, 서버 PC·모델 선택 같은 큰 결정의 근거이므로).** 정식 4단계 파이프라인(`06-pipeline.md`)은 Phase 1부터 전면 적용.

- [x] T0-1 서버 후보 벤치마크: **윈도우(RTX 5060, CUDA 12.8+ PyTorch)만 지금 실측**. 같은 곡으로 Demucs 분리 시간 측정 → 표로 보고 (REQ-01). 벤치마크 스크립트와 설치 명령(맥/윈도우 공용)을 `qa-evidence/T0-1/`에 남겨 맥(M1) 입수 후 의뢰인이 직접 실행할 수 있게 한다. 맥 실측·최종 서버 PC 결정은 보류(Q-01)
  - 완료(2026-10-23): 3.93분 합성 테스트 입력, GPU 22.76초(10.36배속)/CPU 53.43초(4.41배속). 증거: `qa-evidence/T0-1/result.md`, `raw_log.txt`, `bench_demucs.py`, `INSTALL.md`
- [x] T0-2 ∥ 드럼 채보 모델 실행 확인: ADTOF 설치·실행, 출력 형식 확인. 정확도 측정은 **공개 데이터셋(MDB Drums, ENST-Drums 등 음원+정답 드럼 기록 쌍)** 사용 — 다운로드 전 라이선스·이용조건을 조사해 먼저 보고하고, 승인 후 다운로드. F-measure로 분류별 정확도 측정(정확도 측정은 병렬 가능, 처리 시간을 기록하는 실행만 ⏱ 단독). 대안 모델 1개 이상 조사(라이선스 포함) (REQ-02)
  - 완료(2026-10-23): 원본 ADTOF는 madmom 빌드 블로커(MSVC/WSL 없음)로 **대안 ADTOF-pytorch** 채택(의뢰인 확인). MDB Drums 5트랙(Demucs 분리 후 채보, REQ-02 경로 A 재현)으로 F-measure 측정: KD 0.9487 / SD 0.8506 / HH 0.6980 / CY 0.8144 / TT 0.4810, macro 0.7585. ADTOF-pytorch 라이선스 미표시 이슈는 Q-15로 별도 기록. 증거: `qa-evidence/T0-2/`
- [x] T0-3 ∥ OMR 확인: Audiveris CLI로 의뢰인 종이 드럼 악보 사진 2~3장(`data/samples/sheets/`, 선생님이 초보자용으로 고친 악보 — **OMR 인식 테스트 전용, 음원 채보 정답지로 사용하지 않음**) → MusicXML. 드럼 노트가 얼마나 살아남는지 보고 (REQ-02)
  - 완료(2026-10-23): 의뢰인이 설치(관리자 권한 직접 실행) + 사진 21장 제공. 21장 전부 크래시 없이 처리. 퍼커션 클레프 완전 인식 40%(16/40 악장), 부분 35%, 전혀 안 됨 22.5%. 클레프 인식돼도 하이햇 보이스가 톰으로 잘못 배정되는 등 악기 매핑 오류 확인(표본 점검). 박자/마디 경고는 21장 전부에서 발생. REQ-03 편집기가 필수임을 뒷받침. 증거: `qa-evidence/T0-3/`
- [x] T0-4 ∥ GP/MusicXML 가져오기: alphaTab으로 드럼 트랙 노트 추출 가능 여부 (REQ-02)
  - 완료(2026-10-23): 자체 작성 MusicXML 퍼커션 샘플로 확인 — `outputMidiNumber`가 GM 표준(36/38/42)으로 정확히 추출됨. GP 바이너리 파일 실측은 보류(실제 샘플 없음). 증거: `qa-evidence/T0-4/`
- [x] T0-5 ⏱ 음정 유지 속도 변경(측정 구간은 단독 실행): 후보 2개를 60%/130%로 3분 재생, 메트로놈과 어긋남(ms) 측정, 폰 포함 (REQ-04)
  - 완료(2026-10-23): iPhone 13 Pro·iPad mini 5(유선/블루투스 각)에서 실측. SoundTouch는 오디오 엔진이 간헐적으로 수 초씩 밀리는 현상 재현(채택 안 함), preservesPitch 채택 제안(Q-04). ±30ms 최종 확정은 측정 방법론 한계로 Phase 2~3 재검증 필요(Q-05). 증거: `qa-evidence/T0-5/`
- [x] T0-6 라이선스 표 확정(03 문서 §4의 ⚠ 해소). 추가 확인:
  - PyMuPDF vs pypdfium2 라이선스 비교, 문제 없으면 pypdfium2 1순위 (Q-12) — 완료, pypdfium2 채택 확정
  - Audiveris(AGPL-3.0)·ADTOF(CC BY-NC-SA 4.0)를 지인 포함 소수 사용자(최대 6명) 네트워크 서비스로 쓸 때의 라이선스 해석 — 법적 단정 금지, 근거와 함께 보고 (Q-14) — 완료(법적 결론 아님, 전문가 확인 권장)
  - Tailscale Funnel이 개인 무료 플랜에 포함되는지 조사(참고용, 채택 여부는 별도 결정) (Q-13) — 완료
  - 증거: `qa-evidence/T0-6/result.md`
- [ ] **게이트**: 결과 보고 → 사용자: 서버 PC 결정, 모델 선택, 허용 오차 확정

## Phase 1 — 뼈대
- [x] T1-1 저장소 구조·린트·테스트 러너 세팅 (web, server), `.gitignore` 확인, `CLAUDE.md` §5 git 규칙 적용
  - 완료(2026-10-23): app/web(Vite+React+TS+PWA, oxlint/Vitest), app/server(FastAPI, ruff/pytest) 스캐폴드. Codex 모드A에서 디자인 토큰 중복(C-001) 지적 → 수정 → 모드B APPROVE → `main` 병합. 증거: `qa-evidence/T1-1/`, 위키: `wiki/architecture.md`
- [x] T1-2 FastAPI + SQLite 스키마(users, songs, assets, jobs, practice_settings) (REQ-07, 08, 10)
  - 완료(2026-10-23): SQLAlchemy 2.0 + Alembic. Codex 모드A/B 검수로 FK 미검사(C-001)·사용자간 곡 참조(C-002)·경로조작(C-003/007) 실제 버그 발견·수정 후 APPROVE. 테스트 16개. 증거: `qa-evidence/T1-2/`, 위키: `wiki/architecture.md`
- [x] T1-3 로그인/세션, 비로그인 차단 테스트 (REQ-08)
  - 완료(2026-10-23): argon2+서버세션(HttpOnly/Secure 쿠키), 관리자 계정 생성/정지, REQ-08 수용기준 전부 테스트로 증명. Codex 모드A에서 계정 존재 노출(응답내용+타이밍 사이드채널) 발견·수정 후 APPROVE. 테스트 29개. Q-16(관리자가 관리자 생성 가능) 신규 등록. 증거: `qa-evidence/T1-3/`, 위키: `wiki/architecture.md`
- [x] T1-4 작업 큐 워커(별도 프로세스, 재시작 복구) (REQ-10)
  - 완료(2026-10-23): FIFO 작업 큐 워커(`worker/runner.py`, `--once`/무한루프), 핸들러 레지스트리(Phase3/4용, 지금은 비워둠), `GET /jobs`·`/jobs/{id}`(사용자간 격리). 수동 서브프로세스 QA로 `expire_on_commit` 버그 발견·수정. Codex 모드A에서 동시 워커 이중선점(C-001, 필수) 발견·원자적 claim으로 수정, 재시작복구 소유권 문제(C-002)는 스키마변경 필요해 판단 대기(Q-17). 모드B 3회(수치 동기화→회귀테스트 결정성→예외캡처) 끝에 APPROVE. 테스트 38개. 증거: `qa-evidence/T1-4/`, 위키: `wiki/architecture.md`
- [x] T1-5 DrumScore 타입·검증·GM 매핑 상수 + 단위 테스트 (REQ-02)
  - 완료(2026-10-23): `app/web/src/score/`에 DrumScore 타입(9종 분류)·GM 매핑(공식 표로 재확인)·검증 함수(예외 없이 에러 목록 반환) 구현. "모든 화면이 이 형식만 읽음" 원칙 + 경로C(MIDI/MusicXML/GP)가 브라우저 처리라 TypeScript로 한정, 경로A/B의 Python 생성은 Phase 3/4로 보류. Codex 모드A에서 검증 함수의 예외 전파 가능성(C-001, 필수) 발견·수정. 모드B 1회에서 바로 APPROVE. 테스트 20개. 증거: `qa-evidence/T1-5/`, 위키: `wiki/architecture.md`

## Phase 2 — 디지털 악보로 연습 (첫 사용 가능 버전)
- [x] T2-1 ∥ MIDI/MusicXML/GP → DrumScore 가져오기 (REQ-02 경로 C)
  - 완료(2026-10-23): `app/web/src/score/import/`. alphaTab으로 MusicXML/.mxl/GP를 파싱해 자신의 MIDI 생성기로 표준 MIDI 바이너리를 뽑아낸 뒤 @tonejs/midi로 재파싱 — .mid 직접 가져오기와 같은 변환기로 합류시키는 단일 경로. `qa-evidence/T0-4/drum_test.musicxml`(Phase 0 실제 샘플)로 MusicXML 경로 검증, GP는 alphaTab 자신의 Gp7Exporter로 만든 실제 GP7 바이너리로 검증(Codex 모드A C-001 반영 — 사람이 만든 파일은 아니라 Q-18 부분 해소로 등록). 모드B 2회 끝에 APPROVE. 테스트 13개(전체 웹 33개). 증거: `qa-evidence/T2-1/`, 위키: `wiki/architecture.md`
- [x] T2-2 ∥ 오디오 엔진: 마스터 클록, MIDI 드럼 소리, 메트로놈, 카운트인 (REQ-04)
  - 완료(2026-10-23): `app/web/src/audio/`. 틱→초 변환 등 순수 계산(`timing.ts`)은 단위 테스트, Tone.js 연동(Transport·신스)은 jsdom이 Web Audio API를 구현 안 해 실제 브라우저로 수동 QA. 수동 QA 중 실제 버그 발견(메트로놈 먼저 실행 후 재생 시 전부 무음 — Transport 절대시각 리셋 안 함) 및 수정. Codex 모드A에서 박자표 분자만 전달(C-001, 필수)·메트로놈 강박 로컬카운터(C-002, 권장) 추가 발견·수정, 모드B 1회 APPROVE. REQ-04의 ±30ms 공식 측정은 Q-05 계획대로 보류(분리 오디오+BPM UI 필요). 테스트 46개(전체 웹). 증거: `qa-evidence/T2-2/`, 위키: `wiki/architecture.md`
- [x] T2-2b 드럼 소리를 실제 샘플(Virtuosity Drums, CC0)로 교체 — 의뢰인 피드백(T2-2 합성음이 실제 소리 같지 않음), `intent/07-open-questions.md` Q-19
  - 완료(2026-10-23): `drumVoices.ts`를 Tone.js 신스에서 실제 WAV 샘플 재생(`Tone.Player`, 트리거마다 새 인스턴스로 "발사 후 소멸")으로 교체. Virtuosity Drums(CC0)에서 9종 선정, Python `soundfile`로 FLAC→WAV 변환(가공 없음). 톰은 팩에 2종(Low/High)뿐이라 Low Tom의 center/off-center 실제 타법으로 mid/floor 구분. Codex 모드A에서 샘플 로드 부분 실패 시 정리 누락(C-001)·dispose()가 빈 함수(C-002) 둘 다 필수로 지적·수정, 모드B 1회 APPROVE. 테스트 50개(전체 웹). `intent/03-architecture-stack.md`에 tone(MIT)·Virtuosity Drums(CC0) 라이선스 기록. 증거: `qa-evidence/T2-2b/`, 위키: `wiki/architecture.md`
- [x] T2-3 ∥ 연습 화면 렌더러: 레인 + 킷 점등 + 마디선 (REQ-06). 구현은 병렬 가능, fps 측정(⏱)은 단독 실행
  - 완료(2026-10-24): `app/web/src/render/`(layout.ts 순수 좌표계산, laneRenderer.ts Canvas 2D 그리기, KitIllustration.tsx SVG 킷 점등)·`features/practice/PracticeCanvas.tsx`. jsdom이 Canvas 2D 컨텍스트 없어(T2-2와 같은 사유) 순수 계산만 단위 테스트, 그리기·fps는 실제 브라우저 수동 QA. 수동 QA 중 실제 버그 2건 발견·수정: (1) `Tone.start()` 누락 + `PlaybackHandle` 미추적으로 재생 예외, (2) 렌더 루프가 매 프레임 새 `Set`으로 `setState`해 fps 30으로 저하 — 직전 프레임과 동일하면 skip하도록 수정해 60fps 달성(원자료 포함 재측정 59.94fps). Codex 모드A에서 정지 중 킷 점등 고정(C-001, 필수) 발견·수정, 모드B는 1차 QA 수치 원자료 부족(REQUEST_CHANGES)→원자료 보강 후 2차 APPROVE. 드럼킷 일러스트는 Q-09(의뢰인 디자인 승인 대기)에 따라 단순 도형 placeholder. 테스트 65개(전체 웹). 증거: `qa-evidence/T2-3/`, 로그: `logs/2026-10-24-T2-3-codex.md`, 위키: `wiki/architecture.md`
- [x] T2-4 BPM 변경·A-B 루프 (REQ-04)
  - 완료(2026-10-24): `app/web/src/audio/timing.ts`(`ticksPerBar`·`barIndexForTick`·`computePlaybackSchedule` 순수 함수)·`scorePlayer.ts`(`playbackBpm`·`loop` 옵션)·`laneRenderer.ts`(`playbackBpm` 반영)·`features/practice/PracticeCanvas.tsx`(BPM 슬라이더+숫자 입력, A-B 루프 켜기/끄기+마디 입력, 마디 진행바). A-B 루프는 Tone.js Transport의 네이티브 `loop`/`loopStart`/`loopEnd`를 그대로 사용 — 실제 설치된 버전의 소스(Transport.js/TransportEvent.js/TransportRepeatEvent.js)를 직접 읽어 `schedule()`·`scheduleRepeat()` 이벤트 모두 루프 경계에서 끊김·중복 없이 재발화함을 확인 후 커스텀 재스케줄링 로직 없이 채택. 실제 브라우저에서 BPM 변경이 재생·레인 속도에 반영됨과 A-B 루프 18초(~4.5바퀴) 콘솔 에러 0건을 확인. Codex 모드A에서 긴 곡·짧은 루프 시 진행바가 좁은 구간에서만 움직이는 버그(C-001, 필수) 발견·수정. 모드B는 1차 APPROVE(권장 C-002 재생 중 입력 잠금 반영)→2차 REQUEST_CHANGES(C-001 "0길이 루프" 지적, 전수 시뮬레이션으로 재현 안 됨 반박)→3차 APPROVE(지적 철회) — Codex 지적도 맹목적으로 따르지 않고 검증 후 반박한 사례. "오디오 트랙 음정 유지 속도 변경"은 Phase 2엔 분리 오디오 트랙이 없어 범위 밖(T3-3), 메트로놈 켜기/끄기 UI는 믹서(T3-4)로 분리. 테스트 74개(전체 웹). 증거: `qa-evidence/T2-4/`, 로그: `logs/2026-10-24-T2-4-codex.md`, 위키: `wiki/architecture.md`
- [ ] T2-5 라이브러리 화면·업로드 (REQ-07)
- [ ] T2-6 편집기(추가/삭제/이동, 실행 취소) (REQ-03)
- [ ] T2-7 스티킹: hand 필드, 자동 추천 규칙, 편집기 일괄 교대, 레인·킷 R/L 표시 (REQ-12)
- [ ] **게이트**: 의뢰인이 MIDI 파일 1곡으로 실제 연습해보고 피드백

## Phase 3 — 음원으로 연습
- [ ] T3-1 Separator 모듈(Demucs) + 작업 연결 (REQ-01)
- [ ] T3-2 DrumTranscriber 모듈 → DrumScore (REQ-02 경로 A)
- [ ] T3-3 다중 트랙 동기 재생 + 음정 유지 속도 변경 (REQ-04)
- [ ] T3-4 믹서(볼륨/M/S/프리셋) (REQ-05)
- [ ] T3-5 오디오-MIDI 오프셋 정렬 UI (REQ-02, 03)
- [ ] **게이트**: 의뢰인 음원 2곡으로 연습, 정확도 측정값 보고

## Phase 4 — 종이 악보로 연습
- [ ] T4-1 사진/PDF 업로드 → OMR 작업 → DrumScore (REQ-02 경로 B)
- [ ] T4-2 편집 화면에 원본 이미지 나란히 보기 (REQ-03)
- [ ] **게이트**: 의뢰인 종이 악보 1장을 10분 안에 연습 가능 상태로 만드는지 측정

## Phase 5 — 모든 기기에서
- [ ] T5-1 반응형 레이아웃(폰 세로/가로, 태블릿, PC) (REQ-06)
- [ ] T5-2 PWA 설치 + 오프라인 저장 (REQ-09)
- [ ] T5-3 원격 접속 안내 문서(Tailscale 설치 절차, 사용자 직접 수행) (REQ-08)
- [ ] T5-4 서버 실행 스크립트·자동 시작 안내(윈도우/맥)
- [ ] **최종 게이트**: 전체 QA 보고서 + wiki 정리
