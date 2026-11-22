import re
src=open('index.src.html',encoding='utf-8').read()
def icon(m):
    svg=open(f'node_modules/lucide-static/icons/{m.group(1)}.svg',encoding='utf-8').read()
    svg=re.sub(r'<!--.*?-->','',svg,flags=re.S)
    head,rest=svg.split('>',1)
    head=re.sub(r'\s(width|height|class|stroke-width|stroke|fill|stroke-linecap|stroke-linejoin)="[^"]*"','',head)
    return (head.replace('<svg','<svg class="ic"',1)+'>'+rest).strip()
out=re.sub(r'\{\{i:([a-z0-9-]+)\}\}',icon,src)
open('index.html','w',encoding='utf-8').write(out)
print('built', len(out))
