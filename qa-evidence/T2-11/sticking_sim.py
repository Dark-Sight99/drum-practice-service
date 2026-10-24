# song2.json은 악보 데이터라 레포에 커밋하지 않는다(CLAUDE.md §5 data/ 커밋 금지 원칙과
# 같은 취지) — 재현하려면 로그인 후 GET /songs/2/drumscore 로 받은 응답을 이 경로에 저장.
import json

with open(r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\t211830\song2.json", encoding="utf-8") as f:
    score = json.load(f)

notes = score["notes"]
ppq = score["ppq"]
bpm = score["meta"]["bpm"]

PIECE_RULES = {"kick": "RF", "hihat_closed": "R", "hihat_open": "R", "ride": "R", "crash": "R"}
COINCIDENCE_TRIGGER = {"hihat_closed", "hihat_open", "ride"}
FILL_PIECES = {"snare", "tom_high", "tom_mid", "tom_floor"}
FIXED_PRIORITY = ["hihat_closed", "hihat_open", "ride", "crash"]
max_gap = ppq / 4
start_hand = "R"

order = sorted(range(len(notes)), key=lambda i: notes[i]["tick"])
coincidence_ticks = set(n["tick"] for n in notes if n["piece"] in COINCIDENCE_TRIGGER)

fixed_hand_ticks = {}
for n in notes:
    if n["piece"] in FIXED_PRIORITY:
        fixed_hand_ticks.setdefault(n["tick"], set()).add(n["piece"])

def higher_priority_present(piece, tick):
    s = fixed_hand_ticks.get(tick)
    if not s:
        return False
    rank = FIXED_PRIORITY.index(piece)
    return any(FIXED_PRIORITY.index(o) < rank for o in s if o != piece)

result = [None]*len(notes)
fill_position = 0
prev_fill_tick = None

def other(h): return "L" if h == "R" else "R"

for i in order:
    n = notes[i]
    piece = n["piece"]
    if piece in PIECE_RULES:
        rule = PIECE_RULES[piece]
        hand = "L" if rule == "R" and higher_priority_present(piece, n["tick"]) else rule
        result[i] = hand
        continue
    if piece == "snare" and n["tick"] in coincidence_ticks:
        result[i] = "L"
        if piece in FILL_PIECES:
            fill_position = fill_position+1 if prev_fill_tick is not None and n["tick"]-prev_fill_tick <= max_gap else 0
            prev_fill_tick = n["tick"]
        continue
    if piece in FILL_PIECES:
        fill_position = fill_position+1 if prev_fill_tick is not None and n["tick"]-prev_fill_tick <= max_gap else 0
        prev_fill_tick = n["tick"]
        result[i] = start_hand if fill_position % 2 == 0 else other(start_hand)
        continue
    result[i] = None

def tick_to_sec(t): return (t/ppq)*(60/bpm)

print("tick=4550 area:")
for i in order:
    n = notes[i]
    if 4500 <= n["tick"] <= 4600:
        print(" ", n["tick"], n["piece"], result[i])

print("\ntick=17200..17350 area:")
for i in order:
    n = notes[i]
    if 17200 <= n["tick"] <= 17350:
        print(" ", n["tick"], n["piece"], result[i])

# recompute min same-hand cross-piece gap check
events = []
for i in order:
    n = notes[i]
    if result[i] in ("R", "L"):
        events.append((tick_to_sec(n["tick"]), result[i], n["piece"], n["tick"]))
for hand in ("R","L"):
    evs = sorted([e for e in events if e[1]==hand], key=lambda e: e[0])
    gaps = sorted(((b[0]-a[0], a, b) for a,b in zip(evs, evs[1:])), key=lambda g: g[0])
    print(f"\nhand={hand} smallest cross-piece gaps (different piece only):")
    shown=0
    for gap,a,b in gaps:
        if a[2] != b[2]:
            print(f"  {gap*1000:.1f}ms {a[2]}@{a[3]} -> {b[2]}@{b[3]}")
            shown+=1
            if shown>=5: break

print("\n--- same-tick same-hand collisions across ALL pieces (any remaining) ---")
from collections import defaultdict
by_tick_hand = defaultdict(list)
for i in order:
    n = notes[i]
    if result[i] in ("R", "L"):
        by_tick_hand[(n["tick"], result[i])].append(n["piece"])
collisions = {k: v for k, v in by_tick_hand.items() if len(v) > 1}
print("total colliding (tick,hand) groups:", len(collisions))
for k, v in collisions.items():
    print(" tick", k[0], "hand", k[1], "pieces", v)

print("\n--- all ticks where 2+ FIXED_PRIORITY pieces coincide ---")
for tick, pieces in sorted(fixed_hand_ticks.items()):
    if len(pieces) > 1:
        # also check if snare at same tick
        snare_here = any(n["piece"]=="snare" and n["tick"]==tick for n in notes)
        print(" tick", tick, "pieces", pieces, "snare_also_here=", snare_here)
