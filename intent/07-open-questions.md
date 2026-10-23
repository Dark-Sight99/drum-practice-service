> 한 줄 요약: 아직 결정되지 않았거나 검증이 필요한 항목. 에이전트는 이 항목을 임의로 결정하지 말고 검증·질문한다.

# 07. 미결정·검증 필요 항목

| ID | 항목 | 현재 상태 | 해소 방법 |
|---|---|---|---|
| Q-01 | 서버 PC: 윈도우(RTX 5060) vs 맥(M1) | 기본값 = 윈도우(개발 PC와 동일, 낮 내내 사용). 맥은 거의 안 써서 보류. 게임 중 부하는 실측하지 않고 의뢰인 체감으로 판단(필요 시 REQ-01의 CPU 전용 모드/작업 일시정지로 대응) | T0-1은 윈도우만 실측 + 공용 벤치마크 스크립트를 `qa-evidence/T0-1/`에 남김 → 맥 입수 후 의뢰인이 직접 실행해 결과 공유 → 최종 결정 |
| Q-11 | 스티킹 자동 추천 규칙의 타당성 | 오른손잡이 기본 규칙(REQ-12) | Phase 2 게이트에서 의뢰인이 실제 곡으로 검토 |
| Q-02 | 드럼 채보 모델 | **진행중 해소**(2026-10-23). 원본 ADTOF(madmom 의존)는 이 PC에서 빌드 불가(MSVC/WSL 없음) → 대안 **ADTOF-pytorch**로 Phase 0 테스트 진행(의뢰인 선택). MDB Drums 5트랙 F-measure macro 0.7585(클래스별 수치는 `qa-evidence/T0-2/result.md`). 라이선스 이슈는 Q-15 | T0-2 측정 완료. Phase 3 채택 여부는 Q-15(라이선스) 해소 후 최종 결정 |
| Q-03 | 종이 드럼 악보 OMR 품질 | **검증됨**(2026-10-23). 퍼커션 클레프 완전 인식 40%(16/40), 부분 35%, 전혀 안 됨 22.5%. 인식돼도 하이햇 보이스를 톰으로 잘못 배정하는 등 악기 매핑 오류 있음(표본 점검). 박자 경고는 21장 전부 발생. 이 압축 한 줄 표기가 비표준적이라 그럴 가능성 있음(표준 5선 표기로 재검증 전까진 확정 아님) | T0-3 완료. REQ-03 편집기 필수성 확인. 표준 표기 샘플 있으면 추가 검증 가능 |
| Q-04 | 음정 유지 속도 변경 방식 | **해소됨**(2026-10-23, 의뢰인 승인). `preservesPitch`(HTMLMediaElement 내장) 채택 확정. SoundTouch(AudioWorklet, `@soundtouchjs/audio-worklet`)는 iPhone 13 Pro·iPad mini 5 실기기에서 간헐적으로 오디오 엔진이 수 초씩 밀리는 현상(불규칙, 배속과 무관) 재현 확인 — 채택 안 함 | 해소됨. 상세: `qa-evidence/T0-5/result.md` |
| Q-05 | 오디오-화면 동기 허용 오차 | 초기 목표 ±30ms. **T0-5에서 완전히 확정 못함** — 측정 방식이 두 내부 클록 비교일 뿐 실제 메트로놈·분리 오디오 트랙과의 동기가 아니고, 공통 출력 시작 지연(추정)이 보정 안 된 채 남아 있음(preservesPitch·SoundTouch 정상 구간 모두 배속 비례 -200~-600ms대 공통 오프셋 관측) | Phase 2~3에서 실제 메트로놈(Tone.js)·분리 오디오 트랙 함께 재생하는 end-to-end 테스트로 재검증 |
| Q-06 | 원격 접속: Tailscale vs Cloudflare Tunnel | Tailscale 확정(개인 무료 플랜, 최대 6명, 비상업) | 해소됨(2026-10-23) |
| Q-07 | 상업화 여부 | 현재 "비공개, 지인 포함 소수 사용자(최대 6명), 비상업" | 범위 확대(불특정 공개) 시 ADTOF·Audiveris 라이선스 재검토 |
| Q-08 | Demucs 현재 유지 저장소·설치 방법 | **해소됨**(2026-10-23). `facebookresearch/demucs`는 archived, 현재는 `adefossez/demucs` 포크가 유지(v4.1.0, 2026-07-11). `pip install demucs numpy`로 설치, numpy는 별도 설치 필요 | wiki/tools.md 기록 완료 |
| Q-09 | 드럼킷 그래픽 제작 방식 | 자체 SVG | Phase 2 디자인 시 의뢰인 확인 |
| Q-10 | 셈여림 표시 신뢰도 | 자동 채보 셈여림은 정확도 미검증 | Phase 3 측정 |
| Q-12 | PDF→이미지: pypdfium2 vs PyMuPDF 라이선스 | **해소됨**(2026-10-23). pypdfium2=Apache-2.0/BSD-3-Clause(비카피레프트) 확인, PyMuPDF=AGPL/Artifex 상업 듀얼 확인. **pypdfium2 채택 확정** | 해소됨 |
| Q-13 | Tailscale Funnel이 개인 무료 플랜에 포함되는지 | **확인됨**(2026-10-23, tailscale.com/kb/1223/funnel 공식 문서: "Funnel is available for all plans" — 단, 현재 베타 단계, MagicDNS·HTTPS 인증서 활성화 필요) | 해소됨. 채택(지인 초대에 Funnel 쓸지, 일반 Tailscale 네트워크 참여로만 할지)은 의뢰인 별도 결정 |
| Q-14 | Audiveris(AGPL)·ADTOF(NC)를 지인 포함 소수 사용자(최대 6명) 네트워크 서비스로 쓸 때 라이선스 의무 | **조사 완료, 법적 결론 아님**(2026-10-23). AGPL 제13조(네트워크 소스공개 의무)는 "프로그램을 수정했을 때만" 추가 적용됨(원문 해설 인용 확인). 우리는 Audiveris를 수정 없이 외부 프로세스로 호출할 계획이라 해당 의무가 적용 안 될 가능성. ADTOF(NC)는 비상업·무료 초대제라 NC 조건에 부합하는 것으로 보임. 상세: `qa-evidence/T0-6/result.md` | 전문가 확인 권장(특히 Audiveris 코드를 실제로 수정하게 될 경우 재검토) |
| Q-15 | ADTOF-pytorch(xavriley 포크) 라이선스 | **신규**(2026-10-23). 저장소에 LICENSE 파일 없음, GitHub API `license: null`. 원본 ADTOF(CC BY-NC-SA 4.0) 가중치를 변환해 쓰지만 자체 라이선스 표시가 없어 사용 권한 불분명. 현재는 Phase 0 내부 테스트(배포 없음)에만 사용 | Phase 3(T3-2) 채택 전 저자에게 문의하거나 재확인 필요. 해소 전까지 프로덕션 채택 보류 |
| Q-16 | 관리자 계정 생성 API(`POST /admin/users`)에서 다른 관리자 계정(`is_admin=true`)도 만들 수 있게 둘지 | **신규**(2026-10-23, T1-3 Codex 모드A C-002). 지금은 제한 없이 관리자가 관리자를 만들 수 있음 — 의뢰인 혼자 관리자인 전제(REQ-08)라 현재는 위험 낮다고 판단해 그대로 둠 | 의뢰인이 "관리자는 항상 1명만"으로 제한하길 원하면 API에서 `is_admin` 지정을 막도록 수정 |
| Q-17 | 작업 큐 워커(`python -m worker.runner`)를 동시에 2개 이상 띄울 때의 동작 | **신규**(2026-10-23, T1-4 Codex 모드A C-002, 재현 안 함/판단 대기). 큐 작업 선점 자체는 원자적으로 고쳐 이중 처리는 막았음(C-001 수정 완료, `worker/runner.py`의 `_claim_next_job`). 다만 `recover_orphaned_jobs()`는 워커 소유자를 구분하지 않아, 워커 B가 시작하면서 워커 A가 지금 정상 처리 중인 PROCESSING 작업까지 FAILED로 표시해버릴 수 있음(코드 검토로 확인, 실제 재현 실행은 안 함). 제대로 고치려면 Job에 "어느 워커가 처리 중인지" 식별자를 추가하는 **스키마 변경**이 필요해 이번 작업 범위를 벗어난다고 판단해 수정 안 함. `intent/03-architecture-stack.md`·`work/T1-4/plan.md`는 애초에 워커 프로세스를 1개만 띄우는 전제라, 현재는 실질적 위험 없음 | 운영상 워커를 2개 이상 띄울 계획이 생기면(Phase 5 성능 확장 등) 이때 Job에 워커 식별자/하트비트 컬럼을 추가하는 설계부터 다시 검토. 지금은 "워커 프로세스는 항상 1개만 띄운다"는 운영 규칙으로 대응 |
| Q-18 | Guitar Pro(.gp/.gp3~.gp5/.gpx) 파일의 실제 가져오기 검증 | **부분 해소**(2026-10-23, T2-1, Codex 모드A C-001 지적으로 보강). 사람이 실제로 Guitar Pro로 만든 샘플 파일이 없어, Phase 0 실제 MusicXML 샘플(`qa-evidence/T0-4/drum_test.musicxml`)을 alphaTab 자신의 `Gp7Exporter`로 **진짜 Guitar Pro 7+ 바이너리**(`qa-evidence/T2-1/drum_test_roundtrip.gp`)로 내보낸 뒤 우리 가져오기 경로로 재파싱 — kick/snare/hihat_closed 전부 정확히 복원됨(테스트로 증명, `work/T2-1/report.md`). 메커니즘 자체(파싱→원자적 선점 아님, GM 매핑)는 실제 GP7 바이트로 검증됐으나, **사람이 실제 Guitar Pro 앱으로 만든 파일**(다른 GP 버전 3~6, 실제 사용자의 표기 습관)은 아직 테스트 못함 | 의뢰인이 실제로 가진 GP 파일(특히 오래된 .gp3~.gp5)이 있으면 제공받아 추가 검증 |
