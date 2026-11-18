import os
import django
import pandas as pd
from datetime import datetime

# Configurar el entorno de Django (asegúrate de que apunte a tu settings)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'city_manager.settings')
django.setup()

from elections.models import Promovido

def procesar_promovidos(ruta_archivo):
    try:
        print(f"Procesando {ruta_archivo}...")
        
        # Leemos el Excel saltándonos las 2 primeras filas de adorno (header=2)
        df = pd.read_excel(ruta_archivo, sheet_name='Registro', header=2)
        
        # Limpiar posibles filas completamente vacías al final del archivo
        df = df.dropna(subset=['Nombre completo'])

        creados = 0
        actualizados = 0

        for index, row in df.iterrows():
            try:
                # Manejo de la fecha
                fecha_reg = None
                if pd.notna(row['Fecha de registro']):
                    if isinstance(row['Fecha de registro'], str):
                        fecha_reg = datetime.strptime(row['Fecha de registro'], "%d/%m/%Y").date()
                    else:
                        fecha_reg = row['Fecha de registro'].date()
                
                # update_or_create evita duplicados verificando Nombre y Teléfono
                obj, created = Promovido.objects.update_or_create(
                    nombre_completo=str(row['Nombre completo']).strip(),
                    telefono_movil=str(row['Teléfono móvil']).strip() if pd.notna(row['Teléfono móvil']) else "",
                    defaults={
                        'correo_electronico': str(row['Correo electrónico']).strip() if pd.notna(row['Correo electrónico']) else "",
                        'facebook': str(row['FB (Facebook)']).strip() if pd.notna(row['FB (Facebook)']) else "",
                        'instagram': str(row['IG (Instagram)']).strip() if pd.notna(row['IG (Instagram)']) else "",
                        'direccion_completa': str(row['Dirección completa']).strip() if pd.notna(row['Dirección completa']) else "",
                        'seccion_electoral': int(row['Sección electoral']) if pd.notna(row['Sección electoral']) else None,
                        'distrito_zona': str(row['Distrito / Zona']).strip() if pd.notna(row['Distrito / Zona']) else "",
                        'confirma_apoyo': str(row['¿Confirma su participación/apoyo?']).strip() if pd.notna(row['¿Confirma su participación/apoyo?']) else "No",
                        'medio_contacto': str(row['Medio de contacto preferido']).strip() if pd.notna(row['Medio de contacto preferido']) else "",
                        'responsable_captura': str(row['Responsable de la captura']).strip() if pd.notna(row['Responsable de la captura']) else "",
                        'fecha_registro': fecha_reg,
                        'estatus': str(row['Estatus']).strip() if pd.notna(row['Estatus']) else ""
                    }
                )
                
                if created: creados += 1
                else: actualizados += 1
                    
            except Exception as row_error:
                print(f"Error procesando la fila {index + 4}: {row_error}")
                
        print(f"Éxito: {creados} nuevos promovidos creados y {actualizados} actualizados.\n")
        
    except Exception as e:
        print(f"Error procesando el archivo: {e}")

if __name__ == '__main__':
    # Asegúrate de colocar tu Excel dentro de la carpeta 'data'
    procesar_promovidos('data/PROMOVIDOS.xlsx')