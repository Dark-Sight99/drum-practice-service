> 한 줄 요약: T3-7(킥 음량 보정 + 레인 순서 변경) QA 결과 — ffmpeg로 실측한 근거로 킥 볼륨 +9dB 보정, 레인에서 킥을 스네어 다음으로 이동. 테스트/타입체크/린트 통과, 브라우저로 레인 순서·재생 확인.

# T3-7 QA 결과

## 근거(REQ)
- REQ-06 드럼 연습 화면(레인 순서), REQ-02 관련 드럼 샘플 음량.
- 의뢰인 피드백(2026-10-25, 대화 로그): "kk소리가 너무 작은데 키워줄 수 있나? 다른 악기에 비해 거의 안들리는 편이야 소리가. 그리고 kk위치를 sn과 ht 사이로 옮겨줘. kk도 자주 타음하는데 동떨어져있어서 같이 한번에 보기가 힘드네."

## 변경 내용
1. **킥 음량 보정** — `app/web/src/audio/drumVoices.ts`에 `PIECE_GAIN_BOOST_DB`(피스별 보정 dB) 추가, `kick: 9`로 설정. `sampleVoice()`가 `piece`를 받아 `trigger()`에서 `velocityToDb(velocity) + (PIECE_GAIN_BOOST_DB[piece] ?? 0)`로 적용.
   - **근거(추측 아님, 실측)**: `public/audio/drums/*.wav` 9종을 `ffmpeg -af volumedetect`로 직접 측정 — kick.wav 피크 **-13.0dB**(평균 -33.4dB)로, 자주 같이 치는 snare.wav(피크 -0.2dB)보다 12.8dB, tom_high.wav(-3.2dB)·tom_mid.wav(-4.1dB)보다도 뚜렷이 작음. +9dB를 더하면 킥 피크가 약 -4dB로 올라와 tom_high/tom_mid와 비슷한 체감 크기가 되고, 0dBFS(클리핑)보다 한참 작아 안전함(심벌류는 원래 더 작게 들리는 음색이라 보정 대상에서 제외 — 의뢰인도 킥만 지적).
2. **레인 순서 변경** — `app/web/src/render/layout.ts`의 `LANES` 배열에서 킥을 맨 끝(라이드 다음)에서 스네어 바로 다음(하이탐 앞)으로 이동. `HH CR SN HT MT FT RD KK` → `HH CR SN KK HT MT FT RD`.
3. `intent/04-ui-ux.md` §3 와이어프레임·레인 순서 설명 갱신(의뢰인이 지금 채팅에서 직접 요청한 변경이라 문서 수정 승인으로 간주), `laneRenderer.ts`의 역사적 순서 주석도 "더 이상 최신 순서 아님" 명시.

## 자동 테스트
```
cd app/web
npx tsc --noEmit        # 통과
npm test -- --run       # 17 test files / 189 tests 모두 통과(회귀 없음 — LANES 순서를 검증하는 테스트가 없어 그대로 통과)
npm run lint            # oxlint 통과, 경고 없음
```
킥 음량 보정 자체는 자동 테스트 추가 안 함 — `PIECE_GAIN_BOOST_DB`는 비공개 상수고, `trigger()`의 실제 재생은 jsdom에 Web Audio가 없어 이 파일 전체가 기존부터 단위 테스트 범위 밖(순수 함수 `velocityToDb`만 테스트해온 기존 선례와 동일한 기준 — work/T3-6/plan.md에서도 같은 판단).

## 브라우저 수동 검증 (localhost:5173, 로그인된 세션, huibigyocha 곡)
- 레인 머리글이 `HH CR SN KK HT MT FT RD` 순서로 정확히 표시됨(스크린샷 확인).
- 재생 시작 → 콘솔 에러 0건, 재생/일시정지/정지 버튼 상태 정상 전환(킥 보정 게인 적용이 Tone.Player 생성·트리거에 문제를 일으키지 않음을 확인).
- (참고) 테스트 중 임시로 띄운 별도 preview 서버 인스턴스에서 드럼 샘플 9개가 전부 ERR_CONNECTION_REFUSED로 실패하는 현상이 재현됐으나, 같은 코드를 의뢰인이 쓰던 기존 장기 실행 dev 서버(5173)의 새 탭에서 재시도하자 0건 에러로 정상 재생됨 — 반복적으로 껐다 켠 테스트용 서버 인스턴스 쪽의 일시적 현상으로 판단, 코드 문제 아님(같은 커밋으로 안정된 서버에서 재현 안 됨).
- 킥 소리 자체가 실제로 더 크게 들리는지는 Claude가 들을 수 없어 가청 검증 불가 — ffmpeg 실측값(§변경 내용 1)이 근거. 의뢰인 실사용 확인 필요.

## 결론
레인 순서 변경은 코드·브라우저로 확실히 검증됨. 킥 음량 보정은 측정값 기반으로 적용했으나 "충분히 커졌는지"는 의뢰인이 직접 들어봐야 확정 가능 — 부족하거나 과하면 `PIECE_GAIN_BOOST_DB.kick` 값(현재 9)만 조정하면 됨.
