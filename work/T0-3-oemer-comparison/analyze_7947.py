import re

path = r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\oemer_out\IMG_7947.musicxml"
with open(path, encoding="utf-8") as f:
    content = f.read()

clefs = re.findall(r"<sign>(\w+)</sign>", content)
print("clefs:", clefs[:10], "... total", len(clefs))

n_notes = len(re.findall(r"<note[ >]", content))
n_rests = len(re.findall(r"<rest", content))
print("notes:", n_notes, "rests:", n_rests)

instruments = re.findall(r'<instrument id="([^"]+)"', content)
print("instrument refs (first 30):", instruments[:30])
print("unique instrument refs:", sorted(set(instruments)))

score_instruments = re.findall(r"<instrument-name>([^<]+)</instrument-name>", content)
print("score-instrument names:", score_instruments[:20])

pitches = re.findall(r"<step>(\w)</step>\s*<octave>(\d)</octave>", content)
print("pitch/octave pairs (first 20):", pitches[:20])
