# song2.json은 악보 데이터라 레포에 커밋하지 않는다(CLAUDE.md §5 data/ 커밋 금지 원칙과
# 같은 취지) — 재현하려면 로그인 후 GET /songs/2/drumscore 로 받은 응답을 이 경로에 저장.
#
# T2-14, Phase 2 게이트 7차 피드백 — "HH가 일정한 간격으로 치는데(마디당 8번), SN은
# 항상 같은 HH 타격에 맞춰 같이 친다면, SN의 마디 내 위치도 항상 같아야 하는 것
# 아니냐"는 의뢰인의 날카로운 재반박을 검증한다. 가설: (1) SN이 정말 항상 같은 틱의
# HH와 일치하는지, (2) HH 자체가 정말로 "교과서적으로 균등한" 8분음표 간격(220/2=110틱)
# 인지 직접 확인.
import json
import numpy as np
from collections import Counter

with open(r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\t211830\song2.json", encoding="utf-8") as f:
    score = json.load(f)

notes = score["notes"]
ppq = score["ppq"]
bpm = score["meta"]["bpm"]
bar_ticks = ppq * 4

hh = sorted(n["tick"] for n in notes if n["piece"] in ("hihat_closed", "hihat_open"))
sn = sorted(n["tick"] for n in notes if n["piece"] == "snare")
hh_set = set(hh)

print("total HH notes:", len(hh), "total SN notes:", len(sn))

print("\n--- 1. SN이 HH와 정확히 같은 틱에 있는지(바 9~13, 끊기지 않은 구간) ---")
for bar in range(9, 14):
    lo, hi = bar * bar_ticks, (bar + 1) * bar_ticks
    hh_in_bar = [t for t in hh if lo <= t < hi]
    sn_in_bar = [t for t in sn if lo <= t < hi]
    print(f"bar={bar} HH offsets={[t-lo for t in hh_in_bar]} (count={len(hh_in_bar)})")
    print(f"       HH gaps={[hh_in_bar[i+1]-hh_in_bar[i] for i in range(len(hh_in_bar)-1)]}")
    for s in sn_in_bar:
        exact = s in hh_set
        print(f"       SN offset={s-lo} exact_HH_match={exact}")

print("\n--- 2. 곡 전체: SN-HH 정확 일치율 ---")
exact_matches = sum(1 for s in sn if s in hh_set)
print(f"SN notes with exact same-tick HH match: {exact_matches}/{len(sn)}")

print("\n--- 3. 곡 전체: HH 자체의 연속 간격(gap) 통계 ---")
gaps = np.array([hh[i + 1] - hh[i] for i in range(len(hh) - 1)])
small_gaps = gaps[gaps < 200]  # 마디 경계/쉼으로 인한 큰 gap 제외
ideal_eighth = ppq / 2
print(f"이상적인 8분음표 간격(교과서 기준, 균등 분할): {ideal_eighth} 틱")
print(f"실제 HH 연속 간격(gap<200틱, n={len(small_gaps)}): "
      f"평균={small_gaps.mean():.2f}, 표준편차={small_gaps.std():.2f}, "
      f"최소={small_gaps.min()}, 최대={small_gaps.max()}")

print("\n--- 4. 마디당 HH 타격 수 분포 ---")
bar_counts = Counter(t // bar_ticks for t in hh)
counts = list(bar_counts.values())
print("마디당 HH 타격 수 분포:", sorted(Counter(counts).items()))

print("\n--- 5. 정량적 일관성 검증: HH 간격 초과분으로 SN 드리프트 예측 ---")
mean_gap = small_gaps.mean()
predicted_drift_ticks_per_bar = (mean_gap - ideal_eighth) * 8  # 마디당 명목 8타격 기준
measured_drift_beats_per_bar = 0.3582  # T2-13 backbeat_drift_analysis.py 결과(9~13마디)
measured_drift_ticks_per_bar = measured_drift_beats_per_bar * ppq
print(f"HH 간격 초과분으로 예측한 마디당 드리프트: {predicted_drift_ticks_per_bar:.1f}틱")
print(f"T2-13에서 실측한 SN 백비트 드리프트: {measured_drift_ticks_per_bar:.1f}틱")
print(f"두 값의 비율: {predicted_drift_ticks_per_bar / measured_drift_ticks_per_bar:.3f} "
      "(1.0에 가까울수록 같은 현상임을 뒷받침)")
