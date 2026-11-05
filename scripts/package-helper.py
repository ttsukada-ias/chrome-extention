"""Build the Helper by Tets Chrome Web Store upload, using only runtime assets."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

repo = Path(__file__).resolve().parent.parent
root = repo / 'Helper By Tets'
manifest = json.loads((root / 'manifest.json').read_text())
output = repo / f"helper-by-tets-v{manifest['version']}.zip"
files = sorted(
    [root / 'manifest.json']
    + [file for file in root.iterdir() if file.is_file() and file.suffix in {'.js', '.html'}]
    + [file for file in (root / 'icons').iterdir() if file.is_file() and file.suffix in {'.png', '.svg'}]
)
for file in files:
    if file.is_symlink():
        raise ValueError(f'Symlinks are not allowed in the upload: {file.name}')
with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        archive.write(file, file.relative_to(root).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None, 'ZIP integrity check failed'
    assert json.loads(archive.read('manifest.json'))['version'] == manifest['version']
    assert len(archive.namelist()) == len(set(archive.namelist()))
    for file in files:
        assert archive.read(file.relative_to(root).as_posix()) == file.read_bytes()
print(f"Created {output.name}: {len(files)} runtime files, {output.stat().st_size:,} bytes")
