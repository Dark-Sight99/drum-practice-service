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
TOL = ppq / 16
max_gap = ppq / 4
start_hand = "R"

order = sorted(range(len(notes)), key=lambda i: notes[i]["tick"])

coincidence_ticks_sorted = sorted(n["tick"] for n in notes if n["piece"] in COINCIDENCE_TRIGGER)
def has_coincidence_within_tol(tick):
    return any(abs(t - tick) <= TOL for t in coincidence_ticks_sorted)

fixed_hand_notes = sorted(
    ({"tick": n["tick"], "piece": n["piece"]} for n in notes if n["piece"] in FIXED_PRIORITY),
    key=lambda n: n["tick"],
)
def higher_priority_within_tol(piece, tick):
    rank = FIXED_PRIORITY.index(piece)
    for e in fixed_hand_notes:
        if e["tick"] < tick - TOL: continue
        if e["tick"] > tick + TOL: break
        if e["piece"] != piece and FIXED_PRIORITY.index(e["piece"]) < rank:
            return True
    return False

result = [None]*len(notes)
fill_position = 0
prev_fill_tick = None
def other(h): return "L" if h == "R" else "R"

for i in order:
    n = notes[i]
    piece = n["piece"]
    if piece in PIECE_RULES:
        rule = PIECE_RULES[piece]
        hand = "L" if rule == "R" and higher_priority_within_tol(piece, n["tick"]) else rule
        result[i] = hand
        continue
    if piece == "snare" and has_coincidence_within_tol(n["tick"]):
        result[i] = "L"
        continue
    if piece in FILL_PIECES:
        fill_position = fill_position+1 if prev_fill_tick is not None and n["tick"]-prev_fill_tick <= max_gap else 0
        prev_fill_tick = n["tick"]
        result[i] = start_hand if fill_position % 2 == 0 else other(start_hand)
        continue
    result[i] = None

print("TOL ticks:", TOL, "=", TOL/ppq*(60/bpm)*1000, "ms")
print("\ntick=4540..4560:")
for i in order:
    n = notes[i]
    if 4540 <= n["tick"] <= 4560:
        print(" ", n["tick"], n["piece"], result[i])
print("\ntick=17260..17280:")
for i in order:
    n = notes[i]
    if 17260 <= n["tick"] <= 17280:
        print(" ", n["tick"], n["piece"], result[i])

from collections import defaultdict
by_tick_hand = defaultdict(list)
for i in order:
    n = notes[i]
    if result[i] in ("R", "L"):
        by_tick_hand[(n["tick"], result[i])].append(n["piece"])
collisions = {k: v for k, v in by_tick_hand.items() if len(v) > 1}
print("\nexact-tick same-hand collisions:", len(collisions))
for k, v in collisions.items():
    print(" tick", k[0], "hand", k[1], "pieces", v)
