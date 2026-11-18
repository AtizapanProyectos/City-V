from django.db import models

class VotacionAyuntamiento(models.Model):
    seccion = models.IntegerField(unique=True, primary_key=True)
    casillas = models.IntegerField(default=0)
    pan = models.IntegerField(default=0)
    pri = models.IntegerField(default=0)
    prd = models.IntegerField(default=0)
    pvem = models.IntegerField(default=0)
    pt = models.IntegerField(default=0)
    mc = models.IntegerField(default=0)
    morena = models.IntegerField(default=0)
    naem = models.IntegerField(default=0)
    num_votos_validos = models.IntegerField(default=0)
    lista_nominal = models.IntegerField(default=0)
    partido_ganador = models.CharField(max_length=50, blank=True)
    participacion = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    def __str__(self):
        return f"Ayuntamiento - Sección {self.seccion}"

class VotacionDiputacion(models.Model):
    seccion = models.IntegerField(unique=True, primary_key=True)
    casillas = models.IntegerField(default=0)
    pan = models.IntegerField(default=0)
    pri = models.IntegerField(default=0)
    prd = models.IntegerField(default=0)
    pvem = models.IntegerField(default=0)
    pt = models.IntegerField(default=0)
    mc = models.IntegerField(default=0)
    morena = models.IntegerField(default=0)
    naem = models.IntegerField(default=0)
    num_votos_validos = models.IntegerField(default=0)
    lista_nominal = models.IntegerField(default=0)
    partido_ganador = models.CharField(max_length=50, blank=True)
    participacion = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    def __str__(self):
        return f"Diputación - Sección {self.seccion}"

class Promovido(models.Model):
    class Meta:
        indexes = [
            models.Index(fields=['seccion_electoral'], name='promovido_seccion_idx'),
            models.Index(fields=['nombre_completo', 'telefono_movil'], name='promovido_identidad_idx'),
        ]

    # 1. Datos Personales
    nombre_completo = models.CharField(max_length=255)
    telefono_movil = models.CharField(max_length=20, blank=True, null=True)
    correo_electronico = models.EmailField(blank=True, null=True)
    facebook = models.CharField(max_length=255, blank=True, null=True)
    instagram = models.CharField(max_length=255, blank=True, null=True)
    
    # 2. Ubicación y Vinculación
    direccion_completa = models.TextField(blank=True, null=True)
    seccion_electoral = models.IntegerField(blank=True, null=True)
    distrito_zona = models.CharField(max_length=100, blank=True, null=True)
    
    # 3. Confirmación de Compromiso
    confirma_apoyo = models.CharField(max_length=2, default='No')
    medio_contacto = models.CharField(max_length=50, blank=True, null=True)
    
    # 4. Control Interno
    responsable_captura = models.CharField(max_length=255, blank=True, null=True)
    fecha_registro = models.DateField(blank=True, null=True)
    estatus = models.CharField(max_length=50, blank=True, null=True)

    def __str__(self):
        return f"{self.nombre_completo} - {self.seccion_electoral}"

class Encuesta(models.Model):
    casa_encuestadora = models.CharField(max_length=150, default="General")
    pan = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    pri = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    prd = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    pvem = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    pt = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    mc = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    morena = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    naem = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    indecisos = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    fecha_registro = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.casa_encuestadora} - {self.fecha_registro.strftime('%d/%m/%Y')}"