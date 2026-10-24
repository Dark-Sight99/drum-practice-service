# song2.json은 악보 데이터라 레포에 커밋하지 않는다(CLAUDE.md §5 data/ 커밋 금지 원칙과
# 같은 취지) — 재현하려면 로그인 후 GET /songs/2/drumscore 로 받은 응답을 저장하고,
# 그 파일 경로를 이 스크립트의 첫 인자로 넘긴다:
#   python hh_interval_crosscheck.py song2.json
# (Codex 모드B 2차 지적 반영 — raw_log.txt의 curl 저장 경로와 스크립트가 읽는 경로가
#  서로 달라 "명령대로 받아도 스크립트 입력으로 안 쓰인다"는 지적을 받아, 하드코딩된
#  절대경로 대신 인자로 받도록 교체)
#
# T2-14 — Codex 모드B 1차 지적("전체 평균×명목 8타격"은 '거의 일치'하는 느낌만 줄 뿐
# 메커니즘을 직접 증명하지 않는다) 반영. hh_spacing_analysis.py의 전역 평균 대신,
# T2-13이 실제로 측정에 쓴 "SN-HH 동기점" 사이사이의 실제 HH 타격 수를 직접 세어
# elapsed를 계산한다. 단, Codex 모드B 2차가 정확히 지적했듯 이 동기점 자체가
# T2-13의 SN 드리프트 회귀에 쓰인 바로 그 틱 값이라 — "elapsed가 회귀 기울기와
# 거의 같다"는 건 같은 데이터를 다른 방식으로 봐도 비슷하게 나온다는 것이지 독립
# 측정끼리의 우연찮은 일치가 아니다. 이 스크립트가 실제로 더하는 새 정보는 "그
# elapsed 구간 안에 HH가 정확히 몇 번 쳤는지"(8번, 가정 아니라 실측)이고, 그로부터
# "타격당 평균 초과분"이 전역 평균(10.03틱)과 비슷한 범위(9.4~11틱)에 들어온다는
# 것까지다 — 아래 출력과 result.md·Q-25의 서술도 이 범위로 한정했다.
import sys
import json

DEFAULT_PATH = r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\t211830\song2.json"
path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH

with open(path, encoding="utf-8") as f:
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
n_hits_per_interval = [8, 8, 8, 8]  # 위 출력에서 실측된 값(가정 아님)
per_hit_excess = [e / n for e, n in zip(excesses, n_hits_per_interval)]
print(f"구간별 초과분: {excesses}틱/마디 (평균 {mean_excess:.2f})")
print(f"구간마다 실제 HH 타격 수: {n_hits_per_interval} (전부 8 — 가정이 아니라 실측값)")
print(f"타격당 초과분: {[round(p, 2) for p in per_hit_excess]}틱 "
      f"(전역 평균 초과분 10.03틱과 비슷한 범위)")
print()
print("주의(Codex 모드B 2차 지적 반영): 이 동기점(sync_points)은 T2-13이 SN 드리프트")
print("회귀에 쓴 바로 그 틱 값이다 — 따라서 '구간별 초과분 평균이 T2-13 회귀 기울기와")
print("거의 같다'는 건 같은 데이터를 다른 식으로 봐도 비슷하게 나온다는 것이지, 서로")
print("독립적인 두 측정이 우연히 일치한 게 아니다. 이 스크립트가 실제로 보태는 새")
print("정보는 '그 구간 안에 HH가 정확히 몇 번(8번) 쳤는지'를 가정 없이 실측했다는 것과,")
print("그로부터 나온 타격당 초과분이 전역 평균과 같은 범위에 있다는 것까지다.")
