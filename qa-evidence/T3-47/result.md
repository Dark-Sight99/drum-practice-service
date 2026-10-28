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

## Codex 모드A 검수 (1라운드) 및 반영
`task-mvrx4j3r-z1ey6n` — 판정 **REQUEST CHANGES**. 지적 사항과 반영 내역:

- **Major C-001** — `scorePlayer.ts`: 양수 보정값이 루프 재시작 이벤트(트랙
  재시작 콜백)의 예약 시각을 `loopStartSeconds` 밑으로 밀어내, Tone 네이티브
  루프의 "[loopStart, loopEnd) 안의 이벤트만 매 루프 재진입 때 재발화" 규칙을
  벗어나 루프 재진입 시 다시 안 울리는 회귀 — **반영**. 다만 단순히
  `loopStartSeconds` 정확히 그 값으로 바닥을 고정하는 것만으론 부족했다:
  Claude 내장 브라우저에서 실제 Tone.js 15.1.22(이 프로젝트 설치 버전)를
  직접 실행해 확인한 결과, loopStart 경계에 정확히 걸치거나 그로부터
  ~3~4ms 이내인 `schedule()` 이벤트는 최초 1회만 울리고 이후 루프
  재진입에서 재발화하지 않는 별도의 경계 양자화 버그가 있었다(같은 이벤트를
  loopStart+10~20ms 지점에 두면 여러 loopStart·loop 길이 조합에서 반복
  재발화 확인). 바닥을 `loopStartSeconds + 20ms`(확인된 위험 구간의 5배
  이상 여유)로 설정해 해결 — 이 바닥은 보정값이 0이어도 적용되므로, 이
  수정은 지연 보정 기능 자체가 없던 시절부터 존재했을 수 있는 "루프 시작
  정각에 걸친 노트/트랙 재시작이 재진입에서 안 울리는" 잠재 버그도 같이
  막는다(자세한 근거는 `scorePlayer.ts`의 `compensatedTriggerTime` 주석).
- **Minor C-002** — `scorePlayer.ts`: 0초 바닥 클램프로 곡 맨 앞 근처 여러
  이벤트가 겹칠 수 있다는 지적 — UI가 이미 ±500ms로 제한하고, 겹쳐도
  클릭/노트 신스가 같은 틱에 중복 트리거될 뿐 들리는 차이가 없어 코드
  주석으로 근거만 명시(동작 변경 없음).
- **Minor C-003** — `qualityCheck.ts`: 좌우 채널을 시간 영역에서 평균해
  모노로 합친 뒤 FFT 1회만 구하던 방식은, 좌우 채널의 고주파 성분이 서로
  반대 위상이면 평균 과정에서 상쇄돼 실제론 하이햇/심벌이 들리는 음원도
  저품질로 오판할 수 있다는 지적 — **반영**. 채널마다 따로 FFT를 구해
  크기(항상 0 이상이라 상쇄 불가능)를 합산하는 방식으로 변경
  (`mixToMono` 제거, `analyzeHighFrequencyRatio`가 이제 `Float32Array[]`를
  받음). 기준값(`LOW_HIGH_FREQUENCY_RATIO_THRESHOLD`)은 비율 계산 방식만
  바뀌었을 뿐이라 그대로 유지.

## 테스트
- `npx vitest run` (app/web) — **275/275 통과**(C-003 반영 후 위상-상쇄
  회귀 테스트 1개 추가: 좌우 채널 고주파가 반대 위상이어도 저품질로 오판하지
  않음 — 같은 신호를 시간 영역 평균으로 모노화하면 실제로 상쇄돼
  저품질처럼 보인다는 전제까지 같은 테스트에서 확인).
- `npx tsc --noEmit` — 에러 없음.
- `npx oxlint` (수정 파일 대상) — 에러 없음.

## C-001 수정 실측 검증 (Claude 내장 브라우저, 실제 Tone.js/Web Audio)
1. **격리 환경 검증**: 앱이 실제로 쓰는 것과 동일한 Tone.js 모듈 인스턴스를
   (Vite가 리졸브한 동일 URL로) 새 탭에서 직접 import해, `transport.schedule()`
   + `setLoopPoints()` + `transport.loop=true` 조합만으로 경계 재현 —
   loopStart 정확히 그 값(및 +0~3ms)에 예약한 이벤트는 여러 loopStart/길이
   조합에서 반복적으로 1회만 발화, +4ms 이상(10~20ms로 넉넉히 확인)은
   안정적으로 매 루프 재진입마다 재발화함을 확인.
2. **실제 앱 통합 검증**: pretender 곡 연습 화면에서 오디오 지연 보정을
   300ms로 설정, 1마디 길이 A-B 루프(3~4마디)를 걸고 재생 — `playFrom()`이
   `<audio>.play()`를 호출하는 지점을 `HTMLMediaElement.prototype.play`
   몽키패치로 계측. 약 15초(카운트인 + 루프 4회전) 동안 재생 트랙 4개 ×
   루프 4회전 = **16회 `play()` 호출**이 ~5.2초 간격으로 고르게 발생함을
   확인 — 수정 전 코드였다면(격리 환경 검증과 동일한 경계 버그로) 최초
   1회(트랙 4개 분량)만 호출되고 이후 재진입에서 트랙이 재시작되지 않았을
   것. 테스트 중 콘솔 에러 없음.

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
- Codex 모드A 2라운드 재검수(위 수정 반영분) → APPROVE 시 `main` 병합.
