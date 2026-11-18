from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import migrations


def configure_admin(apps, schema_editor):
    # Owner-requested account update, applied once on each database by migrate.
    User = apps.get_model(settings.AUTH_USER_MODEL)
    User.objects.using(schema_editor.connection.alias).update_or_create(
        username='admin',
        defaults={
            'email': 'admin@gmail.com',
            'password': make_password('123'),
            'is_active': True,
            'is_staff': True,
            'is_superuser': True,
        },
    )


class Migration(migrations.Migration):
    dependencies = [
        ('elections', '0004_encuesta'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(configure_admin, migrations.RunPython.noop)]
