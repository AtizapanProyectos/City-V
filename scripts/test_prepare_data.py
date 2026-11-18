from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from prepare_data import initialize_database


class InitializeDatabaseTests(unittest.TestCase):
    def test_seed_includes_committed_wal_records_and_preserves_later_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.sqlite3'
            destination = Path(directory) / 'volume' / 'db.sqlite3'
            with closing(sqlite3.connect(source)) as connection:
                connection.execute('PRAGMA journal_mode=WAL')
                connection.execute('CREATE TABLE records (value TEXT)')
                connection.execute("INSERT INTO records VALUES ('original')")
                connection.commit()
                self.assertTrue(initialize_database(source, destination))
            with closing(sqlite3.connect(destination)) as connection:
                self.assertEqual(connection.execute('SELECT value FROM records').fetchall(), [('original',)])
                connection.execute("INSERT INTO records VALUES ('new in production')")
                connection.commit()
            self.assertFalse(initialize_database(source, destination))
            with closing(sqlite3.connect(destination)) as connection:
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM records').fetchone()[0], 2)

    def test_local_database_is_used_without_copying(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'db.sqlite3'
            with closing(sqlite3.connect(database)) as connection:
                connection.execute('CREATE TABLE records (value TEXT)')
            self.assertFalse(initialize_database(database, database))

    def test_missing_source_fails_without_creating_an_empty_database(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'missing.sqlite3'
            destination = Path(directory) / 'volume' / 'db.sqlite3'
            with self.assertRaises(FileNotFoundError):
                initialize_database(source, destination)
            self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main()
