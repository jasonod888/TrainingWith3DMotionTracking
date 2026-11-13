import json
from pathlib import Path
n = json.loads(Path('.local/phase1-audit/notation-real.json').read_text(encoding='utf-8'))
perf = {p['id']: p for p in n['performance']}
worst = []
diff = 0
for e in n['events']:
    if len(e['notes']) < 2: continue
    onsets = [perf[i]['onset'] for note in e['notes'] for i in note['performance_ids'] if i in perf]
    if len(set(onsets)) > 1:
        diff += 1
        worst.append((max(onsets)-min(onsets), e['id'], [round(o,4) for o in sorted(set(onsets))]))
worst.sort(reverse=True)
print('chord events:', sum(1 for e in n['events'] if len(e['notes'])>1))
print('chord events whose members have different recorded onsets:', diff)
print('largest spread (s):', round(worst[0][0],4), worst[0][1], worst[0][2][:6])
print('median spread:', round(sorted(w[0] for w in worst)[len(worst)//2],4))
durs = []
for e in n['events']:
    if len(e['notes'])<2: continue
    d = [perf[i]['duration'] for note in e['notes'] for i in note['performance_ids'] if i in perf]
    if len(set(d))>1: durs.append(max(d)-min(d))
print('chord events whose members have different recorded durations:', len(durs))
