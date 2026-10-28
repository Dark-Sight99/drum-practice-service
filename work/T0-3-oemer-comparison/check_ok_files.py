import re
from pathlib import Path

base = Path(r"C:\Users\Jaewoo\AppData\Local\Temp\claude\C--Users-Jaewoo--------\254e3255-489f-4c7b-97a9-abdbac464328\scratchpad\oemer_out")

for name in ["IMG_7947", "IMG_7954", "IMG_7963"]:
    path = base / f"{name}.musicxml"
    content = path.read_text(encoding="utf-8")
    clefs = set(re.findall(r"<sign>(\w+)</sign>", content))
    names = set(re.findall(r"<instrument-name>([^<]+)</instrument-name>", content))
    n_notes = len(re.findall(r"<note[ >]", content))
    has_perc = "percussion" in content.lower()
    print(name, "clefs=", clefs, "instrument=", names, "n_notes=", n_notes, "has_percussion_word=", has_perc)
