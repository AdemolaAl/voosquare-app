import ctypes
L=ctypes.CDLL('libflite.so.1',mode=ctypes.RTLD_GLOBAL)
U=ctypes.CDLL('libflite_usenglish.so.1',mode=ctypes.RTLD_GLOBAL)
C=ctypes.CDLL('libflite_cmulex.so.1',mode=ctypes.RTLD_GLOBAL)
L.flite_init()
C.cmulex_init.restype=ctypes.c_void_p
lex=C.cmulex_init()
L.lex_lookup.restype=ctypes.c_void_p; L.lex_lookup.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p]
L.val_car.restype=ctypes.c_void_p;L.val_car.argtypes=[ctypes.c_void_p]
L.val_cdr.restype=ctypes.c_void_p;L.val_cdr.argtypes=[ctypes.c_void_p]
L.val_string.restype=ctypes.c_char_p;L.val_string.argtypes=[ctypes.c_void_p]
def arpa(w):
    v=L.lex_lookup(lex,w.lower().encode(),None,None);out=[]
    while v:
        out.append(L.val_string(L.val_car(v)).decode()); v=L.val_cdr(v)
    return out
if __name__=='__main__':
    for w in ['joinvoo','kwame','monetization','opens','sweepstakes','geo','nutra','lander','retargeting']: print(w,arpa(w))
