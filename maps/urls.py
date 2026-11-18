from django.urls import path
from . import views

urlpatterns = [
    path('', views.tablero_mapa, name='mapa_principal'),
]