import os
import django
import pandas as pd
from decimal import Decimal

# Configurar el entorno de Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'city_manager.settings')
django.setup()

from elections.models import VotacionAyuntamiento, VotacionDiputacion

def procesar_archivo(ruta_archivo, modelo):
    try:
        print(f"Procesando {ruta_archivo}...")
        
        # CAMBIO 1: header=0 indica que los títulos están en la fila 1 del Excel
        df = pd.read_excel(ruta_archivo, header=0)
        
        # Filtramos solo las filas correspondientes a Atizapán
        # Asumiendo que el ID de municipio o nombre sirve de filtro, 
        # si solo tiene Atizapán, podemos omitir el filtro, pero por seguridad lo dejamos
        if 'MUNICIPIO' in df.columns:
            df = df[df['MUNICIPIO'].str.contains('ATIZAPAN', na=False, case=False)]

        for index, row in df.iterrows():
            try:
                # Extraemos y limpiamos los datos
                seccion = int(row['SECCION'])
                
                # Calculamos el partido ganador
                votos_partidos = {
                    'PAN': int(row['PAN']), 'PRI': int(row['PRI']), 'PRD': int(row['PRD']),
                    'PVEM': int(row['PVEM']), 'PT': int(row['PT']), 'MC': int(row['MC']),
                    'MORENA': int(row['MORENA']), 'NAEM': int(row['NAEM'])
                }
                partido_ganador = max(votos_partidos, key=votos_partidos.get)

                # Calculamos el porcentaje de participación
                votos_validos = int(row['NUM_VOTOS_VALIDOS'])
                lista_nominal = int(row['LISTA_NOMINAL'])
                participacion = (votos_validos / lista_nominal * 100) if lista_nominal > 0 else 0

                # Guardamos o actualizamos en la base de datos
                modelo.objects.update_or_create(
                    seccion=seccion,
                    defaults={
                        'casillas': int(row['CASILLAS']),
                        'pan': votos_partidos['PAN'],
                        'pri': votos_partidos['PRI'],
                        'prd': votos_partidos['PRD'],
                        'pvem': votos_partidos['PVEM'],
                        'pt': votos_partidos['PT'],
                        'mc': votos_partidos['MC'],
                        'morena': votos_partidos['MORENA'],
                        'naem': votos_partidos['NAEM'],
                        'num_votos_validos': votos_validos,
                        'lista_nominal': lista_nominal,
                        'partido_ganador': partido_ganador,
                        'participacion': Decimal(participacion).quantize(Decimal('0.00'))
                    }
                )
            except Exception as row_error:
                print(f"Error procesando la sección de la fila {index + 2}: {row_error}")
                
        print(f"Éxito: Datos guardados en {modelo.__name__}\n")
        
    except Exception as e:
        print(f"Error procesando {ruta_archivo}: {e}")

if __name__ == '__main__':
    # CAMBIO 2: Actualizamos los nombres de los archivos para que coincidan con los nuevos
    procesar_archivo('data/ResultadosAyuntamiento.xlsx', VotacionAyuntamiento)
    procesar_archivo('data/ResultadosDiputamiento.xlsx', VotacionDiputacion) # Mantenemos el de diputaciones igual si no ha cambiado