"""Bounded Excel imports and atomic storage for the single-process deployment."""
from collections import defaultdict
from datetime import date, datetime
from functools import wraps
import json
import logging
import os
from pathlib import Path
import tempfile
from threading import Lock
from time import monotonic

from django.db import transaction
from django.http import JsonResponse

from elections.models import Promovido

IMPORT_LOCK = Lock()
logger = logging.getLogger(__name__)
IMPORT_FIELDS = ['seccion_electoral', 'medio_contacto', 'estatus', 'fecha_registro', 'direccion_completa']
REQUIRED_COLUMNS = ['Nombre completo', 'Teléfono móvil', 'Fecha de registro', 'Sección electoral',
                    'Medio de contacto preferido', 'Estatus', 'Dirección completa']


def serialized_import(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not IMPORT_LOCK.acquire(blocking=False):
            return JsonResponse({'error': 'Ya hay una importación en curso. Intenta de nuevo al finalizar.'}, status=409)
        try:
            return view(request, *args, **kwargs)
        finally:
            IMPORT_LOCK.release()
    return wrapped


def atomic_json_write(filename, data):
    filename = Path(filename)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=filename.parent,
                                         prefix='.escucha-', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            json.dump(data, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, filename)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def import_promovidos(excel_file):
    import pandas as pd

    started = monotonic()
    try:
        frame = pd.read_excel(excel_file, sheet_name='Registro', header=2)
    except Exception as error:
        raise ValueError('No se pudo leer el Excel. Verifica el formato y la hoja Registro.') from error
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError('Faltan columnas: ' + ', '.join(missing))
    existing = defaultdict(list)
    for person in Promovido.objects.only('id', 'nombre_completo', 'telefono_movil'):
        existing[(person.nombre_completo, person.telefono_movil)].append(person)
    records = frame.to_dict('records')
    created_ids, updated_ids = set(), set()
    rejected = skipped = 0
    errors = []

    def text(value):
        return str(value).strip() if pd.notna(value) else ''

    for offset in range(0, len(records), 500):
        new = {}
        updates = {}
        for row_number, row in enumerate(records[offset:offset + 500], start=offset + 4):
            if pd.isna(row['Nombre completo']):
                skipped += 1
                continue
            try:
                name, phone = text(row['Nombre completo']), text(row['Teléfono móvil'])
                if not name:
                    raise ValueError('El nombre está vacío.')
                raw_date = row['Fecha de registro']
                registration = None
                if pd.notna(raw_date):
                    if isinstance(raw_date, str):
                        registration = datetime.strptime(raw_date, '%d/%m/%Y').date()
                    elif isinstance(raw_date, datetime):
                        registration = raw_date.date()
                    elif isinstance(raw_date, date):
                        registration = raw_date
                    else:
                        raise ValueError('Fecha no válida; usa día/mes/año.')
                values = {
                    'seccion_electoral': int(row['Sección electoral']) if pd.notna(row['Sección electoral']) else None,
                    'medio_contacto': text(row['Medio de contacto preferido']),
                    'estatus': text(row['Estatus']), 'fecha_registro': registration,
                    'direccion_completa': text(row['Dirección completa']),
                }
                key = name, phone
                matches = existing.get(key, [])
                if len(matches) > 1:
                    raise ValueError('Nombre y teléfono coinciden con varios registros; revisa el duplicado.')
                person = new.get(key) or (matches[0] if matches else None)
                if person is None:
                    person = Promovido(nombre_completo=name, telefono_movil=phone)
                    new[key] = person
                for field, value in values.items():
                    setattr(person, field, value)
                if person.pk is not None:
                    updates[person.pk] = person
            except (ValueError, TypeError, OverflowError):
                rejected += 1
                if len(errors) < 100:
                    errors.append({'fila': row_number, 'error': 'Datos inválidos o coincidencia duplicada; revisa nombre, teléfono, fecha y sección.'})
        # Keep write locks short; SQLite's parameter limits further bound Django batches.
        with transaction.atomic():
            created = Promovido.objects.bulk_create(list(new.values()), batch_size=500)
            Promovido.objects.bulk_update(list(updates.values()), IMPORT_FIELDS, batch_size=500)
        for key, person in new.items():
            existing[key] = [person]
        created_ids.update(person.pk for person in created)
        updated_ids.update(updates)
    elapsed = round(monotonic() - started, 3)
    logger.info('promovidos_import rows=%d created=%d updated=%d rejected=%d elapsed_s=%.3f',
                len(records), len(created_ids), len(updated_ids - created_ids), rejected, elapsed)
    return {
        'status': 'ok', 'creados': len(created_ids), 'actualizados': len(updated_ids - created_ids),
        'rechazados': rejected, 'omitidos': skipped, 'errores': errors,
        'mensaje': f'Nuevos: {len(created_ids)}. Actualizados: {len(updated_ids - created_ids)}. Rechazados: {rejected}. Omitidos: {skipped}.',
    }
