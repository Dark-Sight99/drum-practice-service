# song2.json은 악보 데이터라 레포에 커밋하지 않는다(CLAUDE.md §5 data/ 커밋 금지 원칙과
# 같은 취지) — 재현하려면 로그인 후 GET /songs/2/drumscore 로 받은 응답을 이 경로에 저장.
import json
import numpy as np

with open(r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\t211830\song2.json", encoding="utf-8") as f:
    score = json.load(f)

notes = score["notes"]
ppq = score["ppq"]
bpm = score["meta"]["bpm"]
ts = score["meta"]["timeSignature"]
print("ppq", ppq, "bpm", bpm, "timeSignature", ts)

beats_per_bar = ts[0] if isinstance(ts, list) else 4
bar_ticks = ppq * beats_per_bar
print("bar_ticks", bar_ticks)

sn = sorted(n["tick"] for n in notes if n["piece"] == "snare")
print("total snare notes:", len(sn))

groups = {}
for t in sn:
    bar = t // bar_ticks
    groups.setdefault(bar, []).append(t)

print("\n--- per-bar snare offsets (beats from bar start) ---")
for bar, ticks in sorted(groups.items()):
    offsets = [round((t - bar * bar_ticks) / ppq, 3) for t in ticks]
    print(f"bar={bar:3d} offsets_beats={offsets}")

print("\n--- linear drift fit within contiguous 2-hit-per-bar runs (2nd hit each bar) ---")
xs, ys = [], []
for bar, ticks in sorted(groups.items()):
    if len(ticks) != 2:
        continue
    second = max(ticks)
    offset_beats = (second - bar * bar_ticks) / ppq
    xs.append(bar)
    ys.append(offset_beats)
xs = np.array(xs, dtype=float)
ys = np.array(ys, dtype=float)
slope, intercept = np.polyfit(xs, ys, 1)
print("bars used:", list(xs.astype(int)))
print("offsets (beats):", [round(y, 3) for y in ys])
print("slope (beats drift per bar, naive global fit across all runs):", round(slope, 4))
print("  -> ~", round(slope * (60 / bpm) * 1000, 1), "ms drift per bar (if monotonic)")

print("\n--- within single contiguous run (bars 9-13, no section break) ---")
run_bars = [9, 10, 11, 12, 13]
run_ys = []
for b in run_bars:
    ticks = groups[b]
    second = max(ticks)
    run_ys.append((second - b * bar_ticks) / ppq)
run_slope, _ = np.polyfit(run_bars, run_ys, 1)
print("bars", run_bars, "offsets_beats", [round(y, 3) for y in run_ys])
print("slope within this run:", round(run_slope, 4), "beats/bar =",
      round(run_slope * (60 / bpm) * 1000, 1), "ms/bar")
