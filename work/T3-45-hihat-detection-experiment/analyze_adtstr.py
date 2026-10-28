import json
from pathlib import Path

import pretty_midi

MIDI_PATH = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\adtstr_output\drums.mid")

GM_REDUCED_NAMES = {
    35: "Acoustic Bass Drum", 36: "Bass Drum 1", 37: "Side Stick", 38: "Acoustic Snare",
    39: "Hand Clap", 40: "Electric Snare", 41: "Floor Tom", 42: "Closed Hi Hat",
    43: "Pedal Hi-Hat", 44: "Open Hi-Hat", 45: "Mid Tom", 46: "Crash Cymbal",
    47: "High Tom", 48: "Ride Cymbal", 49: "Chinese Cymbal", 50: "Tambourine",
    51: "Splash Cymbal", 52: "Cowbell",
}

midi = pretty_midi.PrettyMIDI(str(MIDI_PATH))
counts = {}
for inst in midi.instruments:
    for note in inst.notes:
        counts[note.pitch] = counts.get(note.pitch, 0) + 1

report = {}
for pitch, count in sorted(counts.items()):
    name = GM_REDUCED_NAMES.get(pitch, f"pitch{pitch}")
    report[f"{pitch}_{name}"] = count

print(json.dumps(report, ensure_ascii=False, indent=2))
print("TOTAL:", sum(counts.values()))
print("Closed Hi Hat(42) count:", counts.get(42, 0))

out_path = Path(r"C:\Users\Jaewoo\드럼연습서비스\work\T3-45-hihat-detection-experiment\variant_adtstr_result.json")
out_path.write_text(json.dumps({"by_pitch": report, "total": sum(counts.values())}, ensure_ascii=False, indent=2), encoding="utf-8")
