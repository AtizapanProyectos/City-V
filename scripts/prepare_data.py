"""Seed a new persistent volume from the bundled SQLite database once."""
import os
from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import tempfile


def initialize_database(source, destination):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    if destination.exists():
        return False
    if not source.is_file():
        raise FileNotFoundError(f'Initial SQLite database is missing: {source}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.sqlite-seed-', dir=destination.parent) as directory:
        snapshot_path = Path(directory) / 'db.sqlite3'
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
            with closing(sqlite3.connect(snapshot_path)) as snapshot:
                original.backup(snapshot)
                if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Initial SQLite database failed its integrity check.')
        try:
            output = destination.open('xb')
        except FileExistsError:
            return False
        try:
            with output, snapshot_path.open('rb') as snapshot:
                shutil.copyfileobj(snapshot, output)
        except Exception:
            destination.unlink()
            raise
    return True


if __name__ == '__main__':
    project = Path(__file__).resolve().parent.parent
    data_dir = Path(os.environ.get('DATA_DIR', str(project)))
    created = initialize_database(project / 'db.sqlite3', data_dir / 'db.sqlite3')
    print('Persistent SQLite initialized from repository.' if created else 'Existing SQLite preserved.')
