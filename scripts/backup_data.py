"""Snapshot SQLite and copy mutable files. Pause app writes while copying files."""
import argparse
import os
from pathlib import Path
import shutil
import sqlite3


def backup(destination, data_dir=None):
    project = Path(__file__).resolve().parent.parent
    source = Path(data_dir).resolve() if data_dir else project
    database = source / 'db.sqlite3'
    escucha = source / 'escucha_data.json' if data_dir else project / 'maps' / 'escucha_data.json'
    if not database.is_file():
        raise FileNotFoundError(database)
    destination = Path(destination).resolve()
    if destination == source or source.is_relative_to(destination):
        raise ValueError('Choose a new backup directory, not the source directory or its parent.')
    destination.mkdir(parents=True, exist_ok=False)
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(destination / 'db.sqlite3') as snapshot:
            original.backup(snapshot)
            if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('SQLite integrity check failed.')
    if escucha.is_file():
        shutil.copy2(escucha, destination / 'escucha_data.json')
    if (source / 'media').is_dir():
        shutil.copytree(source / 'media', destination / 'media')
    print(f'Backup created: {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', help='New directory; existing directories are never overwritten.')
    parser.add_argument('--data-dir', default=os.environ.get('DATA_DIR'), help='Source volume directory; defaults to the original local layout.')
    args = parser.parse_args()
    backup(args.destination, args.data_dir)
