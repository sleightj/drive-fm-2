import json, math, random, sys
sys.path.insert(0,'.')
from geom import polys, crossings
G=json.load(open('glyphs.json'))
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
_F={}
def gpath(font,ch,sc,dx):
    if font not in _F: _F[font]=TTFont(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'../../assets-src/fonts/')+font+'.ttf')
    t=_F[font]; gs=t.getGlyphSet(); g=t.getBestCmap()[ord(ch)]
    sp=SVGPathPen(gs, ntos=lambda v: ('%.1f'%v).rstrip('0').rstrip('.'))
    gs[g].draw(TransformPen(sp,(sc,0,0,-sc,dx,0)))
    return sp.getCommands()
A=dict(a.split('=') for a in sys.argv[2:])
num=lambda k,d: float(A.get(k,d))
P=dict(fm='#c8ff1a', fmlo='#9be600', ext='#ff2d88', ink='#10101e', cream='#fffaf0')
def f1(v): return ('%.1f'%v).rstrip('0').rstrip('.')
# ---------- DRIVE ----------
S=0.205; track=-28; x=0; dv=[]
for c in 'DRIVE':
    g=G['dela'][c]; dv.append(f'<path d="{gpath("DelaGothicOne-400",c,S,x)}"/>'); x+=(g['adv']+track)*S
DW=x-track*S; CAP=737*S
DX,DY=0,0  # DRIVE baseline origin = world origin
# ---------- FM ----------
FS=num('fs',0.33); kern=num('kern',-70)
fm=[]; fpolys=[]; x=0
for c in 'FM':
    g=G['sedg'][c]
    fm.append(f'<path d="{gpath("SedgwickAveDisplay-400",c,FS,x)}"/>')
    for poly in polys('SedgwickAveDisplay-400',c): fpolys.append([(x+px*FS,py*FS) for px,py in poly])
    x+=(g['adv']+kern)*FS
FW=x
FX,FY,ROT=num('fx',430),num('fy',290),num('rot',-8)
ca,sa=math.cos(math.radians(ROT)),math.sin(math.radians(ROT))
def tw(p): return (FX+p[0]*ca-p[1]*sa, FY+p[0]*sa+p[1]*ca)
def inside(pt):
    return sum(1 for y in crossings(fpolys,pt[0]) if y<pt[1])%2==1
def bottom_at(xl):
    c=crossings(fpolys,xl); return max(c) if c else None
Mx=(517+kern)*FS
# flick underline (local coords): from under F, dipping, flicking up past M; drawn as a tapered filled shape
def bez(t,p):
    u=1-t; return tuple(u**3*p[0][i]+3*u*u*t*p[1][i]+3*u*t*t*p[2][i]+t**3*p[3][i] for i in (0,1))
SWL=num('swl',-34)
sw=[(SWL,num('sw0y',34)),(SWL+(FW-SWL)*0.3,num('sw1y',58)),(SWL+(FW-SWL)*0.75,num('sw2y',50)),(FW+num('swr',40),num('sw3y',-10))]
def taper(curve,w0,w1,n=28):
    L=[];R=[]
    for i in range(n+1):
        t=i/n; p=bez(t,curve); q=bez(min(1,t+1e-3),curve); r=bez(max(0,t-1e-3),curve)
        dx,dy=q[0]-r[0],q[1]-r[1]; d=math.hypot(dx,dy) or 1
        w=(w0+(w1-w0)*t**1.6)/2
        L.append((p[0]-dy/d*w,p[1]+dx/d*w)); R.append((p[0]+dy/d*w,p[1]-dx/d*w))
    pts=L+R[::-1]
    return 'M'+'L'.join(f'{f1(a)} {f1(b)}' for a,b in pts)+'Z'
swp=taper(sw,num('sww0',6),num('sww1',15)) if A.get('rev') else taper(sw,15,1.5)
# drips (world coords, vertical)
def dripPath(x0,y0,L,w):
    b=w*0.8; t=w*0.42
    return (f'M{f1(x0-w*1.15)} {f1(y0-5)}C{f1(x0-w*.45)} {f1(y0)} {f1(x0-t)} {f1(y0+L*.3)} {f1(x0-t)} {f1(y0+L-b*.6)}'
            f'A{f1(b)} {f1(b)} 0 1 0 {f1(x0+t)} {f1(y0+L-b*.6)}'
            f'C{f1(x0+t)} {f1(y0+L*.3)} {f1(x0+w*.45)} {f1(y0)} {f1(x0+w*1.15)} {f1(y0-5)}Z')
dp=''
for (xl,L,w) in [(112*FS,64,9.5),(330*FS,24,6.5),(Mx+45*FS,40,8),(Mx+330*FS,52,7.5),(Mx+515*FS,84,10)]:
    yb=bottom_at(xl)
    if yb is None: continue
    wx,wy=tw((xl,yb-3)); dp+=dripPath(wx,wy,L,w)
for t,L,w in ((num('dt1',0.22),46,8),(num('dt2',0.5),26,6.5)):
    q=bez(t,sw); wx,wy=tw((q[0],q[1]+4)); dp+=dripPath(wx,wy,L,w)
# overspray dots
random.seed(11)
dots={1.3:[],2.1:[],3.0:[]}
edges=[poly for poly in fpolys]
for poly in edges:
    n=len(poly)
    for i in range(n):
        (x1,y1),(x2,y2)=poly[i],poly[(i+1)%n]
        seg=math.hypot(x2-x1,y2-y1); k=max(1,int(seg/2.2))
        for j in range(k):
            if random.random()>0.62: continue
            t=(j+random.random())/k; px,py=x1+(x2-x1)*t,y1+(y2-y1)*t
            nx,ny=-(y2-y1)/(seg+1e-9),(x2-x1)/(seg+1e-9)
            d=3.5+random.expovariate(1/8.5)
            for sgn in (1,-1):
                qx,qy=px+nx*d*sgn,py+ny*d*sgn
                if not inside((qx,qy)):
                    r=random.choice([1.3,1.3,1.3,2.1,2.1,3.0]) if d<12 else (2.1 if random.random()<0.15 else 1.3)
                    dots[r].append((qx,qy)); break
dotsvg=''.join(f'<path stroke-width="{r}" d="{"".join(f"M{f1(x)} {f1(y)}h0" for x,y in pts)}"/>' for r,pts in dots.items())
# shine strokes (local coords): short highlights on F stem and M left leg / right leg tops
def sh(x,y,dx,L,w):
    # tapered stroke from (x,y) along (dx,L) plus a dot beyond its tip
    n=math.hypot(dx,L); nx,ny=L/n*w/2,-dx/n*w/2
    return (f'M{f1(x-nx)} {f1(y-ny)}Q{f1(x)} {f1(y-w*.9)} {f1(x+nx)} {f1(y+ny)}L{f1(x+dx)} {f1(y+L)}Z'
            f'M{f1(x+dx*1.22+2.2)} {f1(y+L*1.22)}a2.2 2.2 0 1 0-4.4 0a2.2 2.2 0 1 0 4.4 0Z')
shine=sh(40*FS+40,-560*FS,-6,62,7)+sh(Mx+215*FS,-760*FS,-8,52,6.5)+sh(Mx+505*FS,-760*FS,-4,44,6)
def star(cx,cy,R):
    r=R*0.16
    return f'M{f1(cx)} {f1(cy-R)}Q{f1(cx+r)} {f1(cy-r)} {f1(cx+R)} {f1(cy)}Q{f1(cx+r)} {f1(cy+r)} {f1(cx)} {f1(cy+R)}Q{f1(cx-r)} {f1(cy+r)} {f1(cx-R)} {f1(cy)}Q{f1(cx-r)} {f1(cy-r)} {f1(cx)} {f1(cy-R)}Z'
# bounds
xs=[-40, DW+CAP*0.2126+40]; ys=[-CAP-34]
for poly in fpolys:
    for p in poly: q=tw(p); xs.append(q[0]); ys.append(q[1])
for t in [i/20 for i in range(21)]:
    q=tw(bez(t,sw)); xs.append(q[0]); ys.append(q[1])
ys.append(max(ys)+60)
pad=16
VB=f'{f1(min(xs)-pad)} {f1(min(ys)-pad)} {f1(max(xs)-min(xs)+2*pad)} {f1(max(ys)-min(ys)+2*pad)}'
defs=f'''<linearGradient id="dfm-chr" gradientUnits="userSpaceOnUse" x1="0" y1="-151" x2="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#cfe0ff"/><stop offset=".53" stop-color="#7d8fd0"/><stop offset=".55" stop-color="#1a1f55"/><stop offset=".66" stop-color="#3b4fe0"/><stop offset=".88" stop-color="#a6f3ff"/><stop offset="1" stop-color="#fff"/></linearGradient>
'''
defs2=f'''<linearGradient id="dfm-lime" gradientUnits="userSpaceOnUse" x1="0" y1="-120" x2="0" y2="60"><stop offset="0" stop-color="{P['fm']}"/><stop offset="1" stop-color="{P['fmlo']}"/></linearGradient>
<filter id="dfm-rough" x="-10%" y="-10%" width="120%" height="125%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="4" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".55"/></filter>
<filter id="dfm-mist" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="d"/><feGaussianBlur in="d" stdDeviation="4" result="a"/><feGaussianBlur in="d" stdDeviation="11" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="a"/></feMerge><feComponentTransfer><feFuncA type="linear" slope=".62"/></feComponentTransfer></filter>
'''
defs+=f'''<g id="dfm-dv">{''.join(dv)}</g>'''
defs2+=f'''<g id="dfm-fm">{''.join(fm)}<path d="{swp}"/></g>
<path id="dfm-dr" d="{dp}"/>'''
SW_ST=num('swst',44); SW_EX=num('swex',10); SW_CH=num('swch',8); SW_TI=num('swti',15); SW_TL=num('swtl',3)
FMT=f'translate({f1(FX)} {f1(FY)}) rotate({f1(ROT)})'
vb=[float(v) for v in VB.split()]
def pct(x,y):
    xx=x+math.tan(math.radians(12))*(-y)
    return (round((xx-vb[0])/vb[2]*100,1), round((y-vb[1])/vb[3]*100,1))
print('glints', pct(16,-138), pct(DW-34,-150))
tx=[tw(p)[0] for poly in fpolys for p in poly]
print('tag x range %', round((min(tx)-vb[0])/vb[2]*100,1), round((max(tx)+40-vb[0])/vb[2]*100,1))
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB}"><defs>{defs}</defs>
<g class="dfm-drive" transform="skewX(-12)">
<g transform="translate(12 16)" fill="{P['ink']}" stroke="{P['ink']}" stroke-width="{SW_ST}" stroke-linejoin="round" opacity=".42"><use href="#dfm-dv"/><use href="#dfm-dv" transform="translate(9 16)"/></g>
<g fill="{P['cream']}" stroke="{P['cream']}" stroke-width="{SW_ST}" stroke-linejoin="round"><use href="#dfm-dv"/><use href="#dfm-dv" transform="translate(9 16)"/></g>
<g fill="{P['ink']}" stroke="{P['ink']}" stroke-width="{SW_EX}" stroke-linejoin="round"><use href="#dfm-dv" transform="translate(9 16)"/></g>
<g fill="{P['ext']}">{''.join(f'<use href="#dfm-dv" transform="translate({i*0.55:.1f} {i})"/>' for i in range(16,0,-2))}</g>
<g stroke="{P['ink']}" stroke-width="{SW_CH}" stroke-linejoin="round" fill="url(#dfm-chr)" paint-order="stroke"><use href="#dfm-dv"/></g>
</g>
</svg>@@SPLIT@@<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB}"><defs>{defs2}</defs>
<g class="dfm-tag"><g filter="url(#dfm-rough)">
<g fill="{P['ink']}" stroke="{P['ink']}" stroke-linejoin="round"><use href="#dfm-fm" transform="translate(4 6) {FMT}" stroke-width="{SW_TI}" filter="url(#dfm-mist)" opacity=".45"/><use href="#dfm-fm" transform="translate(4 6) {FMT}" stroke-width="{SW_TI}"/><use href="#dfm-dr" transform="translate(4 6)" stroke-width="{SW_TI}"/></g>
<g fill="{P['fm']}" stroke="{P['fm']}" stroke-linejoin="round"><g transform="{FMT}" stroke-width="{SW_TL}"><use href="#dfm-fm" filter="url(#dfm-mist)"/><use href="#dfm-fm" fill="url(#dfm-lime)" stroke="url(#dfm-lime)"/></g><use href="#dfm-dr" stroke-width="2" fill="{P['fmlo']}" stroke="{P['fmlo']}"/></g>
</g>
<g transform="{FMT}" stroke-linecap="round" fill="none"><path d="{shine}" fill="#fff" stroke="none" opacity=".9"/><g stroke="{P['fm']}">{dotsvg}</g></g></g>
</svg>'''
open(sys.argv[1],'w').write(svg)
print('VB',VB,'bytes',len(svg),'dots',sum(len(v) for v in dots.values()),'DW',DW,'FW',FW)
