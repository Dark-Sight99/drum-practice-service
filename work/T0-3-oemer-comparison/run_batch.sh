#!/bin/bash
# 한 줄 요약: oemer로 T0-3의 21장 전부를 순서대로 돌려 성공/실패와 에러 종류를 기록(1회성 비교 실험).
set -u
SRC="/c/Users/Jaewoo/AppData/Local/Temp/claude/C--Users-Jaewoo--------/254e3255-489f-4c7b-97a9-abdbac464328/scratchpad/sheets_rotated"
OUT="/c/Users/Jaewoo/AppData/Local/Temp/claude/C--Users-Jaewoo--------/254e3255-489f-4c7b-97a9-abdbac464328/scratchpad/oemer_out"
LOGDIR="C:/Users/Jaewoo/드럼연습서비스/work/T0-3-oemer-comparison/logs"
mkdir -p "$LOGDIR"
OEMER="C:/Users/Jaewoo/드럼연습서비스/app/server/.venv/Scripts/oemer.exe"
SUMMARY="C:/Users/Jaewoo/드럼연습서비스/work/T0-3-oemer-comparison/batch_summary.tsv"
echo -e "file\tresult\terror_tail" > "$SUMMARY"

for img in "$SRC"/*.jpg; do
  name=$(basename "$img" .jpg)
  logfile="$LOGDIR/${name}.log"
  "$OEMER" "$img" -o "$OUT" > "$logfile" 2>&1
  if [ $? -eq 0 ]; then
    echo -e "${name}\tOK\t" >> "$SUMMARY"
  else
    tail_line=$(grep -a -E "Error|Exception" "$logfile" | tail -1 | tr -d '\r')
    echo -e "${name}\tFAIL\t${tail_line}" >> "$SUMMARY"
  fi
done
echo "DONE"
