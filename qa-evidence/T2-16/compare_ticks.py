# Q-25 추가 조사(T2-16): 스네어 백비트 "들쭉날쭉" 현상이 import 과정에서 생기는지,
# 원본 MIDI 파일에 이미 있던 값인지 직접 비교 — T2-13 check_tempo.mjs가 원본 .mid를
# @tonejs/midi로 직접 파싱해 뽑은 틱 값(qa-evidence/T2-13/check_tempo_output.txt)과,
# 앱이 실제로 저장/서빙하는 DrumScore(GET /songs/2/drumscore, 브라우저 세션으로 실측)의
# 스네어 틱 값을 1:1 비교한다.
import re

# T2-13의 check_tempo_output.txt에서 직접 추출한 원본 MIDI 스네어 틱(ticks= 뒤 숫자)
raw_text = open(r"C:\Users\Jaewoo\드럼연습서비스\qa-evidence\T2-13\check_tempo_output.txt", encoding="utf-8").read()
original_ticks = [int(m) for m in re.findall(r"ticks=(\d+)", raw_text)]

# 2026-10-25 브라우저 세션(fetch('/api/songs/2/drumscore'))으로 실측한 앱 저장값 —
# ppq=220, bpm=120, timeSignature=[4,4], snareCount=46
app_ticks = [4, 110, 233, 352, 480, 506, 607, 726, 1197, 1377, 1492, 1672, 2152, 2332,
             2446, 2627, 3102, 3287, 3392, 3586, 4070, 4250, 4365, 4550, 5029, 5513,
             5993, 6481, 6965, 7445, 7924, 8408, 8888, 9363, 9838, 10318, 10802, 11277,
             11761, 12245, 12720, 13200, 13684, 14168, 14648, 15123]

print(f"원본 MIDI 스네어 개수: {len(original_ticks)}")
print(f"앱 DrumScore 스네어 개수: {len(app_ticks)}")
print(f"개수 일치: {len(original_ticks) == len(app_ticks)}")

mismatches = [(i, o, a) for i, (o, a) in enumerate(zip(original_ticks, app_ticks)) if o != a]
print(f"틱 값이 다른 노트 수: {len(mismatches)} / {len(app_ticks)}")
if mismatches:
    for i, o, a in mismatches[:10]:
        print(f"  idx={i}: 원본={o} 앱={a} 차이={a-o}")
else:
    print("=> 전부 완전히 일치(byte-identical) — import가 틱 값을 전혀 바꾸지 않음을 확인.")
