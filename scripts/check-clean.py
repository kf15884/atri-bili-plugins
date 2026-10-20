from pathlib import Path
r=Path(__file__).resolve().parent.parent
bad=[]
for p in r.rglob('*'):
    if not p.is_file() or any(x in p.parts for x in ['node_modules','.git','dist']): continue
    if any(x in p.relative_to(r).parts for x in ['data','backups']) or p.name in ['koishi.yml','.env','account-session.json','state.json'] or p.suffix in ['.db','.sqlite','.log']:
        bad.append(str(p.relative_to(r)))
if bad: raise SystemExit('不应入库的运行文件：'+str(bad))
print('干净库文件范围检查通过；这不是通用秘密扫描器。')
