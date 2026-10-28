> 한 줄 요약: 오디오 지연 보정(REQ-04) + 블루투스 안내 + 업로드 전 음질 경고 + 반응형 설정 패널(Drawer/사이드바) 구현·자체 QA 결과.

# T3-47 결과

## 배경
- `qa-evidence/T3-46/result.md` — YOASOBI 곡 "노트보다 소리가 늦게 들린다" 문의를
  블루투스 이어폰 출력 지연(앱 버그 아님)으로 확정.
- 의뢰인 승인 3개 기능을 한 번에 구현(대화 로그): ① 오디오 지연 보정(사용자가
  직접 ms 입력), ② 블루투스 안내 문구(재생 버튼 근처 상시 노출), ③ 업로드 전
  음질 경고(경고만 하고 업로드는 허용 — AskUserQuestion으로 확정).
- 구현 중 의뢰인 추가 요청으로 설정 UI(BPM·오디오 지연 보정·믹서·보이는 마디
  수)를 반응형 패널로 재구성: 넓은 화면은 왼쪽 사이드바 상시 노출, 좁은
  화면(900px 이하)은 설정 버튼으로 여는 왼쪽 Drawer.

## 구현
- `app/web/src/audio/scorePlayer.ts` — `audioLatencyCompensationMs` 옵션. 소리
  트리거 시각만 당기고(카운트인 클릭·노트·트랙 시작), 오디오 콘텐츠 위치
  계산(`audioTrackPositionSeconds`)은 보정 전 "진짜" 시각 그대로 사용(연속
  재생 중인 트랙이 자연히 보정만큼 앞서가도록).
- `app/web/src/components/Drawer.tsx`(신규) — `Modal.tsx`와 같은 배경 클릭·Esc
  닫힘 규칙, 위치만 화면 왼쪽/오른쪽 선택 가능(`side` prop, 기본 right, 연습
  화면은 left로 사용).
- `app/web/src/features/practice/PracticeCanvas.tsx` — `useNarrowSettingsLayout`
  훅(900px 기준)으로 반응형 분기. BPM·오디오 지연 보정·믹서·보이는 마디 수를
  `settingsPanelContent`로 묶어 넓은 화면은 좌측 사이드바, 좁은 화면은 Drawer에
  동일하게 렌더링. 블루투스 안내문·드럼킷 그림은 설정이 아니라 항상 표시되는
  정보라 메인 영역에 유지.
- `app/web/src/audio/qualityCheck.ts`(신규) — 업로드 파일을 브라우저에서
  디코딩해(`AudioContext.decodeAudioData`) 6kHz 이상 에너지 비율을 계산
  (`work/T3-45-hihat-detection-experiment/compare_spectrum.py` 실측 기준: 결함
  파일 0.03% vs 정상 소스 3~3.8% — 그 사이인 1%를 기준값으로).
- `app/web/src/features/upload/UploadScreen.tsx` — 음원 파일 선택 시
  `checkHighFrequencyContent()`를 비동기로 실행(업로드 자체를 막지 않음).
  `isLowQuality`면 승인된 문구로 경고 + [그대로 업로드]/[다른 파일 선택] 버튼을
  보여주고, "그대로 업로드"를 누르기 전엔 제목/아티스트 폼을 숨긴다(차단은
  아님 — 의뢰인이 "경고만 하고 업로드는 허용"으로 확정).

## 테스트
- `npx vitest run` (app/web) — **274/274 통과** (신규 `qualityCheck.test.ts` 6개
  포함: FFT 피크 검출, 비2^k 길이 에러, 저주파만/고주파만/혼합 신호의
  `isLowQuality` 판정, 너무 짧은 신호의 안전한 기본값).
- `npx tsc --noEmit` — 에러 없음.
- `npx oxlint` (수정 파일 대상) — 에러 없음.

## 브라우저 수동 QA (Claude 내장 브라우저, 실제 Web Audio API로 end-to-end 확인)
1. **반응형 설정 패널** — 1400px 폭: 좌측에 BPM·오디오 지연 보정·믹서·보이는
   마디 수가 사이드바로 항상 펼쳐짐(설정 버튼 없음) 확인(`get_page_text`).
   420px 폭: "설정" 버튼만 보이고, 클릭 시 같은 4개 컨트롤이 왼쪽에서 슬라이드로
   나오는 Drawer로 열림(스크린샷 확인), X 버튼으로 닫힘.
2. **업로드 음질 경고** — 실제 WAV 파일을 JS로 합성해(DataTransfer로 네이티브
   파일 input에 주입) 업로드 모달에 선택:
   - 200Hz 순음(고주파 거의 0, 결함 파일 흉내) → 승인된 문구 그대로 경고 노출,
     [그대로 업로드]/[다른 파일 선택] 버튼 확인(스크린샷).
   - [다른 파일 선택] 클릭 → 선택 상태·경고 모두 깨끗이 초기화됨 확인.
   - 저주파(85%)+8kHz(15%) 혼합(정상 소스와 같은 비율, T3-45 실측 기준) →
     경고 없이 제목/아티스트 폼이 바로 뜸 확인(오탐 없음).
   - 두 경우 모두 콘솔에 새로운 에러 없음(기존 401/일시적 HMR 메시지만 — 이번
     변경과 무관, 인증 미연결 상태의 기존 현상).
3. 지연 보정 입력 필드(ms)·블루투스 안내문은 T3-46 이전 단계에서 이미 수동
   확인(로컬스토리지 저장/복원, 재생·탐색 중 콘솔 에러 없음).

## 남은 작업
- Codex 모드A 검수 → 통과 시 `main` 병합.
