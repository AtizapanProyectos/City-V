# Railway: Python 3.12, Procfile y SQLite persistente

Este proyecto se construye con Railpack y requirements.txt. No utiliza Dockerfile ni comandos Docker. El Procfile inicializa SQLite desde la base incluida en Git si el volumen está vacío, y ejecuta migraciones, collectstatic y Gunicorn; no importa Excel ni reemplaza los datos al reiniciar.

## Configurar el servicio

1. Conectar este repositorio y seleccionar la rama main. La raíz del servicio es la raíz del repositorio (donde está manage.py). Usar Railpack; railway.toml fija ese constructor. No definir un Start Command alternativo: se debe detectar el comando web del Procfile. Dejar vacíos los comandos personalizados de build y pre-deploy.
2. Crear un volumen persistente exclusivo del servicio y montarlo en /data. Usar una sola réplica y un worker, tal como está en el Procfile, para esta instalación SQLite.
3. Configurar Variables antes del primer arranque:
   - DATA_DIR=/data
   - DEBUG=False
   - SECRET_KEY: valor aleatorio secreto de al menos 50 caracteres.
   - El mapa y /admin/ usan los usuarios de Django guardados en SQLite. El administrador inicial está incluido en la base; sus contraseñas se guardan como hash y se entregan al propietario fuera de Git.
4. Generar un dominio público. Railway proporciona RAILWAY_PUBLIC_DOMAIN y Django lo agrega a hosts y orígenes CSRF. Para dominios propios, definir ALLOWED_HOSTS con hosts separados por comas, sin esquema ni puerto, y CSRF_TRUSTED_ORIGINS con orígenes HTTPS separados por comas. No usar *.
5. db.sqlite3 está incluido en el repositorio por solicitud del propietario. En el primer arranque, si /data/db.sqlite3 no existe, se inicializa desde esa base con la API de backup de SQLite. Si ya existe una base en el volumen, se conserva sin reemplazarla. Los siguientes despliegues no sobrescriben los datos de producción. Para transferir JSON y media, o restaurar manualmente una base, seguir la siguiente sección. Después activar el despliegue automático desde main.

.env.example es una plantilla: Django no carga archivos .env automáticamente. Mantener los secretos en Railway Variables o en el entorno de la terminal. Los tres archivos de versión solicitan Python 3.12. SSL se reconoce mediante X-Forwarded-Proto; las cookies de sesión y CSRF requieren HTTPS con DEBUG=False. HSTS dura una hora; no se habilitan preload ni includeSubDomains sin verificar todos los subdominios.

## Respaldo y transferencia manual de datos adicionales

Desde la raíz de este proyecto, con Python 3.12 y la aplicación local detenida para que el JSON y media no cambien durante la copia:

~~~powershell
python scripts/backup_data.py backups/initial
~~~

El script usa la API de backup de SQLite y comprueba su integridad. Copia el JSON actual de maps/escucha_data.json y media/, si existen. Se niega a sobrescribir un directorio de respaldo. Para respaldar un volumen ya existente, usar --data-dir con su ruta.

Con Railway CLI actualizado, ejecutar railway login y railway link, seleccionando el proyecto, entorno y servicio correctos. Para una restauración manual en un volumen nuevo y vacío, cargar cada elemento de backups/initial en la raíz del volumen (la raíz corresponde a /data dentro del servicio):

~~~powershell
railway volume files upload ./backups/initial/db.sqlite3 /db.sqlite3
railway volume files upload ./backups/initial/escucha_data.json /escucha_data.json
railway volume files upload ./backups/initial/media /media
~~~

Omitir JSON o media si no existen en el respaldo. La CLI permite elegir el volumen; verificar que pertenezca a este servicio. También se puede usar el explorador de archivos del volumen. No subir el directorio backups dentro del repositorio ni sustituir una base remota existente sin respaldarla primero.

Si la carga requiere un servicio en ejecución, mantenerlo temporalmente sin tráfico público con Start Command = sleep infinity, cargar los archivos, quitar ese Start Command y desplegar de nuevo para usar el Procfile. No importar Excel para reconstruir una base que ya fue transferida.

Si se usa la inicialización automática, no es necesario cargar db.sqlite3 manualmente. El JSON y media no están versionados y se transfieren aparte si se necesitan. Confirmar que /data contiene db.sqlite3, escucha_data.json y media/ según corresponda. En el primer arranque normal, migrate conserva los registros existentes y aplica únicamente las migraciones pendientes. Mantener el respaldo local fuera de Git.

Documentación oficial de transferencia: https://docs.railway.com/cli/volume

## Validar

En un entorno aislado, definir SECRET_KEY y DATA_DIR apuntando a un directorio de prueba; no usar la base de trabajo para validar migraciones:

~~~text
python -m pip install -r requirements.txt
python -m pip check
python manage.py check
python manage.py check --deploy
python scripts/prepare_data.py
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py test maps.test_deployment
python -m unittest discover -s scripts -p test_prepare_data.py
~~~

check --deploy puede advertir sobre HSTS includeSubDomains/preload, que requieren una decisión sobre todos los dominios antes de activarse. No ignorar otras advertencias sin investigarlas. Los tests usan HTTPS y verifican login, CSRF, hosts, estáticos y el archivo persistente.

Después del despliegue real: abrir login, entrar al mapa, comprobar CSS/JS y GeoJSON, registrar una encuesta y probar las cargas. Reiniciar el servicio y confirmar que encuesta y escucha social siguen presentes. Revisar logs de migrate, collectstatic y Gunicorn. WhiteNoise sirve estáticos; media/ queda persistido para uso de la aplicación y no se expone públicamente de forma automática.

## Desarrollo local

Sin DATA_DIR se conservan db.sqlite3, maps/escucha_data.json y media/ en sus ubicaciones originales. Definir DEBUG=True para iniciar el servidor local e ingresar con un usuario activo de Django. La clave temporal de desarrollo nunca se acepta con DEBUG=False.

## Git

db.sqlite3 está versionado y publicado por autorización explícita del propietario. Se excluyen sus archivos temporales de transacción, JSON mutable, media, entornos, secretos y respaldos del estado publicado. En City E se conserva el historial heredado; retirar archivos del índice no elimina sus versiones de commits antiguos. City_a y City N no forman parte de estos cambios.

## Error SECRET_KEY en Railway

Si los logs muestran ImproperlyConfigured: Set SECRET_KEY before starting in production., agregar SECRET_KEY en Variables del servicio y aplicar el despliegue. Usar una clave aleatoria privada, diferente por servicio, sin comillas; se puede generar con python -c "import secrets; print(secrets.token_urlsafe(64))". No incluir la clave en Git ni activar DEBUG para evitar el error. El mapa utiliza el usuario y contraseña guardados en SQLite. Las variables APP_LOGIN_USER y APP_LOGIN_PASSWORD ya no se utilizan.

Si el volumen ya contiene una base vacía generada en un despliegue anterior, el inicializador la conserva. Para reemplazarla por la versión local, respaldar primero la base remota, detener la aplicación y restaurar manualmente la copia local mediante el explorador del volumen; nunca sobrescribir una base con registros nuevos.

## Administrador guardado en SQLite

El formulario del mapa utiliza authenticate/login/logout de Django y comparte los usuarios con /admin/. El Procfile ejecuta seed_admin después de migrate: si el volumen no tiene ningún superusuario activo, importa el administrador inicial y su hash desde el db.sqlite3 del repositorio. Si ya existe un superusuario activo, conserva sus credenciales. Tampoco reemplaza un usuario existente que tenga el mismo nombre. Las contraseñas de SQLite se almacenan como hash.

Para crear otro administrador, ejecutar python manage.py createsuperuser sobre la base de destino. Para cambiar su contraseña, usar python manage.py changepassword admin en ese servicio. Estas operaciones actúan sobre DATA_DIR/db.sqlite3. Una contraseña modificada en producción no se restablece en futuros despliegues.

## Actualización solicitada de la cuenta admin

La migración configure_admin_access configura una sola vez el usuario admin, correo admin@gmail.com y permisos de usuario activo, staff y superusuario, con la contraseña inicial solicitada por el propietario. Así también corrige los permisos y el acceso en un volumen existente. Las siguientes ejecuciones de migrate no vuelven a restablecer esa contraseña; los cambios posteriores realizados mediante changepassword se conservan.
