import sys,types,re,json
import os; sys.path.insert(0,os.environ.get('MISAKI_DIR','misaki'))
# ---- stubs for heavy deps misaki.en imports but we don't use
for name in ['spacy','torch','transformers']:
    m=types.ModuleType(name); sys.modules[name]=m
sys.modules['transformers'].BartForConditionalGeneration=object
ad=types.ModuleType('addict'); ad.Dict=dict; sys.modules['addict']=ad
rg=types.ModuleType('regex'); rg.compile=lambda *a,**k:None; rg.findall=lambda *a,**k:[]; sys.modules['regex']=rg
ONES=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
TENS=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
def card(n):
    n=int(n)
    if n<0: return 'minus '+card(-n)
    if n<20: return ONES[n]
    if n<100: return TENS[n//10]+(' '+ONES[n%10] if n%10 else '')
    if n<1000: return ONES[n//100]+' hundred'+(' and '+card(n%100) if n%100 else '')
    for v,w in ((10**12,'trillion'),(10**9,'billion'),(10**6,'million'),(1000,'thousand')):
        if n>=v: return card(n//v)+' '+w+((' and ' if n%v<100 else ' ')+card(n%v) if n%v else '')
ORD={'one':'first','two':'second','three':'third','five':'fifth','eight':'eighth','nine':'ninth','twelve':'twelfth'}
def ordinal(n):
    w=card(n); parts=re.split(r'([ -])',w); last=parts[-1]
    if last in ORD: last=ORD[last]
    elif last.endswith('y'): last=last[:-1]+'ieth'
    else: last+='th'
    parts[-1]=last; return ''.join(parts)
def year(n):
    n=int(n)
    if 2000<=n<2010: return card(n)
    if n%100==0: return card(n//100)+' hundred'
    return card(n//100)+' '+(card(n%100) if n%100>=10 else 'oh '+card(n%100))
n2w=types.ModuleType('num2words')
def num2words(n,to='cardinal'):
    if to=='ordinal': return ordinal(n)
    if to=='year': return year(n)
    if isinstance(n,float):
        a,b=str(n).split('.'); return card(int(a))+' point '+' '.join(ONES[int(c)] for c in b)
    return card(n)
n2w.num2words=num2words; sys.modules['num2words']=n2w
import misaki.en as en
from flt import arpa
LEX=en.Lexicon(False)
A2I={'aa':'ɑ','ae':'æ','ao':'ɔ','aw':'W','ay':'I','eh':'ɛ','ey':'A','ih':'ɪ','iy':'i','ow':'O','oy':'Y','uh':'ʊ','uw':'u',
 'b':'b','d':'d','f':'f','g':'ɡ','hh':'h','jh':'ʤ','k':'k','l':'l','m':'m','n':'n','ng':'ŋ','p':'p','r':'ɹ','s':'s','sh':'ʃ','t':'t','th':'θ','dh':'ð','v':'v','w':'w','y':'j','z':'z','zh':'ʒ','ch':'ʧ'}
def lts(word):
    out=''
    for p in arpa(word):
        m=re.match(r'([a-z]+)(\d?)$',p); b,st=m.group(1),m.group(2)
        if b in ('ah','ax'): ip='ʌ' if st=='1' or st=='2' else 'ə'
        elif b=='er': ip='ɜɹ' if st in('1','2') else 'əɹ'
        else: ip=A2I.get(b,'')
        out+=({'1':'ˈ','2':'ˌ'}.get(st,''))+ip
    return out
OVR={'learnvoo':'lˈɜɹnvˌu','joinvoo':'ʤˈYnvˌu','voosquare':'vˈuskwˌɛɹ','botfather':'bˈɑtfˌɑðəɹ','manychat':'mˈɛniʧˌæt','sendpulse':'sˈɛndpˌʌls','tiktok':'tˈɪktˌɑk',
 'whatsapp':'wˈʌtsˌæp','snapchat':'snˈæpʧˌæt','meta':'mˈɛɾə','nutra':'nˈutɹə','igaming':'ˈIɡˌAmɪŋ','dchessking':'dˈi ʧˈɛs kˈɪŋ','id':'ˌIdˈi',
 'zedapex':'zˈɛdˌApɛks','geo':'ʤˈiO','geos':'ʤˈiOz','lander':'lˈændəɹ','landers':'lˈændəɹz','prelander':'pɹˈilˌændəɹ','prelanders':'pɹˈilˌændəɹz',
 'adset':'ˈædsˌɛt','popia':'pˈɑpiə','nafdac':'nˈæfdˌæk','cosumaf':'kˈOsumˌæf','arcon':'ˈɑɹkˌɑn','cemac':'sˈimˌæk','cobac':'kˈObˌæk','sahpra':'sˈɑpɹə','kebs':'kˈɛbz','cofepris':'kˌOfəpɹˈis','invima':'ɪnvˈimə','naicom':'nˈAkˌɑm','rosca':'ɹˈɑskə','esma':'ˈɛzmə','iosco':'ˌIˈɑskO','howto':'hˈWtˌu','roas':'ɹˈOˌæs','cap':'kˈæp','captcha':'kˈæpʧə','clid':'klˈɪd','mille':'mˈɪl','aff':'ˈæf','seg':'sˈɛɡ','reg':'ɹˈɛʤ','tel':'tˈɛl','multi':'mˈʌlti','non':'nˈɑn','de':'dˈi','voo':'vˈu','wahala':'wɑhˈɑlə','pesa':'pˈɛsə','karibu':'kɑɹˈibu','iphone':'ˈIfˌOn','github':'ɡˈɪthˌʌb','gmail':'ʤˈimˌAl','keitaro':'kAtˈɑɹO','voluum':'vˈɑljum','redtrack':'ɹˈɛdtɹˌæk','postback':'pˈOstbˌæk','postbacks':'pˈOstbˌæks','webhook':'wˈɛbhˌʊk','webhooks':'wˈɛbhˌʊks','cysec':'sˈIsˌɛk','curacao':'kjˌʊɹəsˈW','opay':'ˈOpˌA','affleego':'ˈæflˌiɡO','ltd':'lˈɪmɪtəd','finfluencer':'fˈɪnflˌuənsəɹ','finfluencers':'fˈɪnflˌuənsəɹz','subid':'sˈʌbˌIdˈi','lookalike':'lˈʊkəlˌIk','lookalikes':'lˈʊkəlˌIks','onboard':'ˈɑnbˌɔɹd','onboards':'ˈɑnbˌɔɹdz','pageview':'pˈAʤvjˌu','pageviews':'pˈAʤvjˌuz','breakeven':'bɹˌAkˈivən','callout':'kˈɔlˌWt','dedupe':'dˌidˈup','redeposit':'ɹˌidəpˈɑzət','redeposits':'ɹˌidəpˈɑzəts','retarget':'ɹˌitˈɑɹɡət','retargeting':'ɹˌitˈɑɹɡətɪŋ','walkthrough':'wˈɔkθɹˌu','voiceover':'vˈYsˌOvəɹ','voiceovers':'vˈYsˌOvəɹz','skincare':'skˈɪnkˌɛɹ','tagline':'tˈæɡlˌIn','lifecycle':'lˈIfsˌIkəl','inline':'ˈɪnlˌIn','shortlist':'ʃˈɔɹtlˌɪst','matchday':'mˈæʧdˌA','withdrawable':'wɪðdɹˈɔəbəl','thruplays':'θɹˈuplˌAz','overround':'ˈOvəɹˌWnd','adsets':'ˈædsˌɛts','revshare':'ɹˈɛvʃˌɛɹ','kyc':'kˌAwˌIsˈi','okay':'ˌOkˈA'}
WORDRE=re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
UNK=set()
def word_ps(w,nextvowel):
    lw=w.lower().replace('’',"'")
    if lw in OVR: return OVR[lw]
    tag='DT' if lw in('a','an','the') else ('TO' if lw=='to' else 'NN')
    stress=None if w==w.lower() else LEX.cap_stresses[int(w==w.upper())]
    ctx=en.TokenContext(future_vowel=nextvowel)
    try:
        ps,_=LEX.get_word(w.replace('’',"'"),tag,stress,ctx)
    except Exception: ps=None
    if ps is None and w!=lw:
        try: ps,_=LEX.get_word(lw,tag,None,ctx)
        except Exception: ps=None
    if ps is None and lw.endswith('ied') and len(lw)>4:
        try: st,_=LEX.get_word(lw[:-3]+'y',tag,None,ctx)
        except Exception: st=None
        if st and st[-1] in 'iI': ps=st+'d'
    if ps is None and lw.endswith("'s") and lw[:-2] in OVR: ps=OVR[lw[:-2]]+'z'
    if ps is None and w.isupper() and len(w)<=5:
        ps,_=LEX.get_NNP(w)
    if ps is None:
        UNK.add(lw); ps=lts(lw)
    return en.apply_stress(ps,stress) if ps else ''
CUR={'$':'dollar','€':'euro','£':'pound','₦':'naira'}
def numtext(m):
    cur,num,suf=m.group(1) or '',m.group(2),m.group(3) or ''
    raw=num.replace(',','')
    if suf.lower() in('st','nd','rd','th') and raw.isdigit(): return ordinal(raw)
    if '.' in raw:
        a,b=raw.split('.',1)
        if cur and len(b)==2:
            w=card(a)+' '+CUR[cur]+('s' if a!='1' else '')+(' and '+card(b)+' cents' if int(b) else ''); cur=''
        else: w=card(a or 0)+' point '+' '.join(ONES[int(c)] for c in b)
    else:
        if not cur and len(raw)==4 and 1900<=int(raw)<=2099 and ',' not in num: w=year(raw)
        else: w=card(raw)
    mult={'k':' thousand','m':' million','b':' billion','bn':' billion'}.get(suf.lower(),'')
    w+=mult
    if suf=='%': w+=' percent'
    if cur: w+=' '+CUR[cur]+('s' if raw!='1' or mult else '')
    return ' '+w+' '
import unicodedata
def normalize(t):
    t=''.join(c for c in unicodedata.normalize('NFKD',t) if not unicodedata.combining(c))
    t=re.sub(r'(?<=[A-Za-z])-(?=[A-Za-z])',' ',t)
    t=t.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('…','...')
    t=re.sub(r'(\d)\s*[–-]\s*(\d)',r'\1 to \2',t)
    t=re.sub(r'([$€£₦])?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(%|k\b|K\b|m\b|M\b|bn\b|st\b|nd\b|rd\b|th\b)?',numtext,t)
    t=t.replace('&',' and ').replace('+',' plus ').replace('/',' or ').replace('=',' equals ').replace('×',' times ').replace('@',' at ')
    return re.sub(r'\s+',' ',t).strip()
def g2p(text):
    t=normalize(text)
    toks=re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)*|[.,?!:;]|—|-",t)
    words=[x for x in toks]
    out=[]
    # first pass phonemes without context, to know next-vowel
    for i,x in enumerate(toks):
        if re.match(r'[.,?!:;]',x):
            if out: out[-1]+=x
            continue
        if x in('—','-'):
            if out and not out[-1][-1:] in '.,?!:;': out[-1]+=','
            continue
        nxt=None
        for y in toks[i+1:]:
            if re.match(r'[A-Za-z]',y):
                p=word_ps(y,None).lstrip('ˈˌ'); nxt=bool(p) and p[0] in 'aeiouæɑɔəɛɪʊʌAIOWYɜɐᵻ'; break
            else: break
        prevx=toks[i-1] if i else ''; nextx=toks[i+1] if i+1<len(toks) else ''
        letterbefore=len(prevx)==1 and prevx.isupper()
        if letterbefore and x=='s' and out: out[-1]+='z'; continue
        if letterbefore and len(x)==2 and x[0].isupper() and x[1]=='s':
            lp=LEX.golds.get(x[0]); out.append((lp if isinstance(lp,str) else word_ps(x[0],None))+'z'); continue
        if len(x)==1 and x.isupper() and ((len(prevx)==1 and prevx.isupper()) or (len(nextx)==1 and nextx.isupper())):
            out.append(LEX.golds.get(x) if isinstance(LEX.golds.get(x),str) else word_ps(x,nxt)); continue
        out.append(word_ps(x,nxt))
    return ' '.join(o for o in out if o)
if __name__=='__main__':
    for s in ["A trading offer pays you when someone you referred opens a broker account, and the CPA is $25.50 or 1.4% in 2025.","Example: you spent $60, got 0 F T D s, target C P A $25. What do you do?","Retargeting the 3rd ad set — 10–16 slides."]:
        print(normalize(s)); print(g2p(s))
