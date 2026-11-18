import json
import os
from decimal import Decimal
from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.db import DatabaseError
from django.db.models import Avg, Count
from django.core.paginator import Paginator
from .imports import import_promovidos, serialized_import, atomic_json_write, logger
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.conf import settings
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from elections.models import VotacionAyuntamiento, VotacionDiputacion, Promovido, Encuesta

ESCUCHA_FILE = settings.ESCUCHA_FILE

def safe_float(val):
    try:
        if val is None: return 0.0
        v = str(val).strip().replace(',', '')
        if not v or v.lower() in ['null', 'none', 'nan']: return 0.0
        return float(v)
    except Exception:
        return 0.0

def safe_decimal(val):
    try:
        if val is None: return Decimal('0.0')
        v = str(val).strip().replace(',', '')
        if not v or v.lower() in ['null', 'none', 'nan']: return Decimal('0.0')
        return Decimal(v)
    except Exception:
        return Decimal('0.0')

def safe_percentage(val):
    d = safe_decimal(val)
    if d < 0: return Decimal('0.0')
    if d > 100: return Decimal('100.0')
    return d

def login_view(request):
    if request.user.is_authenticated:
        return redirect('mapa')
    error = None
    if request.method == 'POST':
        usuario = request.POST.get('usuario', '').strip()
        password = request.POST.get('password', '')
        user = authenticate(request, username=usuario, password=password)
        if user is not None:
            auth_login(request, user)
            return redirect('mapa')
        error = 'Credenciales incorrectas. Verifica tu usuario y contraseña.'
    return render(request, 'maps/login.html', {'error': error})


def logout_view(request):
    auth_logout(request)
    return redirect('login')


@ensure_csrf_cookie
def mapa_view(request):
    if not request.user.is_authenticated:
        return redirect('login')
    return render(request, 'maps/mapa.html')


def calcular_proyeccion_generica(LN, Vt, historicos, eg_dinamico, Ss=0.6, promovidos_count=0, casillas=0):
    if LN == 0 or Vt == 0: 
        return None
    
    FACTOR_PROYECCION = 0.90 # Reducción conservadora del 10%
    participacion_historica = Vt / LN
    V_esperados = int(LN * participacion_historica)
    Pp = (promovidos_count / LN) if LN > 0 else 0  
    
    W1, W2, W3 = 0.50, 0.30, 0.20
    partidos = ['pan', 'pri', 'prd', 'pvem', 'pt', 'mc', 'morena', 'naem'] 
    fuerza_bruta = {}
    
    for partido in partidos:
        Vp = safe_float(historicos.get(partido, 0))
        term1 = W1 * (Vp / Vt) 
        if partido == 'pan':
            term2 = W2 * ((Pp * LN) / V_esperados) if V_esperados > 0 else 0
            Eg_actual = safe_float(eg_dinamico.get(partido, 0))
            if Eg_actual == 0: Eg_actual = 0.35
            term3 = W3 * (Eg_actual * Ss)                  
        else:
            term2 = 0
            Eg_actual = safe_float(eg_dinamico.get(partido, 0))
            if Eg_actual > 0:
                term3 = W3 * (Eg_actual * 1.0)
            else:
                term3 = W3 * (Vp / Vt) * 1.0 
        fuerza_bruta[partido] = term1 + term2 + term3
    
    total_fuerza = sum(fuerza_bruta.values())
    proyecciones = {}
    V_esperados_reducidos = int(V_esperados * FACTOR_PROYECCION)
    
    for partido in partidos:
        porcentaje_real = fuerza_bruta[partido] / total_fuerza if total_fuerza > 0 else 0
        proyecciones[partido] = int(V_esperados_reducidos * porcentaje_real)
        
    if proyecciones:
        proyecciones['ganador'] = max(proyecciones, key=proyecciones.get).upper()
        meta_bruta = (V_esperados / 2) + 1
        proyecciones['meta_ganar'] = int(meta_bruta * FACTOR_PROYECCION)
        proyecciones['num_votos_validos'] = V_esperados_reducidos
        proyecciones['participacion'] = round((V_esperados_reducidos / LN * 100), 2) if LN > 0 else 0
        proyecciones['lista_nominal'] = LN
        proyecciones['casillas'] = casillas
    else:
        proyecciones['ganador'] = 'N/A'
        proyecciones['meta_ganar'] = 0
        proyecciones['num_votos_validos'] = 0
        proyecciones['participacion'] = 0
        proyecciones['lista_nominal'] = LN
        proyecciones['casillas'] = casillas
    return proyecciones

def obtener_datos_seccion(request, num_seccion):
    try:
        factor_escucha = safe_float(request.GET.get('factor_escucha', 0.6))
        ayuntamiento = VotacionAyuntamiento.objects.filter(seccion=num_seccion).first()
        diputacion = VotacionDiputacion.objects.filter(seccion=num_seccion).first()
        promovidos_count = Promovido.objects.filter(seccion_electoral=num_seccion).count()
        
        promedios = Encuesta.objects.aggregate(
            Avg('pan'), Avg('pri'), Avg('prd'), Avg('pvem'), Avg('pt'), Avg('mc'), Avg('morena'), Avg('naem')
        )
        eg_dinamico = { p: (safe_float(promedios.get(f'{p}__avg')) / 100) for p in ['pan', 'pri', 'prd', 'pvem', 'pt', 'mc', 'morena', 'naem'] }

        def serializar_modelo(obj):
            if not obj: return None
            ln = safe_float(obj.lista_nominal)
            vv = safe_float(obj.num_votos_validos)
            historicos = { p: getattr(obj, p, 0) for p in ['pan', 'pri', 'prd', 'pvem', 'pt', 'mc', 'morena', 'naem'] }
            ganador_real = str(obj.partido_ganador).strip().upper() if obj.partido_ganador else ''
            if not ganador_real or ganador_real == 'N/A':
                ganador_real = max(historicos, key=historicos.get).upper() if sum(historicos.values()) > 0 else 'N/A'

            datos = {
                'casillas': obj.casillas, 'lista_nominal': obj.lista_nominal,
                'num_votos_validos': obj.num_votos_validos, 'participacion': safe_float(obj.participacion),
                'pan': obj.pan, 'pri': obj.pri, 'prd': obj.prd, 'pvem': obj.pvem, 'pt': obj.pt,
                'mc': obj.mc, 'morena': obj.morena, 'naem': obj.naem, 'ganador': ganador_real
            }
            datos['proyeccion'] = calcular_proyeccion_generica(
                ln, vv, historicos, eg_dinamico, Ss=factor_escucha, promovidos_count=promovidos_count, casillas=obj.casillas
            )
            return datos

        return JsonResponse({
            'seccion': num_seccion,
            'ayuntamiento': serializar_modelo(ayuntamiento),
            'diputacion': serializar_modelo(diputacion)
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

def obtener_datos_totales(request):
    try:
        factor_escucha = safe_float(request.GET.get('factor_escucha', 0.6))
        promovidos_por_seccion = {
            item['seccion_electoral']: item['total'] 
            for item in Promovido.objects.values('seccion_electoral').annotate(total=Count('id')) 
            if item['seccion_electoral']
        }
        promovidos_count_total = sum(promovidos_por_seccion.values())
        
        promedios = Encuesta.objects.aggregate(
            Avg('pan'), Avg('pri'), Avg('prd'), Avg('pvem'), Avg('pt'), Avg('mc'), Avg('morena'), Avg('naem')
        )
        eg_dinamico = { p: (safe_float(promedios.get(f'{p}__avg')) / 100) for p in ['pan', 'pri', 'prd', 'pvem', 'pt', 'mc', 'morena', 'naem'] }

        registros_por_modelo = {
            VotacionAyuntamiento: list(VotacionAyuntamiento.objects.all()),
            VotacionDiputacion: list(VotacionDiputacion.objects.all()),
        }

        def get_totales(modelo):
            columnas = ['casillas', 'lista_nominal', 'num_votos_validos', 'pan', 'pri', 'prd', 'pvem', 'pt', 'mc', 'morena', 'naem']
            totales = {col: sum(getattr(row, col) or 0 for row in registros_por_modelo[modelo]) for col in columnas}
            for k, v in totales.items():
                if v is None: totales[k] = 0
            
            lista_nom = safe_float(totales['lista_nominal'])
            votos_val = safe_float(totales['num_votos_validos'])
            participacion = (votos_val / lista_nom * 100) if lista_nom > 0 else 0
            votos_partidos = { 'pan': totales['pan'], 'pri': totales['pri'], 'prd': totales['prd'], 'pvem': totales['pvem'], 'pt': totales['pt'], 'mc': totales['mc'], 'morena': totales['morena'], 'naem': totales['naem'] }
            ganador = max(votos_partidos, key=votos_partidos.get).upper() if sum(votos_partidos.values()) > 0 else 'N/A'

            datos = {
                'casillas': totales['casillas'], 'lista_nominal': totales['lista_nominal'],
                'num_votos_validos': totales['num_votos_validos'], 'participacion': round(participacion, 2),
                'ganador': ganador, 'pan': totales['pan'], 'pri': totales['pri'], 'prd': totales['prd'],
                'pvem': totales['pvem'], 'pt': totales['pt'], 'mc': totales['mc'], 'morena': totales['morena'], 'naem': totales['naem']
            }
            datos['proyeccion'] = calcular_proyeccion_generica(
                totales['lista_nominal'], totales['num_votos_validos'], votos_partidos, eg_dinamico, 
                Ss=factor_escucha, promovidos_count=promovidos_count_total, casillas=totales['casillas']
            )
            return datos

        def construir_mapas_secciones(modelo):
            registros = registros_por_modelo[modelo]
            hist_map = {}
            proy_map = {}
            partidos_list = ['pan', 'pri', 'prd', 'pvem', 'pt', 'mc', 'morena', 'naem']
            for s in registros:
                sec_str = str(s.seccion)
                historicos = { p: safe_float(getattr(s, p, 0)) for p in partidos_list }
                suma_partidos = sum(historicos.values())
                votos_validos = safe_float(s.num_votos_validos) if s.num_votos_validos else suma_partidos
                ganador_hist = str(s.partido_ganador).strip().upper() if s.partido_ganador else ''
                if not ganador_hist or ganador_hist == 'N/A' or ganador_hist.lower() not in historicos:
                    ganador_hist = max(historicos, key=historicos.get).upper() if suma_partidos > 0 else 'N/A'
                pct_hist = (historicos[ganador_hist.lower()] / votos_validos) * 100 if (ganador_hist != 'N/A' and ganador_hist.lower() in historicos and votos_validos > 0) else 0
                hist_map[sec_str] = { 'partido': ganador_hist, 'porcentaje': round(pct_hist, 2) }
                
                proy = calcular_proyeccion_generica(
                    safe_float(s.lista_nominal), votos_validos, historicos, eg_dinamico, 
                    Ss=factor_escucha, promovidos_count=promovidos_por_seccion.get(s.seccion, 0), casillas=s.casillas
                )
                if proy and proy.get('ganador') and proy['ganador'] != 'N/A':
                    ganador_proy = proy['ganador']
                    total_proy = sum([proy.get(p, 0) for p in partidos_list])
                    pct_proy = (proy.get(ganador_proy.lower(), 0) / total_proy * 100) if total_proy > 0 else 0
                    proy_map[sec_str] = { 'partido': ganador_proy, 'porcentaje': round(pct_proy, 2) }
                else:
                    proy_map[sec_str] = {'partido': 'N/A', 'porcentaje': 0}
            return hist_map, proy_map

        hist_ayto, proy_ayto = construir_mapas_secciones(VotacionAyuntamiento)
        hist_dip, proy_dip = construir_mapas_secciones(VotacionDiputacion)

        return JsonResponse({
            'ayuntamiento': get_totales(VotacionAyuntamiento), 
            'diputacion': get_totales(VotacionDiputacion),
            'ganadores_historicos': { 'ayuntamiento': hist_ayto, 'diputacion': hist_dip },
            'ganadores_proyectados': { 'ayuntamiento': proy_ayto, 'diputacion': proy_dip }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@serialized_import
def procesar_escucha_social(request):
    import pandas as pd
    if request.method == 'POST':
        archivos = request.FILES.getlist('files')
        # EXIGENCIA EXACTA DE 3 ARCHIVOS
        if len(archivos) != 3:
            return JsonResponse({'error': 'Debe adjuntar exactamente 3 reportes Excel para la comparativa.'}, status=400)
        
        resultados = []
        factor_calculado = 0.6 
        for f in archivos:
            try:
                df = pd.read_excel(f, sheet_name='Datos analíticos', nrows=10)
                nombre_candidato = str(f.name).replace('.xlsx', '').replace('.xls', '').upper()
                
                def get_valor(nombre):
                    val = df.loc[df['Métrica'].str.strip() == nombre, 'Valor'].values
                    return float(val[0]) if len(val) > 0 and pd.notna(val[0]) else 0.0

                total_menciones = get_valor('Menciones')
                total_redes = get_valor('Menciones en las redes sociales')
                positivos = get_valor('Número de positivos')
                
                if total_menciones == 0: total_menciones = 1.0
                if total_redes == 0: total_redes = 1.0 
                factor_sentimiento = positivos / total_redes
                
                metricas_limpias = {}
                for _, row in df.iterrows():
                    nombre_metrica = str(row['Métrica']).strip()
                    if nombre_metrica.lower() != 'número de acciones':
                        metricas_limpias[nombre_metrica] = safe_float(row['Valor'])
                    
                resultados.append({
                    'candidato': nombre_candidato,
                    'factor_sentimiento': factor_sentimiento,
                    'metricas': metricas_limpias,
                    'total_menciones': total_menciones 
                })
            except Exception as e:
                return JsonResponse({'error': f'Error al procesar archivo {f.name}: {str(e)}'}, status=400)
        
        if len(resultados) > 0:
            factor_calculado = resultados[0]['factor_sentimiento']
            
        datos_guardar = {'data': resultados, 'factor_global': factor_calculado}
        try:
            atomic_json_write(ESCUCHA_FILE, datos_guardar)
        except OSError:
            return JsonResponse({'error': 'No se pudo guardar la escucha social en el almacenamiento persistente.'}, status=500)
        return JsonResponse({'status': 'ok', 'data': resultados, 'factor_global': factor_calculado})
    return JsonResponse({'error': 'Método no permitido'}, status=400)

def obtener_escucha_social(request):
    if os.path.exists(ESCUCHA_FILE):
        try:
            with open(ESCUCHA_FILE, 'r', encoding='utf-8') as f:
                datos = json.load(f)
                return JsonResponse({'status': 'ok', 'data': datos['data'], 'factor_global': datos['factor_global']})
        except: pass
    return JsonResponse({'status': 'empty'})

def listar_promovidos(request):
    seccion = request.GET.get('seccion')
    if seccion: promovidos = Promovido.objects.filter(seccion_electoral=seccion).order_by('-id')
    else: promovidos = Promovido.objects.all().order_by('-id')
    page = None
    if 'page' in request.GET or 'page_size' in request.GET:
        try:
            size = max(1, min(100, int(request.GET.get('page_size', 50))))
        except (TypeError, ValueError):
            return JsonResponse({'error': 'Tamaño de página no válido.'}, status=400)
        page = Paginator(promovidos, size).get_page(request.GET.get('page', 1))
        promovidos = page.object_list
    data = [{
        'nombre': p.nombre_completo, 'telefono': p.telefono_movil, 'direccion': p.direccion_completa,
        'seccion': p.seccion_electoral, 'medio': p.medio_contacto,
        'fecha': p.fecha_registro.strftime('%d/%m/%Y') if p.fecha_registro else '-', 'estatus': p.estatus
    } for p in promovidos]
    if page is not None:
        return JsonResponse({'results': data, 'count': page.paginator.count, 'page': page.number,
                             'pages': page.paginator.num_pages, 'page_size': page.paginator.per_page})
    return JsonResponse(data, safe=False)

@serialized_import
def cargar_promovidos(request):
    if request.method != 'POST' or not request.FILES.get('file'):
        return JsonResponse({'error': 'No se envió ningún archivo'}, status=400)
    try:
        return JsonResponse(import_promovidos(request.FILES['file']))
    except (ValueError, KeyError, ImportError, OSError, EOFError) as error:
        return JsonResponse({'error': str(error)}, status=400)
    except DatabaseError:
        logger.exception('promovidos_import database failure')
        return JsonResponse({'error': 'La importación no se completó. Revisa el padrón antes de reintentar: los lotes anteriores pueden haberse guardado.'}, status=503)


def guardar_promovido(request):
    if request.method != 'POST': return JsonResponse({'status': 'error', 'msg': 'Método no permitido'}, status=405)
    try:
        nombre = str(request.POST.get('nombre_completo', '')).strip()
        telefono = str(request.POST.get('telefono_movil', '')).strip()
        correo = str(request.POST.get('correo_electronico', '')).strip()
        red_social = str(request.POST.get('red_social', '')).strip()
        direccion = str(request.POST.get('direccion_completa', '')).strip()
        seccion_raw = request.POST.get('seccion_electoral', '')
        distrito = str(request.POST.get('distrito_zona', '')).strip()
        confirma = str(request.POST.get('confirma_apoyo', 'Sí')).strip()
        medio = str(request.POST.get('medio_contacto', 'Trabajo de Campo')).strip()
        responsable = str(request.POST.get('responsable_captura', '')).strip()
        estatus = str(request.POST.get('estatus', '')).strip()

        if not nombre: return JsonResponse({'status': 'error', 'msg': 'El nombre completo es obligatorio.'}, status=400)
        seccion_val = int(seccion_raw) if (seccion_raw and str(seccion_raw).strip().isdigit()) else None

        if not estatus:
            if confirma == 'Sí': estatus = 'Confirmado'
            elif confirma == 'No': estatus = 'Inalcanzable'
            else: estatus = 'Por visitar'

        nuevo = Promovido.objects.create(
            nombre_completo=nombre, telefono_movil=telefono, correo_electronico=correo if correo else None,
            facebook=red_social if red_social else None, direccion_completa=direccion, seccion_electoral=seccion_val,
            distrito_zona=distrito, confirma_apoyo=confirma[:2] if confirma else 'Sí', medio_contacto=medio,
            responsable_captura=responsable, fecha_registro=timezone.now().date(), estatus=estatus
        )
        return JsonResponse({'status': 'ok', 'id': nuevo.id})
    except Exception as e: return JsonResponse({'status': 'error', 'msg': str(e)}, status=500)

def reiniciar_promovidos(request):
    if request.method != 'POST': return JsonResponse({'status': 'error', 'msg': 'Método no permitido'}, status=405)
    try:
        total_eliminados, _ = Promovido.objects.all().delete()
        return JsonResponse({'status': 'ok', 'eliminados': total_eliminados})
    except Exception as e: return JsonResponse({'status': 'error', 'msg': str(e)}, status=500)

def guardar_encuesta(request):
    if request.method != 'POST': return JsonResponse({'status': 'error', 'msg': 'Método no permitido'})
    try:
        enc_id = request.POST.get('id')
        casa = str(request.POST.get('casa_encuestadora', '')).strip()[:150] or 'General'
        defaults = {
            'casa_encuestadora': casa,
            'pan': safe_percentage(request.POST.get('pan')), 'pri': safe_percentage(request.POST.get('pri')),
            'prd': safe_percentage(request.POST.get('prd')), 'pvem': safe_percentage(request.POST.get('pvem')),
            'pt': safe_percentage(request.POST.get('pt')), 'mc': safe_percentage(request.POST.get('mc')),
            'morena': safe_percentage(request.POST.get('morena')), 'naem': safe_percentage(request.POST.get('naem')),
            'indecisos': safe_percentage(request.POST.get('indecisos')),
        }
        if enc_id and str(enc_id).strip() != '':
            Encuesta.objects.filter(id=enc_id).update(**defaults)
        else:
            defaults['fecha_registro'] = timezone.now()
            Encuesta.objects.create(**defaults)
        return JsonResponse({'status': 'ok'})
    except Exception as e: return JsonResponse({'status': 'error', 'msg': str(e)})

def eliminar_encuesta(request):
    if request.method != 'POST': return JsonResponse({'status': 'error', 'msg': 'Método no permitido'})
    try:
        Encuesta.objects.filter(id=request.POST.get('id')).delete()
        return JsonResponse({'status': 'ok'})
    except Exception as e: return JsonResponse({'status': 'error', 'msg': str(e)})

def reiniciar_encuestas(request):
    if request.method != 'POST': return JsonResponse({'status': 'error', 'msg': 'Método no permitido'}, status=405)
    try:
        total, _ = Encuesta.objects.all().delete()
        return JsonResponse({'status': 'ok', 'eliminadas': total})
    except Exception as e: return JsonResponse({'status': 'error', 'msg': str(e)}, status=500)

def obtener_promedio_encuestas(request):
    try:
        promedios = Encuesta.objects.aggregate(
            Avg('pan'), Avg('pri'), Avg('prd'), Avg('pvem'), Avg('pt'), Avg('mc'), Avg('morena'), Avg('naem'), Avg('indecisos')
        )
        if promedios['pan__avg'] is None:
            return JsonResponse({'pan': 0, 'pri': 0, 'prd': 0, 'pvem': 0, 'pt': 0, 'mc': 0, 'morena': 0, 'naem': 0, 'indecisos': 0})
        return JsonResponse({
            'pan': safe_float(promedios['pan__avg']), 'pri': safe_float(promedios['pri__avg']), 'prd': safe_float(promedios['prd__avg']), 'pvem': safe_float(promedios['pvem__avg']),
            'pt': safe_float(promedios['pt__avg']), 'mc': safe_float(promedios['mc__avg']), 'morena': safe_float(promedios['morena__avg']), 'naem': safe_float(promedios['naem__avg']),
            'indecisos': safe_float(promedios['indecisos__avg'])
        })
    except Exception: return JsonResponse({'error': 'Error interno'}, status=500)

def historial_encuestas(request):
    try:
        encuestas = Encuesta.objects.all().order_by('-id')
        data = [{
            'id': e.id, 'fecha': e.fecha_registro.strftime('%d/%m/%Y') if e.fecha_registro else '-', 'casa': e.casa_encuestadora,
            'pan': safe_float(e.pan), 'pri': safe_float(e.pri), 'prd': safe_float(e.prd), 'pvem': safe_float(e.pvem), 
            'pt': safe_float(e.pt), 'mc': safe_float(e.mc), 'morena': safe_float(e.morena), 'naem': safe_float(e.naem), 'indecisos': safe_float(e.indecisos)
        } for e in encuestas]
        return JsonResponse(data, safe=False)
    except Exception as e: return JsonResponse([], safe=False)
