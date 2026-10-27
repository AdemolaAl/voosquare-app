"""Render included-voice clips: python3 render.py MANIFEST OUTDIR [school ...] [--workers N]"""
import sys,os,json,re,time,subprocess,multiprocessing as mp,numpy as np
VOICES={'kokoro-am_michael-v1':'am_michael','kokoro-af_heart-v1':'af_heart'}; SPEED=0.95; SR=24000
def init(threads):
    global sess,V,voice,tokname,g2p,CUR
    import onnxruntime as ort
    from g2p2 import g2p as G
    g2p=G
    cfg=json.load(open(os.path.join(os.environ.get('KOKORO_DIR','.'),'config.json'))); V=cfg['vocab']
    so=ort.SessionOptions(); so.intra_op_num_threads=threads; so.inter_op_num_threads=1
    sess=ort.InferenceSession(os.path.join(os.environ.get('KOKORO_DIR','.'),'kokoro-v1.0.onnx'),so,providers=['CPUExecutionProvider'])
    voices=np.load(os.path.join(os.environ.get('KOKORO_DIR','.'),'voices-v1.0.bin'))
    voice={k:voices[v] for k,v in VOICES.items()}
    tokname=[i.name for i in sess.get_inputs() if i.name not in('style','speed')][0]
def infer(ph,vid):
    toks=[V[c] for c in ph if c in V][:500]
    if not toks: return np.zeros(0,np.float32)
    a=sess.run(None,{tokname:np.array([[0,*toks,0]],dtype=np.int64),'style':voice[vid][len(toks)-1].astype(np.float32),'speed':np.array([SPEED],dtype=np.float32)})[0].flatten()
    nz=np.where(np.abs(a)>0.008)[0]
    return a[max(0,nz[0]-120):nz[-1]+600] if len(nz) else np.zeros(0,np.float32)
def chunks(text):
    sents=re.findall(r'[^.!?]+(?:[.!?]+["\')]*|$)',text.strip())
    out=[]
    for s in (x.strip() for x in sents):
        if not s: continue
        ph=g2p(s)
        if len(ph)<=480: out.append((ph,s[-1:])); continue
        parts=re.split(r'(?<=[,;:])\s+',s); cur=''
        for p in parts:
            if cur and len(g2p(cur+' '+p))>480: out.append((g2p(cur),',')); cur=p
            else: cur=(cur+' '+p).strip()
        if cur: out.append((g2p(cur),s[-1:]))
    return out
def render(item):
    h,text,outdir,vid=item
    dest=os.path.join(outdir,h+'.mp3')
    if os.path.exists(dest): return h,0,0
    t=time.time(); parts=[np.zeros(int(SR*0.12),np.float32)]
    for ph,end in chunks(text):
        a=infer(ph,vid)
        if not len(a): continue
        parts.append(a); parts.append(np.zeros(int(SR*(0.42 if end in '.!?' else 0.22)),np.float32))
    a=np.concatenate(parts)
    if len(a)<SR*0.3: raise RuntimeError('empty audio for '+h)
    rms=np.sqrt(np.mean(a[np.abs(a)>0.01]**2)) if np.any(np.abs(a)>0.01) else 0.1
    a=a*(0.1/rms); pk=np.max(np.abs(a));
    if pk>0.89: a=a*(0.89/pk)
    pcm=(np.clip(a,-1,1)*32767).astype('<i2').tobytes()
    tmp=dest+'.tmp'
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','s16le','-ar',str(SR),'-ac','1','-i','-','-c:a','libmp3lame','-b:a','48k','-ar',str(SR),'-ac','1','-write_xing','1','-id3v2_version','0','-f','mp3',tmp],input=pcm,check=True)
    os.replace(tmp,dest)
    return h,len(a)/SR,time.time()-t
if __name__=='__main__':
    args=sys.argv[1:]; workers=2
    if '--workers' in args: i=args.index('--workers'); workers=int(args[i+1]); del args[i:i+2]
    man,outdir,*schools=args
    os.makedirs(outdir,exist_ok=True); os.makedirs(os.path.join(outdir,'samples'),exist_ok=True)
    L=[json.loads(x) for x in open(man)]
    items=[]; seen=set()
    for x in L:
        if schools and x['school'] not in schools and not (x.get('sample') and '_sample' in schools): continue
        if x['hash'] in seen: continue
        seen.add(x['hash'])
        items.append((x['hash'],x['text'],os.path.join(outdir,'samples') if x.get('sample') else outdir,x.get('voice','kokoro-am_michael-v1')))
    todo=[i for i in items if not os.path.exists(os.path.join(i[2],i[0]+'.mp3'))]
    print(f'{len(items)} clips, {len(todo)} to render, workers {workers}',flush=True)
    t0=time.time(); done=0; audio=0
    with mp.Pool(workers,initializer=init,initargs=(max(1,2//workers),)) as pool:
        for h,secs,dt in pool.imap_unordered(render,todo,chunksize=1):
            done+=1; audio+=secs
            if done%25==0 or done==len(todo):
                el=time.time()-t0; print(f'{done}/{len(todo)} audio {audio/3600:.2f}h elapsed {el/60:.1f}m eta {el/done*(len(todo)-done)/60:.0f}m',flush=True)
