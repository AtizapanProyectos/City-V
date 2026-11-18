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
    
    # Estos dos los calculará tu script de importación automáticamente
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