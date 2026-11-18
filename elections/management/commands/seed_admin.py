"""Initialize an admin on an existing volume without resetting production users."""
from contextlib import closing
from pathlib import Path
import sqlite3

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import identify_hasher, is_password_usable
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = 'Import the bundled administrator only if no active superuser exists.'

    def add_arguments(self, parser):
        parser.add_argument('--source', default=str(settings.BASE_DIR / 'db.sqlite3'))

    @transaction.atomic
    def handle(self, *args, **options):
        User = get_user_model()
        if User.objects.filter(is_superuser=True, is_active=True).exists():
            self.stdout.write('Existing administrator preserved.')
            return
        source = Path(options['source']).resolve()
        if not source.is_file():
            raise CommandError('Bundled SQLite database is missing; create an administrator explicitly.')
        try:
            with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as connection:
                row = connection.execute(
                    'SELECT username, password, email FROM auth_user '
                    'WHERE is_superuser=1 AND is_staff=1 AND is_active=1 ORDER BY id LIMIT 1'
                ).fetchone()
        except sqlite3.Error as error:
            raise CommandError('Cannot read the bundled administrator.') from error
        if row is None:
            raise CommandError('No active administrator in bundled SQLite; run createsuperuser.')
        username, password_hash, email = row
        try:
            identify_hasher(password_hash)
        except ValueError as error:
            raise CommandError('Bundled administrator has an unsupported password hash.') from error
        if not is_password_usable(password_hash):
            raise CommandError('Bundled administrator has no usable password.')
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                'password': password_hash,
                'email': email,
                'is_superuser': True,
                'is_staff': True,
                'is_active': True,
            },
        )
        if not created:
            raise CommandError('That username already exists; manage its permissions explicitly.')
        self.stdout.write(self.style.SUCCESS(f'Administrator initialized from bundled SQLite: {user.username}'))
