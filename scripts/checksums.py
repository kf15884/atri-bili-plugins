from pathlib import Path
import hashlib
root=Path(__file__).resolve().parents[1]
rows=[]
for p in sorted(root.rglob('*')):
    if not p.is_file() or p==root/'SHA256SUMS': continue
    if any(x in p.relative_to(root).parts for x in ['node_modules','.git','data','.atri-bili-backups']): continue
    rows.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(root).as_posix())
(root/'SHA256SUMS').write_text('\n'.join(rows)+'\n')
