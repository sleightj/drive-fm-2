import re, sys
svg=open('final.svg').read()
a,b=svg.split('@@SPLIT@@')
def clean(x):
    x=re.sub(r'\s*\n\s*','',x).strip()
    assert "'" not in x and '\\' not in x
    return x
a,b=clean(a),clean(b)
import os
p=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../src/ui/frontend.ts')
s=open(p).read()
i=s.index('/*LOGO-BEGIN*/'); j=s.index('/*LOGO-END*/')
s=s[:i]+"/*LOGO-BEGIN*/\nconst LOGO_DRIVE = '"+a+"';\nconst LOGO_TAG = '"+b+"';\n"+s[j:]
open(p,'w').write(s)
print('drive',len(a),'tag',len(b))
