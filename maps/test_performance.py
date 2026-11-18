from io import BytesIO
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError, connection
from django.test import RequestFactory, TestCase
from django.test.utils import CaptureQueriesContext
from openpyxl import Workbook

from elections.models import Promovido, VotacionAyuntamiento, VotacionDiputacion
from maps import views
from maps.imports import IMPORT_LOCK, atomic_json_write, import_promovidos


def workbook_file(rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Registro'
    sheet.append(['Synthetic fixture'])
    sheet.append(['Synthetic fixture'])
    sheet.append(['Nombre completo', 'Teléfono móvil', 'Fecha de registro', 'Sección electoral',
                  'Medio de contacto preferido', 'Estatus', 'Dirección completa'])
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return SimpleUploadedFile('fixture.xlsx', output.getvalue())


def person_row(index, **changes):
    row = [f'Fixture {index}', f'555{index:07d}', '18/11/2026', 250, 'Teléfono', 'Confirmado', 'Fixture address']
    for index, value in changes.items():
        row[int(index)] = value
    return row


class ImportTests(TestCase):
    def test_bulk_import_reduces_queries_and_is_idempotent(self):
        rows = [person_row(index) for index in range(200)]
        with CaptureQueriesContext(connection) as queries:
            result = import_promovidos(workbook_file(rows))
        self.assertLessEqual(len(queries), 120)  # Original code: 1,200 for 200 rows.
        self.assertEqual(result['creados'], 200)
        self.assertEqual(result['rechazados'], 0)
        result = import_promovidos(workbook_file(rows))
        self.assertEqual(result['creados'], 0)
        self.assertEqual(result['actualizados'], 200)
        self.assertEqual(Promovido.objects.count(), 200)

    def test_duplicate_input_last_valid_row_wins_and_invalid_rows_are_reported(self):
        rows = [person_row(1), person_row(1, **{'5': 'Por visitar'}), person_row(2, **{'2': 'invalid date'})]
        result = import_promovidos(workbook_file(rows))
        self.assertEqual(result['creados'], 1)
        self.assertEqual(result['rechazados'], 1)
        self.assertEqual(result['errores'][0]['fila'], 6)
        self.assertEqual(Promovido.objects.get().estatus, 'Por visitar')

    def test_duplicates_across_batches_do_not_create_extra_people(self):
        rows = [person_row(index) for index in range(501)] + [person_row(0, **{'5': 'Updated'})]
        result = import_promovidos(workbook_file(rows))
        self.assertEqual(result['creados'], 501)
        self.assertEqual(Promovido.objects.count(), 501)
        self.assertEqual(Promovido.objects.get(nombre_completo='Fixture 0').estatus, 'Updated')

    def test_ambiguous_existing_duplicates_are_not_silently_updated(self):
        for _ in range(2):
            Promovido.objects.create(nombre_completo='Fixture 1', telefono_movil='5550000001')
        result = import_promovidos(workbook_file([person_row(1)]))
        self.assertEqual(result['rechazados'], 1)
        self.assertEqual(Promovido.objects.count(), 2)

    def test_failed_batch_rolls_back_and_import_gate_is_released(self):
        with patch('maps.imports.Promovido.objects.bulk_update', side_effect=OperationalError('fixture failure')):
            with self.assertRaises(OperationalError):
                import_promovidos(workbook_file([person_row(1)]))
        self.assertEqual(Promovido.objects.count(), 0)
        request = RequestFactory().post('/api/cargar-promovidos/', {'file': workbook_file([person_row(1)])})
        IMPORT_LOCK.acquire()
        try:
            self.assertEqual(views.cargar_promovidos(request).status_code, 409)
        finally:
            IMPORT_LOCK.release()
        request = RequestFactory().post('/api/cargar-promovidos/', {'file': workbook_file([person_row(1)])})
        self.assertEqual(views.cargar_promovidos(request).status_code, 200)

    def test_missing_columns_are_reported_as_bad_input(self):
        workbook = Workbook()
        workbook.active.title = 'Registro'
        workbook.active.append(['Row 1'])
        workbook.active.append(['Row 2'])
        workbook.active.append(['Wrong columns'])
        output = BytesIO()
        workbook.save(output)
        request = RequestFactory().post('/api/cargar-promovidos/', {'file': SimpleUploadedFile('bad.xlsx', output.getvalue())})
        self.assertEqual(views.cargar_promovidos(request).status_code, 400)

    def test_corrupt_excel_returns_a_recoverable_input_error(self):
        request = RequestFactory().post('/api/cargar-promovidos/', {'file': SimpleUploadedFile('bad.xls', b'not an excel file')})
        self.assertEqual(views.cargar_promovidos(request).status_code, 400)
        self.assertFalse(IMPORT_LOCK.locked())

    def test_database_failure_returns_an_error_and_releases_import_gate(self):
        request = RequestFactory().post('/api/cargar-promovidos/', {'file': workbook_file([person_row(1)])})
        with patch('maps.views.import_promovidos', side_effect=OperationalError('fixture failure')):
            with self.assertLogs('maps.imports', level='ERROR'):
                self.assertEqual(views.cargar_promovidos(request).status_code, 503)
        self.assertFalse(IMPORT_LOCK.locked())


class ReadPerformanceTests(TestCase):
    def test_totals_use_four_queries_without_changing_values(self):
        for Model in (VotacionAyuntamiento, VotacionDiputacion):
            Model.objects.create(seccion=250, pan=60, pri=40, num_votos_validos=100,
                                 lista_nominal=200, casillas=2, partido_ganador='PAN')
        with self.assertNumQueries(4):
            response = views.obtener_datos_totales(RequestFactory().get('/api/totales/'))
        data = json.loads(response.content)
        self.assertEqual(data['ayuntamiento']['participacion'], 50)
        self.assertEqual(data['diputacion']['pan'], 60)
        self.assertEqual(data['ganadores_historicos']['ayuntamiento']['250'], {'partido': 'PAN', 'porcentaje': 60})

    def test_pagination_keeps_legacy_shape_and_filtered_totals(self):
        Promovido.objects.bulk_create([Promovido(nombre_completo=f'Fixture {i}', seccion_electoral=250 if i < 101 else 251) for i in range(125)])
        factory = RequestFactory()
        response = views.listar_promovidos(factory.get('/api/promovidos/'))
        self.assertEqual(len(json.loads(response.content)), 125)
        with self.assertNumQueries(2):
            response = views.listar_promovidos(factory.get('/api/promovidos/', {'page': 2, 'page_size': 50, 'seccion': 250}))
        data = json.loads(response.content)
        self.assertEqual(data['count'], 101)
        self.assertEqual(data['pages'], 3)
        self.assertEqual(len(data['results']), 50)
        self.assertTrue(all(row['seccion'] == 250 for row in data['results']))
        response = views.listar_promovidos(factory.get('/api/promovidos/', {'page_size': 10000}))
        self.assertEqual(len(json.loads(response.content)['results']), 100)

    def test_atomic_social_write_failure_keeps_previous_data(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'escucha_data.json'
            atomic_json_write(filename, {'version': 1})
            with patch('maps.imports.os.replace', side_effect=OSError('fixture failure')):
                with self.assertRaises(OSError):
                    atomic_json_write(filename, {'version': 2})
            self.assertEqual(json.loads(filename.read_text()), {'version': 1})
            self.assertEqual([path.name for path in Path(directory).iterdir()], ['escucha_data.json'])
