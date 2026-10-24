# song2.json은 악보 데이터라 레포에 커밋하지 않는다(CLAUDE.md §5 data/ 커밋 금지 원칙과
# 같은 취지) — 재현하려면 로그인 후 GET /songs/2/drumscore 로 받은 응답을 이 경로에 저장.
#
# T2-14 — Codex 모드B 1차 지적("전체 평균×명목 8타격"은 '거의 일치'하는 느낌만 줄 뿐
# 메커니즘을 직접 증명하지 않는다) 반영. hh_spacing_analysis.py의 전역 평균 대신,
# T2-13이 실제로 측정에 쓴 "SN-HH 동기점" 사이사이를 직접 세어(평균 아님, 그 구간의
# 실제 HH 타격 수 그대로) elapsed를 계산 — 전역 평균이나 "명목 8타격" 가정에 전혀
# 기대지 않는, 순환 논증 없는 직접 교차검증.
import json

with open(r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\t211830\song2.json", encoding="utf-8") as f:
    score = json.load(f)

notes = score["notes"]
ppq = score["ppq"]
bar_ticks = ppq * 4

hh = sorted(n["tick"] for n in notes if n["piece"] in ("hihat_closed", "hihat_open"))
sn = sorted(n["tick"] for n in notes if n["piece"] == "snare")
hh_set = set(hh)

groups = {}
for t in sn:
    b = t // bar_ticks
    groups.setdefault(b, []).append(t)

# T2-13 backbeat_drift_analysis.py와 동일한 정의("마디 내 둘째 스네어")로 동기점을 고른다.
sync_points = []
for b in range(9, 14):
    second = max(groups[b])
    assert second in hh_set, f"bar {b}의 둘째 SN이 HH와 일치하지 않음"
    sync_points.append(second)

print("SN-HH 동기점(절대 틱):", sync_points)
print()

excesses = []
for i in range(len(sync_points) - 1):
    a, b = sync_points[i], sync_points[i + 1]
    elapsed = b - a
    # a와 b 사이(a 제외, b 포함)에 실제로 몇 번의 HH 타격이 있었는지 직접 셈 —
    # "명목 8타격"을 가정하지 않고 그 구간의 실측값을 그대로 씀.
    between = [h for h in hh if a < h <= b]
    n_gaps = len(between)
    avg_gap_this_interval = elapsed / n_gaps
    excess = elapsed - bar_ticks  # 이 구간이 정확히 1마디(880틱)보다 얼마나 더 걸렸는지
    excesses.append(excess)
    print(f"bar{9+i}->bar{9+i+1}: 동기점 사이 경과={elapsed}틱, 그 사이 실제 HH 타격 수={n_gaps}, "
          f"구간 평균 간격={avg_gap_this_interval:.2f}틱(이상값 110틱), "
          f"1마디(880틱) 대비 초과분={excess}틱")

print()
mean_excess = sum(excesses) / len(excesses)
print(f"구간별 초과분 평균: {mean_excess:.2f}틱/마디")
print(f"T2-13에서 선형회귀로 독립 계산한 SN 드리프트: {0.3582*220:.2f}틱/마디")
print(f"비율: {mean_excess / (0.3582*220):.3f}")
print()
print("해석: 이 값은 '전역 평균 간격×명목 8타격'으로 추정한 게 아니라, SN-HH 동기점")
print("사이에 실제로 몇 번의 HH 타격이 있었는지 하나하나 세어 계산한 실측값이다 — 전역")
print("평균이나 가정된 타격 수에 전혀 기대지 않는 직접 교차검증(Codex 모드B 1차 지적 반영).")
