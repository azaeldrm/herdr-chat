import json, tempfile
from pathlib import Path

READERS = Path(__file__).resolve().parent.parent / "mods" / "herdr-chat" / "readers"

def source():
    """The session reader as the mod sends it: readers/*.py joined in manifest order."""
    order = json.loads((READERS / "manifest.json").read_text())
    return "\n".join((READERS / f).read_text() for f in order)

def bundle():
    """The joined reader written to a temporary file, for running as a script."""
    f = tempfile.NamedTemporaryFile("w", suffix="-read_session.py", delete=False)
    f.write(source())
    f.close()
    return Path(f.name)
