import numpy as np, subprocess
SR=44100; T=9.5; n=int(SR*T); t=np.arange(n)/SR
rng=np.random.default_rng(7)
def f(m): return 440*2**((m-69)/12)
L=np.zeros(n); R=np.zeros(n)
def env(start,dur,a=0.02,rel=0.6):
    e=np.zeros(n); s=int(start*SR); d=int(dur*SR); r=int(rel*SR); a_=max(1,int(a*SR))
    seg=np.ones(d); seg[:a_]=np.linspace(0,1,a_)
    e[s:s+d]=seg[:max(0,min(d,n-s))]
    if s+d<n:
        tail=np.exp(-np.arange(min(r*4,n-s-d))/r); e[s+d:s+d+len(tail)]=tail
    return e
# chords (MIDI)
chords=[(0.0,[48,55,59,64,67]),(2.5,[53,57,60,64,69]),(5.0,[48,55,62,64,71])]  # Cmaj7, Fmaj7, Cmaj9
for i,(st,notes) in enumerate(chords):
    dur=2.6 if i<2 else 3.6
    for k,m in enumerate(notes):
        for det,pan in ((-0.07,0.3),(0.07,0.7)):
            fr=f(m+det*0.1)*(1+det*0.003)
            w=np.sin(2*np.pi*fr*t)+0.25*np.sin(2*np.pi*2*fr*t)+0.08*np.sin(2*np.pi*3*fr*t)
            e=env(st,dur,a=0.7,rel=1.2)*(0.055 if m>=60 else 0.07)
            L+=w*e*(1-pan); R+=w*e*pan
# bell arpeggio, eighth notes at 96 bpm
step=60/96/2; arp=[72,76,79,83, 77,81,84,81, 79,76,74,79, 76]
for j,m in enumerate(arp):
    st=0.6+j*step
    if st>T-1.5: break
    fr=f(m); s=int(st*SR); d=int(1.6*SR); tt=np.arange(min(d,n-s))/SR
    tone=(np.sin(2*np.pi*fr*tt)+0.35*np.sin(2*np.pi*2.01*fr*tt)*np.exp(-tt*6)+0.12*np.sin(2*np.pi*3.98*fr*tt)*np.exp(-tt*9))*np.exp(-tt*3.2)*np.minimum(1,tt/0.004)
    pan=0.35+0.3*((j%3)/2)
    L[s:s+len(tone)]+=tone*0.11*(1-pan); R[s:s+len(tone)]+=tone*0.11*pan
# soft sub on chord roots
for st,notes in chords:
    fr=f(notes[0]-12); e=env(st,2.4,a=0.4,rel=0.8)*0.10
    L+=np.sin(2*np.pi*fr*t)*e; R+=np.sin(2*np.pi*fr*t)*e
# shimmer swell at start
noise=rng.standard_normal(n)
from numpy.fft import rfft,irfft
def bandpass(x,lo,hi):
    X=rfft(x); fr=np.fft.rfftfreq(len(x),1/SR); X[(fr<lo)|(fr>hi)]=0; return irfft(X,len(x))
sh=bandpass(noise,4000,9000)*np.clip(t/1.2,0,1)*np.exp(-np.maximum(0,t-1.2)*2.5)*0.012
L+=sh; R+=np.roll(sh,200)
# gentle low-pass on everything (one-pole)
def lp(x,fc):
    a=np.exp(-2*np.pi*fc/SR); y=np.zeros_like(x); acc=0.0
    import scipy.signal as ss
    return ss.lfilter([1-a],[1,-a],x)
L=lp(L,7000); R=lp(R,7000)
# reverb: convolve with decaying noise IR
import scipy.signal as ss
ir_len=int(2.0*SR); irt=np.arange(ir_len)/SR
irL=rng.standard_normal(ir_len)*np.exp(-irt*3.0); irR=rng.standard_normal(ir_len)*np.exp(-irt*3.0)
irL=lp(irL,5000); irR=lp(irR,5000)
wl=ss.fftconvolve(L,irL)[:n]; wr=ss.fftconvolve(R,irR)[:n]
wl/=np.max(np.abs(wl)); wr/=np.max(np.abs(wr))
L=L/np.max(np.abs(L))*0.75+wl*0.28; R=R/np.max(np.abs(R))*0.75+wr*0.28
# fade in/out
fade=np.ones(n); fade[:int(0.05*SR)]=np.linspace(0,1,int(0.05*SR)); fo=int(2.0*SR); fade[-fo:]=np.linspace(1,0,fo)**2
L*=fade; R*=fade
pk=max(np.max(np.abs(L)),np.max(np.abs(R))); L*=0.8/pk; R*=0.8/pk
st=np.stack([L,R],1); pcm=(st*32767).astype('<i2').tobytes()
subprocess.run(['ffmpeg','-loglevel','error','-y','-f','s16le','-ar',str(SR),'-ac','2','-i','-','-c:a','libmp3lame','-b:a','128k','voo-school-intro.mp3'],input=pcm,check=True)
subprocess.run(['ffmpeg','-loglevel','error','-y','-i','voo-school-intro.mp3','-lavfi','showspectrumpic=s=800x300:legend=0','spec.png'],check=True)
print('ok')
