# flatten glyph outlines into polygons (font units, y down) for bottom-profile queries
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
FD=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'../../assets-src/fonts/')
class Flat(BasePen):
    def __init__(s, gs): super().__init__(gs); s.polys=[]; s.cur=[]
    def _moveTo(s,p): s.cur=[p]
    def _lineTo(s,p): s.cur.append(p)
    def _curveToOne(s,a,b,c):
        p0=s.cur[-1]
        for i in range(1,9):
            t=i/8; u=1-t
            s.cur.append((u**3*p0[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*c[0], u**3*p0[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*c[1]))
    def _qCurveToOne(s,a,b):
        p0=s.cur[-1]
        for i in range(1,7):
            t=i/6; u=1-t
            s.cur.append((u*u*p0[0]+2*u*t*a[0]+t*t*b[0], u*u*p0[1]+2*u*t*a[1]+t*t*b[1]))
    def _closePath(s):
        if s.cur: s.polys.append([(x,-y) for x,y in s.cur]); s.cur=[]
    _endPath=_closePath
def polys(font, ch):
    t=TTFont(FD+font+'.ttf'); gs=t.getGlyphSet(); g=t.getBestCmap()[ord(ch)]
    f=Flat(gs); gs[g].draw(f); return f.polys
def crossings(polys, x):
    ys=[]
    for P in polys:
        for i in range(len(P)):
            (x1,y1),(x2,y2)=P[i],P[(i+1)%len(P)]
            if (x1<=x<x2) or (x2<=x<x1):
                ys.append(y1+(x-x1)*(y2-y1)/(x2-x1))
    return sorted(ys)
