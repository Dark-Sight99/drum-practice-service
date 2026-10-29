> 한 줄 요약: Codex 모드A 코드 검수 — 1라운드 REQUEST_CHANGES(High 1건·Medium 1건) 전부 반박 근거(수치 검증) 제시 후 2라운드에서 둘 다 철회, APPROVE.

# T3-72 Codex 모드A 검수 로그

## 라운드 1 — REQUEST_CHANGES

Target: `task/T3-72-downbeat-phase-alignment` 전체 diff vs `main`.

Findings:
- **High — "오프셋이 틀린 배속으로 적용됨"**(`audio/timing.ts:91` `audioTrackPositionSeconds`): 현재 식 `(transportSeconds-songStartSeconds)*playbackRate + audioOffsetSeconds`가 오프셋을 배속과 무관하게 더한다며, `(transportSeconds-songStartSeconds+audioOffsetSeconds)*playbackRate`로 고쳐야 한다고 지적. 기존 테스트(2.5배속에서 0.28초 오프셋을 그대로 기대)가 "이 오류를 고정시킨다"고 주장.
- **Medium — "백엔드·프런트 BPM 경계값 불일치"**(`schemas.py:107`/`validate.ts:105`): "매우 큰 유한 BPM에서 `60_000.0/bpm`이 Python에서는 0.0으로 언더플로할 수 있는데 JS는 작은 양수로 남을 수 있다"고 지적.

## 반박(수치 검증 후 재질의)

- **Finding 1 반박**: `audioOffsetSeconds`(t0)는 원곡 파일 안의 **고정된 좌표**(다운비트가 파일의 몇 초 지점인지)이지, 지금 재생 배속에 따라 늘어나거나 줄어드는 값이 아니다. `transportSeconds===songStartSeconds`(틱 0=다운비트 도달 순간)일 때 파일 위치는 배속과 무관하게 정확히 t0이어야 한다 — 그게 다운비트 오디오가 실제로 있는 파일상의 위치이기 때문. 수치로 확인: `transport=songStart=2, rate=2.5, offset=0.28`일 때 현재 식은 0.28(올바름), Codex 제안식은 0.7(틀림 — 고정 좌표를 배속으로 스케일). `timing.test.ts`의 `'at song start, position equals the downbeat offset (not 0) when audioOffsetSeconds is set'`(배속과 무관, 2.5배속에서도 0.28 기대)는 의도적으로 설계된 불변식이지 실수가 아니라고 반박.
- **Finding 2 반박**: IEEE-754 double 최대 유한값은 약 1.7976931348623157e+308. `60000/bpm`이 정확히 0.0으로 언더플로하려면 `bpm`이 최소 양의 서브노멀(약 4.94e-324)의 역수 근방, 즉 약 1.2e+328이 필요한데 이는 표현 가능한 최대 유한 double보다 20자릿수 이상 크다 — 즉 **유한한 double bpm으로는 이 언더플로가 물리적으로 불가능**. 게다가 Python float와 JS number는 둘 다 IEEE-754 binary64라 같은 bpm 값에 대해 완전히 동일한 나눗셈 결과를 낸다(언어 간 차이 자체가 없음). `sys.float_info.max`로 직접 계산해 `60000/max_double ≈ 3.3e-304`(언더플로와 거리가 멂)임을 확인해 제시.

## 라운드 2 — APPROVE

두 반박을 모두 받아들여 **두 지적 모두 철회**:
> "The first finding was wrong: playback rate scales elapsed transport time from `songStartSeconds`; `audioOffsetSeconds` is a fixed coordinate inside the original audio file... the current formula and its test are correct."
> "The second scenario was also wrong: the smallest positive result from dividing `60000` by the largest finite IEEE-754 double remains far above zero... the claimed Python/JavaScript boundary discrepancy does not occur."

그 외 검수 범위(라운드 1 본문에 포함): `audioTrackPositionSeconds` 실제 호출부 6곳 전부 4번째 인자(오프셋)를 올바르게 넘기는지(grep으로 직접 확인, 전부 통과), `midi_to_drumscore.py`의 `max(0, round(...))` 클램프가 `audioOffsetMs`와 일관되는지(통과), `estimate_downbeat_offset_seconds`의 원형평균 수식과 범위 가드(통과) — 전부 "지적 없음".

## 결론
코드 수정 없이(두 지적 모두 반박으로 철회) 모드A **APPROVE**. `qa-evidence/T3-72/result.md`의 QA(단위 테스트 570개 + 실제 재채보 end-to-end)와 합쳐 `main` 병합 조건 충족.
