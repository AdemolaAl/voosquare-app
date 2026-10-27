"""Bundle rendered clips into upload-ready voice packs (plain .tar files, at most MAX_MB each), one series per school.
Usage: python3 pack.py MANIFEST CLIPDIR OUTDIR [--max-mb 25]
Each pack holds <hash>.mp3 files (and samples/<hash>.mp3 for the voice-picker sample, in the first pack).
Upload them in Admin -> VooSquare Academy -> Teaching voice -> Included voice pack (several at once is fine)."""
import sys, os, json, tarfile, io
args = sys.argv[1:]; max_mb = 25
if '--max-mb' in args: i = args.index('--max-mb'); max_mb = float(args[i + 1]); del args[i:i + 2]
man, clips, out = args
os.makedirs(out, exist_ok=True)
L = [json.loads(x) for x in open(man)]
by = {}; seen = set(); sample = None
for x in L:
    if x['hash'] in seen: continue
    seen.add(x['hash'])
    if x.get('sample'): sample = x; continue
    by.setdefault(x['school'], []).append(x)
made = []; missing = 0
def write(name, items, extra=None):
    p = os.path.join(out, name)
    with tarfile.open(p, 'w', format=tarfile.USTAR_FORMAT) as t:
        for arc, f in items: t.add(f, arcname=arc)
    made.append((name, len(items), os.path.getsize(p)))
for school, xs in by.items():
    part = 1; cur = []; size = 0
    if sample and not made and not cur:
        f = os.path.join(clips, 'samples', sample['hash'] + '.mp3')
        if os.path.exists(f): cur.append(('samples/' + sample['hash'] + '.mp3', f)); size += os.path.getsize(f)
    for x in xs:
        f = os.path.join(clips, x['hash'] + '.mp3')
        if not os.path.exists(f): missing += 1; continue
        s = os.path.getsize(f)
        if cur and size + s > max_mb * 1e6:
            write(f'voosquare-academy-voice-{school}-{part}.tar', cur); part += 1; cur = []; size = 0
        cur.append((x['hash'] + '.mp3', f)); size += s
    if cur: write(f'voosquare-academy-voice-{school}-{part}.tar', cur)
for n, c, s in made: print(f'{n}\t{c} clips\t{s / 1e6:.1f} MB')
print('missing (not rendered yet):', missing)
