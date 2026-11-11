"""Build a runtime-only FrameNote ZIP with manifest.json at the archive root."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
files = {
    'manifest.json', 'background.js', 'backup-data.js', 'backup-downloads.js',
    'content.js', 'keyboard-guard.js', 'media-info.js', 'media.js',
    'options.html', 'options.css', 'options.js', 'privacy.html', 'PRIVACY.md', 'README.md', 'LICENSE',
}
files.update(str(path.relative_to(ROOT)) for path in (ROOT / 'icons').glob('*.png'))
required = {manifest['background']['service_worker'], manifest['options_ui']['page']}
required.update(name for script in manifest['content_scripts'] for name in script['js'])
for html in ('options.html', 'privacy.html'):
    required.update(re.findall(r'(?:src|href)="([^"#]+)"', (ROOT / html).read_text()))
assert required <= files, f'Missing package files: {required - files}'
assert all((ROOT / name).is_file() for name in files)
output = ROOT / 'release' / f"framenote-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(ROOT / name, name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('manifest.json'))['version'] == manifest['version']
print(f'{output}\nSHA-256: {hashlib.sha256(output.read_bytes()).hexdigest()}\n{output.stat().st_size:,} bytes; {len(files)} files')
