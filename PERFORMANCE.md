# Rendimiento y adaptación móvil de City V

Validación del 18 de noviembre de 2026. Se conservan las fórmulas electorales, autenticación, SQLite persistente, ambas elecciones, proyecciones, filtros, padrón, encuestas y comparativas de escucha.

## Mediciones reproducibles sobre datos sintéticos

Comparación del código anterior y el nuevo en el mismo equipo Windows, Python oficial 3.12.10, dependencias de requirements.txt, base temporal y los mismos archivos XLSX. No son mediciones del servidor Railway.

| Filas | Operación | Antes | Después | SQL antes | SQL después |
| --- | --- | --- | --- | --- | --- |
| 1,000 | Crear | 3.616 s | 0.135 s | 5,000 | 5 |
| 1,000 | Actualizar | 4.291 s | 0.472 s | 3,000 | 5 |
| 10,000 | Crear | 46.645 s | 1.041 s | 50,000 | 41 |
| 10,000 | Actualizar | 43.814 s | 5.011 s | 30,000 | 41 |

SQL se contabilizó con execute_wrapper; no incluye COMMIT ejecutados directamente por el controlador. Las respuestas completas de totales, ganadores y proyecciones coinciden con la implementación anterior para factores 0, 0.6 y 0.95, y después de importar promovidos. El endpoint de totales baja de seis a cuatro consultas. Las geometrías mantienen las 174 secciones y 10,795 vértices originales; se elimina su dibujo duplicado.

## Comportamiento

- Importaciones serializadas en un proceso gthread de cuatro hilos, lotes de 500 y transacciones cortas. Fechas inválidas y coincidencias ambiguas se reportan. Si falla un lote, no se informa éxito; los anteriores pueden seguir confirmados.
- Paginación optativa compatible con el arreglo original. La interfaz usa páginas de 50, filas construidas con nodos de texto y totales del filtro, sin insertar todo el padrón en el DOM.
- Peticiones simultáneas compartidas, caché de lectura del navegador de hasta 30 segundos invalidada por escrituras, cancelación de selecciones anteriores y tiempos máximos de espera.
- Bibliotecas y fuentes locales con licencias. No se necesita Kaspersky, Google Fonts, unpkg ni jsDelivr en tiempo de ejecución. El mapa base sigue usando Esri.
- Pestañas móviles hasta 1024 px; se reutilizan los controles existentes. No se crean mapas o juegos de gráficas adicionales para móvil. Los gráficos ocultos se crean al abrirse y se actualizan sin destruirse repetidamente.

## Verificación

- Django: 25 pruebas de acceso, CSRF, permisos, importación, duplicados, errores de lectura/escritura, rollback de lote, paginación, consultas y escritura atómica.
- Node: 4 pruebas de solicitudes compartidas, invalidación por cambios, cancelación, timeout, errores HTTP y creación/actualización de gráficas.
- Las 3 pruebas de inicialización SQLite existentes.
- Navegador Chromium headless con SQLite de validación: 360, 390, 768, 1024 y 1366 px; orientación 844 × 390 y emulación táctil 2x; sin desbordamiento horizontal ni excepciones JavaScript.
- Captura de promovidos, creación/edición/borrado de encuestas, importación XLSX, importación de un XLS real, tres reportes sociales, vaciado del padrón y reinicio de encuestas, paginación, métricas y navegación durante una carga.
- Respuesta de sección retrasada, fallo del mapa base, error/reintento de API y estabilidad del número de gráficas después de cambios repetidos.

Comandos: python manage.py test maps elections territory; python -m unittest discover -s scripts -p test_prepare_data.py; node --test scripts/test_dashboard.cjs; python manage.py check --deploy; python manage.py collectstatic --noinput.

## Despliegue

La migración 0006 solo crea índices y se ejecuta con migrate en el Procfile. Conservar una réplica y un volumen exclusivo /data. Los respaldos locales están excluidos de Git. SECRET_KEY y el mecanismo de administrador no cambian.

check --deploy mantiene las advertencias ya documentadas sobre HSTS para subdominios y preload. Las pruebas locales no sustituyen la observación de CPU, memoria y latencia en Railway ni una prueba en un dispositivo físico con Safari. Gunicorn no se ejecutó localmente porque el equipo no dispone de un entorno Linux utilizable sin Docker.
