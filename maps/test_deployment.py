"""Exercise the production middleware, login and persistent-file integration."""
import json
from io import BytesIO
from pathlib import Path
import re
import tempfile
from unittest.mock import patch
from urllib.parse import urlsplit

from django.test import Client, TestCase, override_settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook

from elections.models import Encuesta
from maps import views


@override_settings(
    DEBUG=False,
    ALLOWED_HOSTS=['localhost'],
    CSRF_TRUSTED_ORIGINS=[],
    SESSION_COOKIE_SECURE=True,
    CSRF_COOKIE_SECURE=True,
    SECURE_SSL_REDIRECT=True,
)
class DeploymentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username='deployment-test', password='test-password-only')

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, HTTP_HOST='localhost')

    def token(self):
        response = self.client.get('/', secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.cookies['csrftoken']['secure'])
        return self.client.cookies['csrftoken'].value

    def login(self):
        return self.client.post(
            '/', {'usuario': 'deployment-test', 'password': 'test-password-only'},
            secure=True, HTTP_X_CSRFTOKEN=self.token(), HTTP_ORIGIN='https://localhost',
        )

    def test_https_and_host_validation(self):
        self.assertEqual(self.client.get('/').status_code, 301)
        self.assertEqual(self.client.get('/', secure=True, HTTP_HOST='untrusted.example').status_code, 400)
        self.assertEqual(self.client.get('/', HTTP_X_FORWARDED_PROTO='https').status_code, 200)

    def test_login_and_map_issue_secure_cookies(self):
        response = self.login()
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/mapa/')
        self.assertTrue(response.cookies['sessionid']['secure'])
        del self.client.cookies['csrftoken']
        response = self.client.get('/mapa/', secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('csrftoken', response.cookies)

    def test_incorrect_database_password_is_rejected(self):
        response = self.client.post(
            '/', {'usuario': 'admin', 'password': 'incorrect-password'}, secure=True,
            HTTP_X_CSRFTOKEN=self.token(), HTTP_ORIGIN='https://localhost',
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_every_mutation_rejects_missing_csrf(self):
        for endpoint in (
            '/', '/api/procesar-escucha/', '/api/cargar-promovidos/',
            '/api/guardar-promovido/', '/api/reiniciar-promovidos/',
            '/api/guardar-encuesta/', '/api/eliminar-encuesta/', '/api/reiniciar-encuestas/',
        ):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.post(endpoint, secure=True).status_code, 403)

    def test_valid_token_saves_and_foreign_origin_is_rejected(self):
        self.login()
        token = self.client.cookies['csrftoken'].value
        endpoint = '/api/guardar-encuesta/'
        response = self.client.post(
            endpoint, {'casa_encuestadora': 'Deployment test'}, secure=True,
            HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='https://localhost',
        )
        self.assertEqual(response.json()['status'], 'ok')
        self.assertEqual(Encuesta.objects.count(), 1)
        response = self.client.post(
            endpoint, secure=True, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='https://untrusted.example',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Encuesta.objects.count(), 1)

    def test_static_assets_are_served_in_production(self):
        response = self.client.get('/static/js/mapa.js', secure=True)
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_template_static_paths_match_filename_case(self):
        self.login()
        for page in ('/', '/mapa/'):
            response = self.client.get(page, secure=True, follow=True)
            paths = re.findall(r'''(?:src|href)=["'](/static/[^"']+)''', response.content.decode('utf-8'))
            for asset in paths:
                with self.subTest(asset=asset):
                    asset_response = self.client.get(urlsplit(asset).path, secure=True)
                    self.assertEqual(asset_response.status_code, 200)
                    asset_response.close()

    def test_social_data_survives_new_client(self):
        with tempfile.TemporaryDirectory() as directory:
            location = Path(directory) / 'escucha_data.json'
            workbook = Workbook()
            workbook.active.title = 'Datos analíticos'
            workbook.active.append(['Métrica', 'Valor'])
            workbook.active.append(['Menciones', 100])
            workbook.active.append(['Menciones en las redes sociales', 80])
            workbook.active.append(['Número de positivos', 40])
            content = BytesIO()
            workbook.save(content)
            files = [SimpleUploadedFile(f'report-{index}.xlsx', content.getvalue()) for index in range(3)]
            with patch.object(views, 'ESCUCHA_FILE', location):
                response = self.client.post(
                    '/api/procesar-escucha/', {'files': files}, secure=True,
                    HTTP_X_CSRFTOKEN=self.token(), HTTP_ORIGIN='https://localhost',
                )
                self.assertEqual(response.json()['status'], 'ok')
                self.assertTrue(location.is_file())
                stored = json.loads(location.read_text(encoding='utf-8'))
                restarted_client = Client(HTTP_HOST='localhost')
                response = restarted_client.get('/api/escucha-social/', secure=True)
                self.assertEqual(response.json()['data'], stored['data'])

    def test_inactive_database_user_cannot_log_in(self):
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])
        self.login()
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_logout_and_database_password_changes_control_access(self):
        self.assertEqual(self.client.get('/mapa/', secure=True).status_code, 302)
        self.login()
        self.assertEqual(str(self.user.pk), self.client.session['_auth_user_id'])
        self.client.get('/logout/', secure=True)
        self.assertNotIn('_auth_user_id', self.client.session)
        self.user.set_password('a-new-database-password')
        self.user.save(update_fields=['password'])
        self.assertEqual(self.login().status_code, 200)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_requested_database_admin_can_access_map_and_django_admin(self):
        admin = get_user_model().objects.get(username='admin')
        self.assertEqual(admin.email, 'admin@gmail.com')
        self.assertTrue(admin.is_active and admin.is_staff and admin.is_superuser)
        self.assertTrue(admin.check_password('123'))
        self.assertNotEqual(admin.password, '123')
        response = self.client.post(
            '/', {'usuario': 'admin', 'password': '123'}, secure=True,
            HTTP_X_CSRFTOKEN=self.token(), HTTP_ORIGIN='https://localhost',
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get('/mapa/', secure=True).status_code, 200)
        self.assertEqual(self.client.get('/admin/', secure=True).status_code, 200)
