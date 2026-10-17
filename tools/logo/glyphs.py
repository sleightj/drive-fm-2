import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
FD=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'../../assets-src/fonts/')
def glyphs(font, chars):
    t=TTFont(FD+font+'.ttf'); gs=t.getGlyphSet(); cmap=t.getBestCmap(); out={}
    for c in chars:
        g=cmap[ord(c)]; sp=SVGPathPen(gs, ntos=lambda v: ('%.1f'%v).rstrip('0').rstrip('.'))
        gs[g].draw(TransformPen(sp,(1,0,0,-1,0,0)))
        bp=BoundsPen(gs); gs[g].draw(bp)
        out[c]={'d':sp.getCommands(),'adv':gs[g].width,'bbox':bp.bounds}
    return out
res={'dela':glyphs('DelaGothicOne-400','DRIVE'),'bungee':glyphs('Bungee-400','DRIVE'),'sedg':glyphs('SedgwickAveDisplay-400','FMfm'),'marker':glyphs('PermanentMarker-400','FM')}
json.dump(res,open('glyphs.json','w'))
for k,v in res.items():
    for c,g in v.items(): print(k,c,g['adv'],g['bbox'],len(g['d']))
