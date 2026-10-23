> 한 줄 요약: 라이선스 표 확정(03 §4). pypdfium2 채택 확정(Q-12). Audiveris AGPL §13은 "수정 시에만" 적용됨을 원문 확인(Q-14) — 법적 결론은 아님, 변호사 확인 권장.

# T0-6 결과 — 라이선스 확정(2026-10-23)

## 근거 REQ
`03-architecture-stack.md` §4 라이선스 표의 ⚠ 항목 해소, Q-12/Q-13/Q-14

## Q-12: PDF→이미지 라이브러리 (해소)
| 라이브러리 | 라이선스 | 출처 |
|---|---|---|
| **pypdfium2** | Apache-2.0 또는 BSD-3-Clause (문서·예제는 CC-BY-4.0) — 강한 카피레프트 없음 | https://pypi.org/project/pypdfium2/ (2026-10-23 확인) |
| PyMuPDF | **듀얼 라이선스**: AGPL-3.0 또는 Artifex 상업 라이선스. 독점(비공개) 애플리케이션에 쓰려면 상업 라이선스 구매 필요 | https://pypi.org/project/PyMuPDF/ (2026-10-23 확인) |

**결론**: 이 프로젝트는 소스를 공개하지 않는 비공개 서비스이므로 **pypdfium2를 채택**(이미 03 문서에 1순위로 기록됨, 이번에 라이선스 문구로 확정). PyMuPDF는 쓰지 않음.

## Q-13: Tailscale Funnel (이미 해소, 재확인만)
공식 문서로 2026-10-23에 이미 확인 완료(`07-open-questions.md` Q-13 참고).

## Q-14: Audiveris(AGPL-3.0)·ADTOF(CC BY-NC-SA 4.0) 소수 사용자 네트워크 서비스 — 조사 결과 (법적 단정 아님)

### Audiveris (AGPL-3.0)
AGPL-3.0 제13조("Remote Network Interaction")의 실제 작동 방식을 검색으로 확인:
> "Section 13 is titled 'Remote Network Interaction; Use with the GNU General Public License,' and it applies only when you modify the Program." — 출처: cliki.net/AGPL (AGPL 원문 해설 인용), martech.zone/acronym/agpl (2026-10-23 확인)

즉 **AGPL의 "네트워크로 서비스하면 소스 공개" 의무는 프로그램을 "수정"했을 때만 추가로 발생**한다. 우리 설계는 Audiveris CLI를 **수정 없이 외부 프로세스로 호출**하는 방식(`06-pipeline.md`의 구조대로)이므로, 이 추가 의무(제13조)가 적용되지 않을 가능성이 있다. 다만:
- 이것은 AGPL 해설 요약을 인용한 것이고 **원문 전체(gnu.org/licenses/agpl-3.0)를 직접 대조하지는 못함**(이 조사 중 해당 사이트가 일시적으로 요청을 거부함, HTTP 429). 나중에 원문으로 재확인 권장.
- "수정"의 범위(예: Audiveris 설정 파일만 바꾸는 것도 수정인지)는 법적으로 더 따져봐야 함.
- **법적 해석은 전문가 확인이 필요**하며, 이 보고서는 조사 결과일 뿐 법률 자문이 아님.

### ADTOF (CC BY-NC-SA 4.0)
- "NonCommercial"은 CC 라이선스 정의상 "상업적 이익이나 금전적 보상을 주된 목적으로 하지 않는 것"을 의미. 이 서비스는 무료·초대제·비상업이므로 NC 조건에는 부합하는 것으로 보임.
- CC BY-NC-SA에는 AGPL 같은 "네트워크 사용 시 소스 공개" 조항이 없음 — ShareAlike는 "각색물을 배포/공유"할 때 적용되는데, 사용자에게 모델 자체나 그 수정본을 전달하는 게 아니라 **채보 결과(출력물)만** 보여주는 구조라 ShareAlike가 트리거되는지는 불분명.
- 이 역시 법적 결론이 아니며, 상업화하지 않는 한 위험은 낮다고 보이나 확정은 전문가 확인 필요.

## 결론 (제안, 최종 판단은 의뢰인/필요시 변호사)
- pypdfium2 채택 확정.
- Audiveris·ADTOF 둘 다 "수정 없이 그대로 서비스에서 호출 + 소수 비상업 사용자"라는 현재 설계를 유지하면 위험이 낮아 보이나, **100% 확정은 아님**. Phase 1~3에서 실제로 소스를 수정하게 되면(예: Audiveris 드럼 인식 정확도 개선을 위해 코드를 고치는 경우) 이 결론이 바뀌므로 그 시점에 재검토 필요.
