"""Extract this release into a new directory, mapping oversized legacy filenames."""
import hashlib
import json
import pathlib
import shutil
import sys
import zipfile

archive, directory = sys.argv[1:]
root = pathlib.Path(directory)
root.mkdir(parents=True, exist_ok=False)
aliases = {}
with zipfile.ZipFile(archive) as package:
    for entry in package.infolist():
        name = pathlib.PurePosixPath(entry.filename)
        if name.is_absolute() or '..' in name.parts:
            raise ValueError('Unexpected entry: ' + entry.filename)
        safe_parts = []
        for part in name.parts:
            if chr(92) in part or ':' in part:
                part = 'legacy-path-' + hashlib.sha256(part.encode()).hexdigest()[:24]
            safe_parts.append(part)
        target = root.joinpath(*safe_parts)
        if list(name.parts) != safe_parts:
            aliases[str(target.relative_to(root))] = entry.filename
        if len(name.name.encode()) > 240:
            digest = hashlib.sha256(entry.filename.encode()).hexdigest()[:24]
            target = target.with_name('legacy-' + digest + name.suffix)
            aliases[str(target.relative_to(root))] = entry.filename
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(entry) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            if entry.create_system == 3 and entry.external_attr >> 16:
                target.chmod((entry.external_attr >> 16) & 0o777)
(root / 'legacy-name-map.json').write_text(json.dumps(aliases, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Extracted {len(package.infolist())} entries, {len(aliases)} legacy aliases')
