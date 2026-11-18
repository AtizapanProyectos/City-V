from contextlib import closing
from io import StringIO
from pathlib import Path
import sqlite3
import tempfile

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase


class SeedAdminTests(TestCase):
    def setUp(self):
        get_user_model().objects.all().delete()

    def source_database(self, directory):
        source = Path(directory) / 'source.sqlite3'
        with closing(sqlite3.connect(source)) as connection:
            connection.execute('CREATE TABLE auth_user (id INTEGER, username TEXT, password TEXT, email TEXT, is_superuser INTEGER, is_staff INTEGER, is_active INTEGER)')
            connection.execute(
                'INSERT INTO auth_user VALUES (1, ?, ?, ?, 1, 1, 1)',
                ('admin', make_password('bundled-test-password'), ''),
            )
            connection.commit()
        return source

    def test_initializes_hashed_admin_and_never_resets_changed_password(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source_database(directory)
            call_command('seed_admin', source=str(source), stdout=StringIO())
            user = get_user_model().objects.get(username='admin')
            self.assertTrue(user.is_active and user.is_staff and user.is_superuser)
            self.assertTrue(user.check_password('bundled-test-password'))
            user.set_password('changed-in-production')
            user.save(update_fields=['password'])
            call_command('seed_admin', source=str(source), stdout=StringIO())
            user.refresh_from_db()
            self.assertTrue(user.check_password('changed-in-production'))
            self.assertEqual(get_user_model().objects.count(), 1)

    def test_existing_username_is_never_promoted(self):
        user = get_user_model().objects.create_user(username='admin', password='existing-password')
        with tempfile.TemporaryDirectory() as directory:
            source = self.source_database(directory)
            with self.assertRaises(CommandError):
                call_command('seed_admin', source=str(source), stdout=StringIO())
        user.refresh_from_db()
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.check_password('existing-password'))

    def test_existing_admin_skips_import_even_when_source_missing(self):
        user = get_user_model().objects.create_superuser(username='owner', password='existing-password')
        call_command('seed_admin', source='missing.sqlite3', stdout=StringIO())
        self.assertEqual(list(get_user_model().objects.values_list('username', flat=True)), [user.username])
