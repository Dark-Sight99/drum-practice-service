import zipfile, glob, re, os

files = sorted(glob.glob('qa-evidence/T0-3/out/*.mxl'))
fully_perc = 0
partial_perc = 0
none_perc = 0
rows = []
for f in files:
    with zipfile.ZipFile(f) as z:
        name = [n for n in z.namelist() if n.endswith('.xml') and 'container' not in n][0]
        content = z.read(name).decode('utf-8', errors='replace')
    clefs = re.findall(r'<sign>(\w+)</sign>', content)
    n_notes = len(re.findall(r'<note[ >]', content))
    n_rests = len(re.findall(r'<rest', content))
    n_perc_clef = clefs.count('percussion')
    n_total_clef = len(clefs)
    rows.append((os.path.basename(f), n_total_clef, n_perc_clef, n_notes, n_rests))
    if n_total_clef == 0:
        continue
    if n_perc_clef == n_total_clef:
        fully_perc += 1
    elif n_perc_clef == 0:
        none_perc += 1
    else:
        partial_perc += 1

print(f"완전 percussion clef: {fully_perc}, 일부만: {partial_perc}, 전혀 아님: {none_perc}, 총 파일: {len(files)}")
print()
for r in rows:
    print(r)
