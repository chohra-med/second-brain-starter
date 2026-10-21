#!/usr/bin/env bash
# index --exclude-dir: a generated or vendored directory (ios, android) is left out of the scan,
# recorded in the inventory, and unsafe or duplicate values are refused without writing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_python311
python3 -I -B - "$ROOT/bin/sh-index.sh" <<'PY'
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
index=sys.argv[1]
with tempfile.TemporaryDirectory(prefix='index-exclusion-fixture-') as temp:
    root=Path(temp)/'app';root.mkdir()
    (root/'package.json').write_text('{"name":"mobile-fixture"}\n')
    (root/'ai_rules').mkdir();(root/'ai_rules/context_map.md').write_text('# Existing custom map\n')
    (root/'src').mkdir();(root/'src/App.tsx').write_text('export const App = true;\n')
    for path in ('android/app','ios'):
        (root/path).mkdir(parents=True,exist_ok=True)
    (root/'android/build.gradle').write_text('plugins {}\n')
    (root/'android/app/build.gradle').write_text('plugins {}\n')
    (root/'ios/Package.swift').write_text('// generated fixture\n')
    native_before={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
    def run(*args):
        return subprocess.run(['bash',index,str(root),*args],text=True,capture_output=True)
    result=run('--exclude-dir','android','--source','src/App.tsx','--exclude-dir','ios')
    assert result.returncode==0,result.stderr
    output=root/'ai_rules/project_inventory.json';data=json.loads(output.read_text())
    assert [p['path'] for p in data['packages']]==['.']
    assert data['scan']['complete'] is True
    assert data['scan']['excluded_directories']==['android','ios']
    assert {(p['path'],p['category']) for p in data['exclusions']} >= {('android','explicit directory exclusion'),('ios','explicit directory exclusion')}
    assert [p['path'] for p in data['packages'][0]['representative_sources']]==['src/App.tsx']
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in native_before.items())
    before=output.read_bytes()
    preview=run('--exclude-dir','android','--exclude-dir','ios','--source','src/App.tsx','--preview')
    assert preview.returncode==0,preview.stderr
    assert preview.stdout.encode()==before
    assert output.read_bytes()==before

    outside=Path(temp)/'outside';outside.mkdir();(root/'escape').symlink_to(outside,target_is_directory=True)
    for value in ('.','../outside',str(outside),'android/../src','android/','package.json','escape','escape/nested'):
        result=run('--exclude-dir',value)
        assert result.returncode!=0,(value,result.stdout)
        assert output.read_bytes()==before,value
    result=run('--exclude-dir','android','--exclude-dir','android')
    assert result.returncode!=0
    assert output.read_bytes()==before
    result=run('--exclude-dir','android','--source','android/app/build.gradle')
    assert result.returncode!=0
    assert output.read_bytes()==before
    result=run('--exclude-dir','future-generated','--source','src/App.tsx')
    assert result.returncode==0,result.stderr
    assert json.loads(output.read_text())['scan']['excluded_directories']==['future-generated']
    print('PASS: explicit native exclusion, unsafe paths, no-overwrite rejection, unchanged source and absent future directory')
PY
