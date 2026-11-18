// Django CSRF protection for same-origin mutations.
function csrfFetch(url, options = {}) {
    const tokenCookie = document.cookie.split('; ').find(cookie => cookie.startsWith('csrftoken='));
    const headers = new Headers(options.headers || {});
    if (tokenCookie) headers.set('X-CSRFToken', decodeURIComponent(tokenCookie.slice('csrftoken='.length)));
    return dashboardFetch(url, { ...options, headers, mode: 'same-origin', credentials: 'same-origin' });
}

const colorBorde = "#1b5e20";
const colorFondo = "#38a838";
const colorHover = "#2e8b2e"; 
const coloresPartidos = { 
    'PAN': '#1b538a', 'PRI': '#14532d', 'PRD': '#deb818', 'PVEM': '#38a838', 
    'PT': '#b8252d', 'MC': '#d16424', 'MORENA': '#96292d', 'NAEM': '#1c9695' 
};
const colorOro = '#d9ab16';

let map;
let seccionRequestVersion = 0;
let promovidosRequestVersion = 0;
let promovidosPagina = 1;
let capasSecciones = {}, capaGlobalAtizapan = null, capaResaltadaActual = null; 
let chartInstancia = null; 
let chartGlobalInstancia = null; 
let chartEncuestas = null;
let chartEscuchaC1 = null, chartEscuchaC2 = null, chartEscuchaC3 = null, chartEscuchaComp = null;
let datosGlobales = null; 
let totalesGlobales = null; 
let pestanaActual = 'ayuntamiento'; 
let pestanaGlobalActual = 'ayuntamiento';
let modoProyeccion = false; 
let modoProyeccionGlobal = false;
let seccionActivaFiltro = null; 
let ganadoresHistoricosMap = {};
let ganadoresProyectadosMap = {};
let historialEncuestasCache = [];

let factorSentimientoGlobal = 0.6; 
let datosEscuchaProcesados = [];

let isGeoJsonLoaded = false;
let isTotalesLoaded = false;
let filtroIntensidadActivo = null;

function limpiarNombre(nombreRaw) {
    if (!nombreRaw) return '';
    return nombreRaw.split('_REPORT')[0].replace(/_/g, ' ');
}

function dibujarPill(ctx, xCentro, yCentro, texto, colorTexto, colorFondoPill) {
    ctx.save();
    ctx.font = "700 10px Montserrat, sans-serif";
    const anchoTexto = ctx.measureText(texto).width;
    const paddingX = 8, alto = 17, r = 8;
    const ancho = anchoTexto + paddingX * 2;
    const x0 = xCentro - ancho / 2, y0 = yCentro - alto / 2;
    
    ctx.beginPath();
    if (ctx.roundRect) { 
        ctx.roundRect(x0, y0, ancho, alto, r); 
    } else { 
        ctx.moveTo(x0 + r, y0); 
        ctx.arcTo(x0 + ancho, y0, x0 + ancho, y0 + alto, r); 
        ctx.arcTo(x0 + ancho, y0 + alto, x0, y0 + alto, r); 
        ctx.arcTo(x0, y0 + alto, x0, y0, r); 
        ctx.arcTo(x0, y0, x0 + ancho, y0, r); 
        ctx.closePath(); 
    }
    ctx.fillStyle = colorFondoPill; 
    ctx.fill(); 
    ctx.strokeStyle = colorTexto; 
    ctx.lineWidth = 1; 
    ctx.stroke();
    
    ctx.fillStyle = colorTexto; 
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle'; 
    ctx.fillText(texto, xCentro, yCentro + 0.5);
    ctx.restore();
}

const pluginLineaMeta = {
    id: 'lineaMeta',
    afterDatasetsDraw(chart) {
        const cfg = chart.config.options.plugins.lineaMeta;
        if (!cfg || !cfg.display || typeof cfg.value !== 'number') return;
        const { ctx, chartArea, scales } = chart;
        const isVertical = chart.config.options.indexAxis === 'x';
        
        ctx.save(); 
        ctx.setLineDash([5, 4]); 
        ctx.strokeStyle = cfg.color || colorOro; 
        ctx.lineWidth = 2;
        ctx.beginPath(); 

        let xPill, yPill;
        const texto = cfg.label || 'Meta';
        ctx.font = "700 10.5px Montserrat, sans-serif";
        const medida = ctx.measureText(texto).width + 16;

        if (isVertical) {
            const yAxis = scales.y;
            if (!yAxis) { ctx.restore(); return; }
            const yPixel = yAxis.getPixelForValue(cfg.value);
            ctx.moveTo(chartArea.left, yPixel); 
            ctx.lineTo(chartArea.right, yPixel);
            xPill = chartArea.right - medida / 2 - 4;
            yPill = yPixel - 12;
        } else {
            const xAxis = scales.x;
            if (!xAxis) { ctx.restore(); return; }
            const xPixel = xAxis.getPixelForValue(cfg.value);
            ctx.moveTo(xPixel, chartArea.top); 
            ctx.lineTo(xPixel, chartArea.bottom);
            xPill = Math.min(Math.max(xPixel, chartArea.left + medida / 2), chartArea.right - medida / 2);
            yPill = chartArea.top - 14;
        }
        
        ctx.stroke(); 
        dibujarPill(ctx, xPill, yPill, texto, cfg.color || colorOro, 'rgba(217,171,22,0.16)');
        ctx.restore();
    }
};
Chart.register(pluginLineaMeta);

const pluginValoresBarra = {
    id: 'valoresBarra',
    afterDatasetsDraw(chart) {
        const cfg = chart.config.options.plugins.valoresBarra;
        if (!cfg || !cfg.display) return;
        const { ctx } = chart;
        const isVertical = chart.config.options.indexAxis === 'x';
        
        chart.data.datasets.forEach((dataset, di) => {
            const meta = chart.getDatasetMeta(di);
            meta.data.forEach((bar, i) => {
                const valor = dataset.data[i];
                if (valor === undefined || valor === null || valor === 0) return;
                
                ctx.save();
                ctx.font = "700 10.5px Montserrat, sans-serif";
                ctx.fillStyle = cfg.color || '#1e293b';
                
                if (isVertical) {
                    ctx.textAlign = 'center'; 
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(Number(valor).toLocaleString(), bar.x, bar.y - 6);
                } else {
                    ctx.textAlign = 'left'; 
                    ctx.textBaseline = 'middle';
                    ctx.fillText(Number(valor).toLocaleString(), bar.x + 8, bar.y);
                }
                ctx.restore();
            });
        });
    }
};
Chart.register(pluginValoresBarra);

const pluginTextoCentral = {
    id: 'textoCentral',
    afterDraw(chart) {
        const cfg = chart.config.options.plugins.textoCentral;
        if (!cfg || !cfg.display) return;
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const x = (left + right) / 2;
        const y = (top + bottom) / 2;
        
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        if (cfg.value) {
            ctx.font = "800 " + (cfg.tamValor || 20) + "px Montserrat, sans-serif";
            ctx.fillStyle = cfg.color || '#1e293b';
            ctx.fillText(cfg.value, x, y - (cfg.label ? 9 : 0));
        }
        if (cfg.label) {
            ctx.font = "700 9.5px Montserrat, sans-serif";
            ctx.fillStyle = cfg.labelColor || '#64748b';
            ctx.fillText(cfg.label, x, y + 11);
        }
        ctx.restore();
    }
};
Chart.register(pluginTextoCentral);

function tooltipInstitucional(sufijo = 'votos') {
    return {
        backgroundColor: '#1b5e20', 
        titleColor: '#ffffff', 
        titleFont: { weight: '700', size: 12 }, 
        bodyColor: '#eaf6ea', 
        bodyFont: { weight: '600', size: 11.5 }, 
        padding: 10, 
        cornerRadius: 8, 
        displayColors: false,
        callbacks: {
            label: function (ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);
                const val = Number(ctx.raw) || 0; 
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                return `${val.toLocaleString()} ${sufijo} (${pct}%)`;
            }
        }
    };
}

function ordenarPorVotos(partidos, votos) {
    const combinado = partidos.map((p, i) => ({ partido: p, valor: votos[i] || 0 }));
    combinado.sort((a, b) => b.valor - a.valor);
    return { 
        partidosOrd: combinado.map(c => c.partido), 
        votosOrd: combinado.map(c => c.valor) 
    };
}

const contadorFrames = new WeakMap();
function animarContador(el, valorFinal, opciones = {}) {
    if (!el) return;
    cancelAnimationFrame(contadorFrames.get(el));
    const destino = Number(valorFinal) || 0, sufijo = opciones.sufijo || '';
    const inicial = Number(el.dataset.valorActual || 0);
    const finish = () => { el.textContent = destino.toLocaleString() + sufijo; el.dataset.valorActual = destino; contadorFrames.delete(el); };
    if (mobileDashboard.isMobile() || matchMedia('(prefers-reduced-motion: reduce)').matches || inicial === destino) { finish(); return; }
    const started = performance.now();
    function step(now) {
        const progress = Math.min(1, (now - started) / 250);
        const value = inicial + (destino - inicial) * (1 - Math.pow(1 - progress, 3));
        el.dataset.valorActual = value;
        el.textContent = Math.round(value).toLocaleString() + sufijo;
        if (progress < 1) contadorFrames.set(el, requestAnimationFrame(step));
        else finish();
    }
    contadorFrames.set(el, requestAnimationFrame(step));
}

function destellar(el) {
    if (!el) return;
    el.classList.remove('destello'); 
    void el.offsetWidth; 
    el.classList.add('destello');
}

function obtenerOpacidad(pct) {
    if (pct < 25) return 0.35;
    if (pct < 50) return 0.55;
    if (pct < 75) return 0.75;
    return 0.95;
}

function inicializarFiltrosLeyenda() {
    const items = document.querySelectorAll('.leyenda-item');
    const btnLimpiar = document.getElementById('btn-limpiar-filtro-mapa');

    items.forEach(item => {
        item.addEventListener('click', function() {
            const opacidadClic = parseFloat(this.getAttribute('data-opacidad'));
            
            if (filtroIntensidadActivo === opacidadClic) {
                filtroIntensidadActivo = null;
                items.forEach(i => i.classList.remove('filtro-activo'));
                if(btnLimpiar) btnLimpiar.style.display = 'none';
            } else {
                filtroIntensidadActivo = opacidadClic;
                items.forEach(i => i.classList.remove('filtro-activo'));
                this.classList.add('filtro-activo');
                if(btnLimpiar) btnLimpiar.style.display = 'block';
            }
            colorearMapaGlobal(); 
        });
    });

    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', function(e) {
            e.stopPropagation();
            filtroIntensidadActivo = null;
            items.forEach(i => i.classList.remove('filtro-activo'));
            this.style.display = 'none';
            colorearMapaGlobal();
        });
    }
}

function obtenerMapaGanadoresActivo() {
    const enModoLocal = document.getElementById('mapa-wrapper').classList.contains('modo-cuadrante');
    const tipoEleccion = enModoLocal ? pestanaActual : pestanaGlobalActual;
    const usarProyeccion = enModoLocal ? modoProyeccion : modoProyeccionGlobal;
    const fuente = usarProyeccion ? ganadoresProyectadosMap : ganadoresHistoricosMap;
    
    if (!fuente) return {};
    if (fuente[tipoEleccion]) return fuente[tipoEleccion];
    return fuente;
}

let mapaRepaintPending = false;
function colorearMapaGlobal() {
    if (mapaRepaintPending) return;
    mapaRepaintPending = true;
    requestAnimationFrame(() => { mapaRepaintPending = false; colorearMapaGlobalAhora(); });
}
function colorearMapaGlobalAhora() {
    if (!capaGlobalAtizapan || !isGeoJsonLoaded || !isTotalesLoaded) return;
    
    const mapaActivo = obtenerMapaGanadoresActivo();
    
    capaGlobalAtizapan.eachLayer(function (layer) {
        let sec = String(layer.seccionID);
        let dataObj = mapaActivo[sec];
        
        let ganador = dataObj ? dataObj.partido : null;
        let porcentaje = dataObj ? dataObj.porcentaje : 0;

        if (ganador && coloresPartidos[ganador] && ganador !== 'N/A') {
            let baseColor = coloresPartidos[ganador];
            let opacidad = obtenerOpacidad(porcentaje);
            
            layer.options.originalFillColor = baseColor;
            layer.options.originalFillOpacity = opacidad;

            if (filtroIntensidadActivo !== null && opacidad !== filtroIntensidadActivo) {
                if (capaResaltadaActual !== layer) {
                    applyLayerStyle(layer, { fillColor: '#e2e8f0', fillOpacity: 0.28, weight: 1.2, color: '#64748b' });
                }
            } else {
                if (capaResaltadaActual !== layer) {
                    applyLayerStyle(layer, { fillColor: baseColor, fillOpacity: opacidad, weight: 1.5, color: '#1b5e20' });
                }
            }
        } else {
            layer.options.originalFillColor = colorFondo;
            layer.options.originalFillOpacity = 0.45;

            if (filtroIntensidadActivo !== null) {
                if (capaResaltadaActual !== layer) {
                    applyLayerStyle(layer, { fillColor: '#e2e8f0', fillOpacity: 0.28, weight: 1.2, color: '#64748b' });
                }
            } else {
                if (capaResaltadaActual !== layer) {
                    applyLayerStyle(layer, { fillColor: colorFondo, fillOpacity: 0.45, weight: 1.5, color: '#1b5e20' });
                }
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    inicializarMapa(); 
    cargarTablaPromovidos(); 
    configurarEventosGlobales();
    inicializarFiltrosLeyenda(); 
    
    dashboardFetch('/api/escucha-social/')
        .then(r => r.json())
        .then(res => {
            if(res.status === 'ok' && res.data && res.data.length === 3) {
                datosEscuchaProcesados = res.data;
                factorSentimientoGlobal = res.factor_global;
                
                document.getElementById('escucha-vacio').style.display = 'none';
                document.getElementById('escucha-contenido').style.display = 'flex';
                renderizarTabsEscucha();
            }
        })
        .catch(e => console.log("Sin datos previos de escucha social"))
        .finally(() => {
            cargarDatosTotales();
        });
    
    const btnProy = document.getElementById('btn-toggle-proyeccion');
    if (btnProy) {
        btnProy.addEventListener('click', function() {
            modoProyeccion = !modoProyeccion;
            this.innerText = modoProyeccion ? "Ver resultados reales" : "Ver proyección";
            this.style.background = modoProyeccion ? "#b8252d" : "linear-gradient(135deg, #38a838, #1b5e20)";
            renderizarPestana();
            colorearMapaGlobal();
        });
    }

    const btnProyGlobal = document.getElementById('btn-toggle-proyeccion-global');
    if (btnProyGlobal) {
        btnProyGlobal.addEventListener('click', function() {
            modoProyeccionGlobal = !modoProyeccionGlobal;
            this.innerText = modoProyeccionGlobal ? "Ver resultados reales" : "Ver proyección";
            this.style.background = modoProyeccionGlobal ? "#b8252d" : "linear-gradient(135deg, #38a838, #1b5e20)";
            renderizarPestanaGlobal();
            colorearMapaGlobal(); 
        });
    }
});

function mostrarToast(mensaje = "Proceso completado exitosamente") {
    const toast = document.getElementById('toast-notificacion');
    toast.innerText = mensaje; 
    toast.style.display = 'block';
    
    setTimeout(() => { 
        toast.style.transform = 'translateY(0)'; 
    }, 10);
    
    setTimeout(() => { 
        toast.style.transform = 'translateY(100px)'; 
        setTimeout(() => { toast.style.display = 'none'; }, 400); 
    }, 4000);
}

function dispararRecalculoProyeccion() {
    document.getElementById('loading-overlay').style.display = 'flex';
    const selectedSection = seccionActivaFiltro;
    const version = seccionRequestVersion;
    return Promise.all([
        dashboardFetch(`/api/totales/?factor_escucha=${factorSentimientoGlobal}`).then(r => r.json()),
        seccionActivaFiltro ? dashboardFetch(`/api/seccion/${seccionActivaFiltro}/?factor_escucha=${factorSentimientoGlobal}`).then(r => r.json()) : Promise.resolve(null)
    ]).then(([totalesData, seccionData]) => {
        if(totalesData) {
            totalesGlobales = totalesData;
            isTotalesLoaded = true;
            ganadoresHistoricosMap = totalesData.ganadores_historicos || {};
            ganadoresProyectadosMap = totalesData.ganadores_proyectados || {};
            renderizarPestanaGlobal();
            colorearMapaGlobal();
        }
        if (seccionData && version === seccionRequestVersion && selectedSection === seccionActivaFiltro) {
            datosGlobales = seccionData; 
            renderizarPestana(); 
        }
        
        mostrarToast("Proyecciones actualizadas");
    }).catch(err => {
        dashboardReadError(err, dispararRecalculoProyeccion);
    }).finally(() => { document.getElementById('loading-overlay').style.display = 'none'; });
}

function crearGradienteInstitucionalVertical(ctx) {
    const gradiente = ctx.createLinearGradient(0, 250, 0, 0);
    gradiente.addColorStop(0, '#1b5e20'); 
    gradiente.addColorStop(0.5, '#38a838'); 
    gradiente.addColorStop(1, '#66bb6a');    
    return gradiente;
}

function crearGradienteInstitucionalHorizontal(ctx) {
    const gradiente = ctx.createLinearGradient(0, 0, 300, 0);
    gradiente.addColorStop(0, '#1b5e20'); 
    gradiente.addColorStop(0.5, '#38a838'); 
    gradiente.addColorStop(1, '#66bb6a');    
    return gradiente;
}

function inicializarMapa() {
    map = L.map('mapa-atizapan', { zoomControl: true, preferCanvas: true, trackResize: false, maxBoundsViscosity: 1.0 }).setView([19.5548, -99.2443], 13);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles &copy; Esri' }).addTo(map);

    map.createPane('paneSecciones'); 
    map.getPane('paneSecciones').style.zIndex = 410;
    
    var rendererSecciones = L.canvas({ pane: 'paneSecciones' });

    document.getElementById('btn-buscar').disabled = true;
    function cargarGeografia() {
    return dashboardFetch('/static/data/secciones_atizapan.geojson')
        .then(res => res.json())
        .then(data => {
            capaGlobalAtizapan = L.geoJSON(data, {
                renderer: rendererSecciones, 
                style: { color: '#1b5e20', weight: 1.5, fillColor: colorFondo, fillOpacity: 0.45 },
                onEachFeature: function (feature, layer) {
                    var numSeccion = feature.properties.SECCION || feature.properties.seccion || feature.properties.Seccion; 
                    
                    if (numSeccion) { 
                        layer.seccionID = numSeccion; 
                        capasSecciones[numSeccion] = layer; 
                        layer.bindTooltip("Sec: " + numSeccion.toString(), { 
                            permanent: false, direction: 'auto', className: 'label-seccion', interactive: false, opacity: 0.9 
                        });
                    }
                    
                    layer.on('mouseover', function () { 
                        if (capaResaltadaActual !== layer) {
                            applyLayerStyle(this, { fillColor: colorHover, fillOpacity: 0.75, weight: 2.5, color: '#1b5e20' });
                        }
                    });
                    
                    layer.on('mouseout', function () { 
                        if (capaResaltadaActual !== layer) {
                            let baseColor = this.options.originalFillColor || colorFondo;
                            let opacity = this.options.originalFillOpacity || (baseColor === colorFondo ? 0.45 : 0.55);
                            
                            if (filtroIntensidadActivo !== null && opacity !== filtroIntensidadActivo) {
                                applyLayerStyle(this, { fillColor: '#e2e8f0', fillOpacity: 0.28, weight: 1.2, color: '#64748b' });
                            } else {
                                applyLayerStyle(this, { fillColor: baseColor, fillOpacity: opacity, weight: 1.5, color: '#1b5e20' });
                            }
                        }
                    });
                    
                    layer.on('click', function () { abrirDashboardElectoral(numSeccion, layer); });
                }
            }).addTo(map);
            
            var limites = capaGlobalAtizapan.getBounds(); 
            setDashboardMunicipalBounds(limites);
            moveDashboardMap(limites, { padding: [12, 12] });
            
            isGeoJsonLoaded = true;
            document.getElementById('btn-buscar').disabled = false;
            colorearMapaGlobal(); 
        }).catch(error => dashboardReadError(error, cargarGeografia));
    }
    cargarGeografia();

    document.getElementById('btn-buscar').addEventListener('click', () => { 
        const s = document.getElementById('input-buscador').value.trim(); 
        if (capasSecciones[s]) abrirDashboardElectoral(s, capasSecciones[s]);
        else dashboardNotice("No se encontró esa sección en el municipio.");
    });
    
    document.getElementById('input-buscador').addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') document.getElementById('btn-buscar').click(); 
    });
    
    document.getElementById('btn-restaurar-mapa').addEventListener('click', function() {
        seccionActivaFiltro = null;
        seccionRequestVersion += 1;
        promovidosPagina = 1;
        promovidosRequestVersion += 1;
        dashboardControllers.get('promovidos')?.abort();
        dashboardControllers.get('section')?.abort();
        document.body.removeAttribute('data-has-section');
        document.getElementById('label-seccion-promovidos').innerText = "Global"; 
        document.getElementById('modal-label-seccion').innerText = "(Todas)";
        cargarTablaPromovidos(); 
        
        document.getElementById('mapa-wrapper').classList.remove('modo-cuadrante'); 
        document.getElementById('dashboard-layout').classList.remove('modo-cuadrante');
        document.getElementById('panel-totales-municipio').classList.remove('oculto'); 
        this.style.display = 'none';
        
        if (capaResaltadaActual && capaGlobalAtizapan) { 
            capaResaltadaActual.unbindTooltip();
            capaResaltadaActual.bindTooltip("Sec: " + capaResaltadaActual.seccionID, { 
                permanent: false, direction: 'auto', className: 'label-seccion', interactive: false, opacity: 0.9 
            });
            
            let baseColor = capaResaltadaActual.options.originalFillColor || colorFondo;
            let opacity = capaResaltadaActual.options.originalFillOpacity || (baseColor === colorFondo ? 0.45 : 0.55);
            
            if (filtroIntensidadActivo !== null && opacity !== filtroIntensidadActivo) {
                 applyLayerStyle(capaResaltadaActual, { fillColor: '#ffffff', fillOpacity: 0.2, weight: 1, color: '#cbd5e1' });
            } else {
                 applyLayerStyle(capaResaltadaActual, { fillColor: baseColor, fillOpacity: opacity, weight: 1, color: '#1b5e20' });
            }
            capaResaltadaActual = null; 
        }
        
        const btnProy = document.getElementById('btn-toggle-proyeccion');
        if(btnProy) btnProy.style.display = 'none';
        
        colorearMapaGlobal();
        
        if (capaGlobalAtizapan) moveDashboardMap(capaGlobalAtizapan.getBounds(), { padding: [12, 12] });
    });
}

function abrirDashboardElectoral(seccion, capa) {
    const requestVersion = ++seccionRequestVersion;
    promovidosPagina = 1;
    promovidosRequestVersion += 1;
    dashboardControllers.get('promovidos')?.abort();
    seccionActivaFiltro = seccion;
    document.body.dataset.hasSection = 'true';
    mobileDashboard.select('resultados');
    if (capaResaltadaActual && capaGlobalAtizapan) {
        capaResaltadaActual.unbindTooltip();
        capaResaltadaActual.bindTooltip("Sec: " + capaResaltadaActual.seccionID, { 
            permanent: false, direction: 'auto', className: 'label-seccion', interactive: false, opacity: 0.9 
        });
        
        let baseColor = capaResaltadaActual.options.originalFillColor || colorFondo;
        let opacity = capaResaltadaActual.options.originalFillOpacity || (baseColor === colorFondo ? 0.45 : 0.55);
        
        if (filtroIntensidadActivo !== null && opacity !== filtroIntensidadActivo) {
             applyLayerStyle(capaResaltadaActual, { fillColor: '#ffffff', fillOpacity: 0.2, weight: 1, color: '#cbd5e1' });
        } else {
             applyLayerStyle(capaResaltadaActual, { fillColor: baseColor, fillOpacity: opacity, weight: 1, color: '#1b5e20' });
        }
    }
    
    applyLayerStyle(capa, { fillColor: colorHover, fillOpacity: 0.9, color: '#144517', weight: 3 });
    capa.unbindTooltip(); 
    capa.bindTooltip("Sec: " + seccion, { permanent: true, direction: 'center', className: 'label-seccion', interactive: false }).openTooltip();
    capaResaltadaActual = capa;

    document.getElementById('panel-totales-municipio').classList.add('oculto'); 
    document.getElementById('mapa-wrapper').classList.add('modo-cuadrante');
    document.getElementById('dashboard-layout').classList.add('modo-cuadrante');
    document.getElementById('btn-restaurar-mapa').style.display = 'block'; 
    document.getElementById('ui-seccion-id').innerText = seccion;

    moveDashboardMap(capa.getBounds(), { maxZoom: 16, padding: [10, 10] });

    dashboardFetch(`/api/seccion/${seccion}/?factor_escucha=${factorSentimientoGlobal}`, { requestKey: 'section' })
        .then(res => res.json())
        .then(data => { 
            if (requestVersion !== seccionRequestVersion) return;
            datosGlobales = data; 
            modoProyeccion = false; 
            
            const btnProy = document.getElementById('btn-toggle-proyeccion');
            if(btnProy) { 
                btnProy.innerText = "Ver proyección"; 
                btnProy.style.background = "linear-gradient(135deg, #38a838, #1b5e20)"; 
            }
            
            seccionActivaFiltro = seccion;
            document.getElementById('label-seccion-promovidos').innerText = `(Sección ${seccion})`;
            document.getElementById('modal-label-seccion').innerText = `(Sección ${seccion})`;
            
            cargarTablaPromovidos(); 
            cambiarPestana('ayuntamiento'); 
            
            if (datosEscuchaProcesados && datosEscuchaProcesados.length === 3) {
                setTimeout(() => {
                    if (chartEscuchaC1) chartEscuchaC1.resize();
                    if (chartEscuchaC2) chartEscuchaC2.resize();
                    if (chartEscuchaC3) chartEscuchaC3.resize();
                }, 150);
            }
        })
        .catch(err => {
            if (requestVersion !== seccionRequestVersion || err.name === "AbortError") return;
            dashboardReadError(err, () => abrirDashboardElectoral(seccion, capa));
            datosGlobales = { error: true };
            cambiarPestana('ayuntamiento');
        });
}

window.cambiarPestana = function(tipo) {
    pestanaActual = tipo;
    document.getElementById('tab-ayuntamiento').className = 'tab-btn' + (tipo === 'ayuntamiento' ? ' activo-gradiente' : '');
    document.getElementById('tab-diputacion').className = 'tab-btn' + (tipo === 'diputacion' ? ' activo' : '');
    renderizarPestana();
    colorearMapaGlobal();
};

function renderizarPestana() {
    if (!datosGlobales) return; 
    
    const btnProy = document.getElementById('btn-toggle-proyeccion');
    const contenedorMeta = document.getElementById('stat-meta-container');
    const metaValor = document.getElementById('stat-meta');

    if (datosGlobales.error || !datosGlobales[pestanaActual]) {
        if (btnProy) btnProy.style.display = 'none';
        if (contenedorMeta) contenedorMeta.style.display = 'none';
        
        document.getElementById('stat-casillas').innerText = "0";
        document.getElementById('stat-nominal').innerText = "0";
        document.getElementById('stat-votos').innerText = "0";
        document.getElementById('stat-participacion').innerText = "0%";
        
        const barraLocal = document.getElementById('barra-participacion-local');
        if (barraLocal) barraLocal.style.width = '0%';
        
        const elGanador = document.getElementById('stat-ganador');
        if (elGanador) elGanador.innerHTML = `<span style="color: #64748b;">Sin datos en la base de datos</span>`;
        
        discardDashboardChart('grafica-principal'); chartInstancia = null;
        return;
    }

    const datos = datosGlobales[pestanaActual]; 
    
    if (!datos.proyeccion || datos.num_votos_validos === 0) {
        if (btnProy) btnProy.style.display = 'none';
        contenedorMeta.style.display = 'none';
        
        if (modoProyeccion) { 
            modoProyeccion = false; 
            if(btnProy) { 
                btnProy.innerText = "Ver proyección"; 
                btnProy.style.background = "linear-gradient(135deg, #38a838, #1b5e20)"; 
            } 
        }
    } else { 
        if (btnProy) btnProy.style.display = 'inline-block'; 
        
        if (modoProyeccion && datos.proyeccion.meta_ganar > 0) {
            contenedorMeta.style.display = 'block';
            metaValor.innerText = datos.proyeccion.meta_ganar.toLocaleString();
        } else { 
            contenedorMeta.style.display = 'none'; 
        }
    }

    const fuenteDatos = modoProyeccion ? datos.proyeccion : datos;
    if (!fuenteDatos) return;

    const contenedor = document.getElementById('local-dynamic-content');
    contenedor.classList.remove('fade-efecto'); 
    void contenedor.offsetWidth; 
    contenedor.classList.add('fade-efecto');

    animarContador(document.getElementById('stat-casillas'), fuenteDatos.casillas);
    animarContador(document.getElementById('stat-nominal'), fuenteDatos.lista_nominal);
    animarContador(document.getElementById('stat-votos'), fuenteDatos.num_votos_validos);
    animarContador(document.getElementById('stat-participacion'), parseFloat(fuenteDatos.participacion) || 0, { sufijo: '%' });

    const barraLocal = document.getElementById('barra-participacion-local');
    if (barraLocal) barraLocal.style.width = Math.min(parseFloat(fuenteDatos.participacion) || 0, 100) + '%';
    
    const elGanador = document.getElementById('stat-ganador');
    const prefijo = modoProyeccion ? "Proyectado: " : "Ganador: ";
    if (fuenteDatos.ganador === 'PVEM') { 
        elGanador.innerHTML = `<span class="texto-gradiente">🏆 ${prefijo}PVEM</span>`; 
    } else { 
        elGanador.innerHTML = `<span style="color: #1e293b;">🏆 ${prefijo}${fuenteDatos.ganador}</span>`; 
    }
    destellar(elGanador);

    
    const ctx = document.getElementById('grafica-principal').getContext('2d');
    const partidosBase = ['PAN', 'PRI', 'PRD', 'PVEM', 'PT', 'MC', 'MORENA', 'NAEM'];
    const votosBase = [fuenteDatos.pan, fuenteDatos.pri, fuenteDatos.prd, fuenteDatos.pvem, fuenteDatos.pt, fuenteDatos.mc, fuenteDatos.morena, fuenteDatos.naem];
    const { partidosOrd, votosOrd } = ordenarPorVotos(partidosBase, votosBase);
    
    const gradienteInstitucional = crearGradienteInstitucionalVertical(ctx);
    const bgColor = partidosOrd.map(p => p === 'PVEM' ? gradienteInstitucional : (coloresPartidos[p] || '#888888'));
    
    const bordeColor = partidosOrd.map(p => p === fuenteDatos.ganador ? colorOro : 'transparent');
    const bordeAncho = partidosOrd.map(p => p === fuenteDatos.ganador ? 3 : 0);

    const hayMeta = modoProyeccion && !!(datos.proyeccion && datos.proyeccion.meta_ganar > 0);
    const metaValorAbsoluto = hayMeta ? datos.proyeccion.meta_ganar : 0;
    
    const maxVoto = votosOrd.length > 0 ? Math.max(...votosOrd.map(Number)) : 0;
    const maxEscalaY = Math.max(maxVoto, metaValorAbsoluto) * 1.22;

    chartInstancia = renderDashboardChart(ctx, {
        type: 'bar', 
        data: { 
            labels: partidosOrd, 
            datasets: [{ 
                data: votosOrd, 
                backgroundColor: bgColor, 
                borderColor: bordeColor, 
                borderWidth: bordeAncho, 
                borderRadius: 6, 
                borderSkipped: false, 
                barPercentage: 0.62, 
                categoryPercentage: 0.82, 
                minBarLength: 6 
            }] 
        }, 
        options: { 
            indexAxis: 'x',
            responsive: true, 
            maintainAspectRatio: false, 
            layout: { padding: { top: hayMeta ? 32 : 20, bottom: 2 } }, 
            plugins: { 
                legend: { display: false }, 
                tooltip: tooltipInstitucional(),
                valoresBarra: { display: true, color: '#1e293b' },
                lineaMeta: { display: hayMeta, value: metaValorAbsoluto, label: 'Meta 50%+1', color: colorOro } 
            }, 
            scales: { 
                y: { display: false, grid: { display: false }, beginAtZero: true, suggestedMax: maxEscalaY }, 
                x: { display: true, ticks: { color: '#1e293b', font: {size: 10.5, weight: '700'}, autoSkip: false }, grid: { display: false } } 
            }, 
            animation: { duration: 800, easing: 'easeOutQuart' } 
        } 
    });

    setTimeout(() => { if (chartInstancia) chartInstancia.resize(); }, 80);
}

function cargarDatosTotales() { 
    dashboardFetch(`/api/totales/?factor_escucha=${factorSentimientoGlobal}`)
        .then(res => res.json())
        .then(data => { 
            if(data && !data.error) { 
                totalesGlobales = data; 
                
                if(data.ganadores_historicos) { 
                    ganadoresHistoricosMap = data.ganadores_historicos; 
                    ganadoresProyectadosMap = data.ganadores_proyectados || {}; 
                    isTotalesLoaded = true; 
                    colorearMapaGlobal(); 
                } 
                cambiarPestanaGlobal('ayuntamiento'); 
            }
        }).catch(error => dashboardReadError(error, cargarDatosTotales));
}

window.cambiarPestanaGlobal = function(tipo) {
    pestanaGlobalActual = tipo;
    document.getElementById('tab-global-ayuntamiento').className = 'tab-btn-mini' + (tipo === 'ayuntamiento' ? ' activo' : '');
    document.getElementById('tab-global-diputacion').className = 'tab-btn-mini' + (tipo === 'diputacion' ? ' activo' : '');
    renderizarPestanaGlobal();
    colorearMapaGlobal();
};

function renderizarPestanaGlobal() {
    if (!totalesGlobales) return; 
    
    const datos = totalesGlobales[pestanaGlobalActual]; 
    if (!datos) return;
    
    const btnProyG = document.getElementById('btn-toggle-proyeccion-global');
    const contenedorMetaG = document.getElementById('g-stat-meta-container');
    const metaValorG = document.getElementById('g-stat-meta');

    if (!datos.proyeccion || datos.num_votos_validos === 0) {
        if (btnProyG) btnProyG.style.display = 'none';
        contenedorMetaG.style.display = 'none';
        
        if (modoProyeccionGlobal) { 
            modoProyeccionGlobal = false; 
            if(btnProyG) { 
                btnProyG.innerText = "Ver proyección"; 
                btnProyG.style.background = "linear-gradient(135deg, #38a838, #1b5e20)"; 
            } 
        }
    } else { 
        if (btnProyG) btnProyG.style.display = 'inline-block'; 
        
        if (modoProyeccionGlobal && datos.proyeccion.meta_ganar > 0) {
            contenedorMetaG.style.display = 'block';
            metaValorG.innerText = datos.proyeccion.meta_ganar.toLocaleString();
        } else { 
            contenedorMetaG.style.display = 'none'; 
        }
    }

    const fuenteDatos = modoProyeccionGlobal ? datos.proyeccion : datos;
    if (!fuenteDatos) return;

    const contenedorGlobal = document.getElementById('global-dynamic-content');
    contenedorGlobal.classList.remove('fade-efecto'); 
    void contenedorGlobal.offsetWidth; 
    contenedorGlobal.classList.add('fade-efecto');

    animarContador(document.getElementById('g-stat-casillas'), fuenteDatos.casillas);
    animarContador(document.getElementById('g-stat-nominal'), fuenteDatos.lista_nominal);
    animarContador(document.getElementById('g-stat-votos'), fuenteDatos.num_votos_validos);
    animarContador(document.getElementById('g-stat-participacion'), parseFloat(fuenteDatos.participacion) || 0, { sufijo: '%' });

    const barraGlobal = document.getElementById('barra-participacion-global');
    if (barraGlobal) barraGlobal.style.width = Math.min(parseFloat(fuenteDatos.participacion) || 0, 100) + '%';
    
    const elGanadorGlobal = document.getElementById('g-stat-ganador');
    const prefijoG = modoProyeccionGlobal ? "Proyectado: " : "Ganador: ";
    
    if (fuenteDatos.ganador === 'PVEM') { 
        elGanadorGlobal.innerHTML = `<span class="texto-gradiente">🏆 ${prefijoG}PVEM</span>`; 
    } else { 
        elGanadorGlobal.innerHTML = `<span style="color: #1e293b;">🏆 ${prefijoG}${fuenteDatos.ganador}</span>`; 
    }
    destellar(elGanadorGlobal);

    
    const ctxGlobal = document.getElementById('grafica-global').getContext('2d');
    const partidosBase = ['PAN', 'PRI', 'PRD', 'PVEM', 'PT', 'MC', 'MORENA', 'NAEM'];
    const votosBase = [fuenteDatos.pan, fuenteDatos.pri, fuenteDatos.prd, fuenteDatos.pvem, fuenteDatos.pt, fuenteDatos.mc, fuenteDatos.morena, fuenteDatos.naem];
    const { partidosOrd, votosOrd } = ordenarPorVotos(partidosBase, votosBase);
    
    const gradienteInstitucional = crearGradienteInstitucionalHorizontal(ctxGlobal);
    
    const bordeColorG = partidosOrd.map(p => p === fuenteDatos.ganador ? colorOro : 'transparent');
    const bordeAnchoG = partidosOrd.map(p => p === fuenteDatos.ganador ? 3 : 0);
    const hayMetaG = modoProyeccionGlobal && !!(datos.proyeccion && datos.proyeccion.meta_ganar > 0);
    const metaValorAbsolutoG = hayMetaG ? datos.proyeccion.meta_ganar : 0;
    
    const maxVotoG = votosOrd.length > 0 ? Math.max(...votosOrd.map(Number)) : 0;
    const maxEscalaX = Math.max(maxVotoG, metaValorAbsolutoG) * 1.18;

    chartGlobalInstancia = renderDashboardChart(ctxGlobal, {
        type: 'bar', 
        data: { 
            labels: partidosOrd, 
            datasets: [{ 
                data: votosOrd, 
                backgroundColor: partidosOrd.map(p => p === 'PVEM' ? gradienteInstitucional : coloresPartidos[p]), 
                borderColor: bordeColorG, 
                borderWidth: bordeAnchoG, 
                borderRadius: 6, 
                borderSkipped: false, 
                barPercentage: 0.72, 
                categoryPercentage: 0.82, 
                minBarLength: 6 
            }] 
        }, 
        options: { 
            indexAxis: 'y',
            responsive: true, 
            maintainAspectRatio: false, 
            layout: { padding: { right: 58, top: 26, bottom: 4 } }, 
            plugins: { 
                legend: { display: false }, 
                tooltip: tooltipInstitucional(),
                valoresBarra: { display: true, color: '#1e293b' },
                lineaMeta: { display: hayMetaG, value: metaValorAbsolutoG, label: 'Meta 50%+1', color: colorOro }
            }, 
            scales: { 
                x: { display: false, grid: { display: false }, beginAtZero: true, suggestedMax: maxEscalaX }, 
                y: { display: true, ticks: { color: '#1e293b', font: {size: 10.5, weight: '800'} }, grid: { display: false } }
            }, 
            animation: { duration: 800, easing: 'easeOutQuart' } 
        } 
    });

    requestAnimationFrame(() => { if (chartGlobalInstancia) chartGlobalInstancia.resize(); });
}

function cargarTablaPromovidos(page = 1, force = false) {
    const modalVisible = document.getElementById('modal-promovidos').classList.contains('active');
    const visible = mobileDashboard.isMobile()
        ? !document.getElementById('mobile-promovidos').hidden
        : document.getElementById('dashboard-layout').classList.contains('modo-cuadrante');
    if (!force && !visible && !modalVisible) return Promise.resolve();
    promovidosPagina = page;
    const selectedSection = seccionActivaFiltro;
    const version = ++promovidosRequestVersion;
    document.getElementById('contador-promovidos-mini').textContent = '…';
    for (const id of ['tabla-promovidos-body', 'modal-tabla-body']) {
        const row = document.createElement('tr'), cell = document.createElement('td');
        cell.colSpan = id === 'modal-tabla-body' ? 7 : 3; cell.textContent = 'Cargando registros…';
        row.appendChild(cell); document.getElementById(id).replaceChildren(row);
    }
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (selectedSection) params.set('seccion', selectedSection);
    return dashboardFetch('/api/promovidos/?' + params, { requestKey: 'promovidos' }).then(res => res.json()).then(data => {
        if (version !== promovidosRequestVersion || selectedSection !== seccionActivaFiltro) return;
        const lista = data.results || [];
        promovidosPagina = data.page;
        document.getElementById('contador-promovidos-mini').textContent = data.count;
        for (const [id, full] of [['tabla-promovidos-body', false], ['modal-tabla-body', true]]) {
            const tbody = document.getElementById(id);
            const fragment = document.createDocumentFragment();
            if (!lista.length) {
                const row = document.createElement('tr'), cell = document.createElement('td');
                cell.colSpan = full ? 7 : 3; cell.textContent = 'Sin promovidos en esta vista. Captura uno o carga un archivo Excel.';
                row.appendChild(cell); fragment.appendChild(row);
            }
            for (const person of lista) {
                const row = document.createElement('tr');
                const values = full ? [person.nombre, person.telefono, person.direccion, person.seccion, person.medio, person.fecha, person.estatus] : [person.nombre, person.seccion, person.estatus];
                values.forEach(value => { const cell = document.createElement('td'); cell.textContent = value || '-'; row.appendChild(cell); });
                fragment.appendChild(row);
            }
            tbody.replaceChildren(fragment);
        }
        document.querySelectorAll('.promovidos-pager').forEach(pager => {
            pager.replaceChildren();
            const previous = document.createElement('button'), next = document.createElement('button'), label = document.createElement('span');
            previous.type = next.type = 'button'; previous.textContent = 'Anterior'; next.textContent = 'Siguiente';
            previous.disabled = data.page <= 1; next.disabled = data.page >= data.pages;
            previous.onclick = () => cargarTablaPromovidos(data.page - 1, true);
            next.onclick = () => cargarTablaPromovidos(data.page + 1, true);
            label.textContent = 'Página ' + data.page + ' de ' + data.pages + ' · ' + data.count + ' registros';
            pager.append(previous, label, next);
        });
    }).catch(error => dashboardReadError(error, () => cargarTablaPromovidos(page, true)));
}

window.cambiarVistaMiniPromovidos = function(vista) {
    document.querySelector('#cuadrante-inferior-izquierdo .promovidos-pager').hidden = vista === 'excel';
    const btnLista = document.getElementById('tab-prom-mini-lista'); 
    const btnExcel = document.getElementById('tab-prom-mini-excel'); 
    const divLista = document.getElementById('vista-promovidos-lista'); 
    const divExcel = document.getElementById('vista-promovidos-excel');
    
    if (vista === 'excel') { 
        if (btnLista) btnLista.classList.remove('activo'); 
        if (btnExcel) btnExcel.classList.add('activo'); 
        if (divLista) divLista.style.display = 'none'; 
        if (divExcel) divExcel.style.display = 'flex';
    } else { 
        if (btnExcel) btnExcel.classList.remove('activo'); 
        if (btnLista) btnLista.classList.add('activo'); 
        if (divExcel) divExcel.style.display = 'none'; 
        if (divLista) divLista.style.display = 'block'; 
    }
};

window.cambiarTabModalPromovidos = function(tab) {
    document.querySelector('#modal-promovidos .promovidos-pager').hidden = tab !== 'lista';
    const tabs = ['lista', 'capturar', 'excel'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-modal-prom-${t}`); 
        const vista = document.getElementById(`vista-modal-prom-${t}`);
        if (btn && vista) { 
            if (t === tab) { 
                btn.className = 'tab-btn activo'; 
                vista.style.display = 'block'; 
            } else { 
                btn.className = 'tab-btn'; 
                vista.style.display = 'none'; 
            } 
        }
    });
    
    if (tab === 'capturar' && seccionActivaFiltro) { 
        const inputSec = document.getElementById('prom-seccion'); 
        if (inputSec && !inputSec.value) inputSec.value = seccionActivaFiltro; 
    }
};

window.abrirModalPromovidosTab = function(tab) { 
    const modal = document.getElementById('modal-promovidos'); 
    if (modal) modal.classList.add('active');
    cargarTablaPromovidos(promovidosPagina, true);
    cambiarTabModalPromovidos(tab || 'lista'); 
};

window.guardarNuevoPromovido = function(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btn-submit-promovido'); 
    if (btn) btn.disabled = true; 
    document.getElementById('loading-overlay').style.display = 'flex';
    
    const formData = new FormData();
    formData.append('nombre_completo', document.getElementById('prom-nombre').value); 
    formData.append('telefono_movil', document.getElementById('prom-telefono').value); 
    formData.append('seccion_electoral', document.getElementById('prom-seccion').value); 
    formData.append('correo_electronico', document.getElementById('prom-correo').value); 
    formData.append('red_social', document.getElementById('prom-red').value); 
    formData.append('distrito_zona', document.getElementById('prom-distrito').value); 
    formData.append('confirma_apoyo', document.getElementById('prom-confirma').value); 
    formData.append('medio_contacto', document.getElementById('prom-medio').value); 
    formData.append('responsable_captura', document.getElementById('prom-responsable').value); 
    formData.append('direccion_completa', document.getElementById('prom-direccion').value);
    
    csrfFetch('/api/guardar-promovido/', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (data.status === 'ok') { 
                document.getElementById('form-nuevo-promovido').reset(); 
                cargarTablaPromovidos(); 
                cambiarTabModalPromovidos('lista'); 
                dispararRecalculoProyeccion(); 
                mostrarToast("Promovido registrado exitosamente"); 
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert('Error al guardar: ' + (data.msg || 'Verifica los datos')); 
            }
        })
        .catch(err => { 
            if (btn) btn.disabled = false; 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
            alert('Error de conexión al guardar promovido.'); 
        });
};

window.reiniciarPromovidos = function() {
    if (!confirm('¿Deseas vaciar todos los promovidos registrados y dejar el padrón en 0?')) return;
    document.getElementById('loading-overlay').style.display = 'flex';
    
    csrfFetch('/api/reiniciar-promovidos/', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (data.status === 'ok') { 
                cargarTablaPromovidos(); 
                dispararRecalculoProyeccion(); 
                mostrarToast("Padrón de promovidos vaciado a 0"); 
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert('No se pudo vaciar el padrón.'); 
            }
        })
        .catch(err => { 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
        });
};

function configurarEventosGlobales() {
    const modal = document.getElementById('modal-promovidos');
    document.getElementById('btn-vista-completa').addEventListener('click', () => { modal.classList.add('active'); cargarTablaPromovidos(promovidosPagina, true); });
    document.getElementById('close-modal').addEventListener('click', () => modal.classList.remove('active'));
    
    const inputGlobalProm = document.getElementById('file-promovidos-global');
    if(inputGlobalProm) { 
        inputGlobalProm.addEventListener('change', (e) => { 
            if (e.target.files.length) subirArchivoPromovidos(e.target.files[0]); 
        }); 
    }
    
    const btnReiniciar = document.getElementById('btn-reiniciar-encuestas');
    if (btnReiniciar) { 
        btnReiniciar.addEventListener('click', reiniciarEncuestas); 
    }
}

function subirArchivoPromovidos(file) {
    document.getElementById('loading-overlay').style.display = 'flex';
    const formData = new FormData(); 
    formData.append('file', file);
    
    csrfFetch('/api/cargar-promovidos/', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            const inputGlobalProm = document.getElementById('file-promovidos-global'); 
            if (inputGlobalProm) inputGlobalProm.value = '';
            
            if (data.status === 'ok') { 
                cambiarVistaMiniPromovidos('lista'); 
                cambiarTabModalPromovidos('lista'); 
                cargarTablaPromovidos(); 
                dispararRecalculoProyeccion(); 
                mostrarToast(data.mensaje || "Padrón cargado correctamente");
                if (data.rechazados || data.omitidos) dashboardNotice(data.mensaje + " " + (data.errores || []).map(item => "Fila " + item.fila + ": " + item.error).join(" · "));
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert(`Error: ${data.error}`); 
            }
        })
        .catch(err => { 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
        });
}

window.procesarArchivosEscucha = function(e) {
    if (e.target.files.length !== 3) { 
        alert("Por favor selecciona exactamente 3 archivos de reporte Excel para comparar."); 
        e.target.value = ''; 
        return; 
    }
    
    document.getElementById('loading-overlay').style.display = 'flex';
    
    let formData = new FormData(); 
    formData.append('files', e.target.files[0]); 
    formData.append('files', e.target.files[1]); 
    formData.append('files', e.target.files[2]);
    
    csrfFetch('/api/procesar-escucha/', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(res => {
            if(res.status === 'ok') {
                datosEscuchaProcesados = res.data; 
                factorSentimientoGlobal = res.factor_global; 
                
                document.getElementById('escucha-vacio').style.display = 'none'; 
                document.getElementById('escucha-contenido').style.display = 'flex'; 
                
                renderizarTabsEscucha(); 
                dispararRecalculoProyeccion();
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert("Error al procesar: " + res.error); 
            }
            e.target.value = ''; 
        })
        .catch(err => { 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
        });
};

function renderizarTabsEscucha() {
    if (!datosEscuchaProcesados || datosEscuchaProcesados.length < 3) return;
    const metricas = Object.keys(datosEscuchaProcesados[0].metricas); 
    const container = document.getElementById('escucha-tabs'); 
    container.innerHTML = '';
    
    const metricasParaTabs = metricas.filter(m => m !== 'Número de positivos' && m !== 'Número de negativos');
    
    const btnSentimiento = document.createElement('button'); 
    btnSentimiento.className = 'tab-metrica activo'; 
    btnSentimiento.id = 'tab-Sentimiento'; 
    btnSentimiento.innerText = 'Sentimiento (Pos/Neg)'; 
    btnSentimiento.onclick = () => seleccionarMetricaEscucha('Sentimiento'); 
    container.appendChild(btnSentimiento);
    
    metricasParaTabs.forEach(m => {
        const btn = document.createElement('button'); 
        btn.className = 'tab-metrica'; 
        btn.id = 'tab-' + m.replace(/\s+/g, ''); 
        btn.innerText = m; 
        btn.onclick = () => seleccionarMetricaEscucha(m); 
        container.appendChild(btn);
    });
    
    seleccionarMetricaEscucha('Sentimiento');
}

window.seleccionarMetricaEscucha = function(metricaSeleccionada) {
    document.querySelectorAll('.tab-metrica').forEach(b => b.classList.remove('activo'));
    document.getElementById('tab-' + metricaSeleccionada.replace(/\s+/g, '')).classList.add('activo');
    
    const vistaDual = document.getElementById('escucha-vista-dual'); 
    const vistaComp = document.getElementById('escucha-vista-comparativa');
    
    if (metricaSeleccionada === 'Sentimiento') { 
        vistaDual.style.display = 'flex'; 
        vistaComp.style.display = 'none'; 
        renderizarVistaDual(); 
    } else { 
        vistaDual.style.display = 'none'; 
        vistaComp.style.display = 'flex'; 
        renderizarVistaComparativa(metricaSeleccionada); 
    }
}

function renderizarVistaDual() {
    const c1 = datosEscuchaProcesados[0], c2 = datosEscuchaProcesados[1], c3 = datosEscuchaProcesados[2];
    
    const mapearDatos = (c) => {
        const pos = c.metricas['Número de positivos'] || 0; 
        const neg = c.metricas['Número de negativos'] || 0; 
        const total = c.total_menciones || 1;
        return { 
            pos, neg, neu: Math.max(0, total - pos - neg), 
            pctPos: ((pos/total)*100).toFixed(1), 
            pctNeg: ((neg/total)*100).toFixed(1), 
            domPos: pos >= neg 
        };
    };

    const d1 = mapearDatos(c1), d2 = mapearDatos(c2), d3 = mapearDatos(c3);

    document.getElementById('ui-cand1-name-dual').innerText = limpiarNombre(c1.candidato);
    document.getElementById('ui-cand1-pos').innerText = `Pos: ${d1.pos} (${d1.pctPos}%)`;
    document.getElementById('ui-cand1-neg').innerText = `Neg: ${d1.neg} (${d1.pctNeg}%)`;

    document.getElementById('ui-cand2-name-dual').innerText = limpiarNombre(c2.candidato);
    document.getElementById('ui-cand2-pos').innerText = `Pos: ${d2.pos} (${d2.pctPos}%)`;
    document.getElementById('ui-cand2-neg').innerText = `Neg: ${d2.neg} (${d2.pctNeg}%)`;

    document.getElementById('ui-cand3-name-dual').innerText = limpiarNombre(c3.candidato);
    document.getElementById('ui-cand3-pos').innerText = `Pos: ${d3.pos} (${d3.pctPos}%)`;
    document.getElementById('ui-cand3-neg').innerText = `Neg: ${d3.neg} (${d3.pctNeg}%)`;

    const tooltipFlotante = (context) => {
        let tooltipEl = document.getElementById('tooltip-externo-dona');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div'); 
            tooltipEl.id = 'tooltip-externo-dona';
            tooltipEl.style.background = '#1b5e20'; 
            tooltipEl.style.borderRadius = '8px'; 
            tooltipEl.style.color = '#fff'; 
            tooltipEl.style.pointerEvents = 'none'; 
            tooltipEl.style.position = 'absolute'; 
            tooltipEl.style.transform = 'translate(-50%, -100%)'; 
            tooltipEl.style.zIndex = '99999'; 
            tooltipEl.style.padding = '8px 12px'; 
            tooltipEl.style.fontSize = '10.5px'; 
            tooltipEl.style.fontWeight = '700'; 
            document.body.appendChild(tooltipEl);
        }
        
        const tooltipModel = context.tooltip; 
        if (tooltipModel.opacity === 0) { tooltipEl.style.opacity = '0'; return; }
        if (tooltipModel.body) { tooltipEl.innerText = tooltipModel.body[0].lines[0]; }
        
        const position = context.chart.canvas.getBoundingClientRect();
        tooltipEl.style.opacity = '1';
        tooltipEl.style.left = position.left + window.scrollX + tooltipModel.caretX + 'px';
        tooltipEl.style.top = position.top + window.scrollY + tooltipModel.caretY - 10 + 'px';
    };

    const opcionesDona = (pctDominante, esPositivo) => ({
        responsive: true, 
        maintainAspectRatio: false, 
        layout: { padding: { top: 4, bottom: 4 } },
        plugins: { 
            legend: { display: false }, 
            tooltip: { 
                enabled: false, 
                external: tooltipFlotante, 
                callbacks: { label: (ctx) => `${ctx.label}: ${ctx.raw.toLocaleString()}` } 
            }, 
            textoCentral: { 
                display: true, value: pctDominante + '%', 
                label: esPositivo ? 'POS' : 'NEG', 
                color: esPositivo ? '#2b9348' : '#c93b3b', 
                labelColor: esPositivo ? '#2b9348' : '#c93b3b', 
                tamValor: 18 
            } 
        },
        cutout: '70%', 
        animation: { duration: 900 }
    });

    const initDona = (canvasId, chartObj, datos) => {
        const ctx = document.getElementById(canvasId).getContext('2d');
        return renderDashboardChart(ctx, {
            type: 'doughnut', 
            data: { 
                labels: ['Positivos', 'Negativos', 'Neutras'], 
                datasets: [{ 
                    data: [datos.pos, datos.neg, datos.neu], 
                    backgroundColor: ['#2b9348', '#c93b3b', '#e6ece6'], 
                    borderWidth: 2.5, 
                    borderColor: '#fff' 
                }] 
            }, 
            options: opcionesDona(datos.domPos ? datos.pctPos : datos.pctNeg, datos.domPos) 
        });
    };

    chartEscuchaC1 = initDona('chart-escucha-c1', chartEscuchaC1, d1);
    chartEscuchaC2 = initDona('chart-escucha-c2', chartEscuchaC2, d2);
    chartEscuchaC3 = initDona('chart-escucha-c3', chartEscuchaC3, d3);
}

function renderizarVistaComparativa(metrica) {
    const c1 = datosEscuchaProcesados[0], c2 = datosEscuchaProcesados[1], c3 = datosEscuchaProcesados[2];
    const v1 = c1.metricas[metrica] || 0, v2 = c2.metricas[metrica] || 0, v3 = c3.metricas[metrica] || 0;
    const total = v1 + v2 + v3;

    const p1 = total > 0 ? ((v1 / total) * 100).toFixed(1) : '0.0';
    const p2 = total > 0 ? ((v2 / total) * 100).toFixed(1) : '0.0';
    const p3 = total > 0 ? ((v3 / total) * 100).toFixed(1) : '0.0';
    
    document.getElementById('ui-cand1-name-comp').innerText = limpiarNombre(c1.candidato);
    animarContador(document.getElementById('ui-cand1-val'), v1); 
    document.getElementById('ui-cand1-pct').innerText = `(${p1}%)`;
    
    document.getElementById('ui-cand2-name-comp').innerText = limpiarNombre(c2.candidato);
    animarContador(document.getElementById('ui-cand2-val'), v2); 
    document.getElementById('ui-cand2-pct').innerText = `(${p2}%)`;

    document.getElementById('ui-cand3-name-comp').innerText = limpiarNombre(c3.candidato);
    animarContador(document.getElementById('ui-cand3-val'), v3); 
    document.getElementById('ui-cand3-pct').innerText = `(${p3}%)`;
    
    const ctx = document.getElementById('chart-escucha-comp').getContext('2d');
    
    const grad1 = ctx.createLinearGradient(0, 0, 300, 0); 
    grad1.addColorStop(0, '#1b5e20'); 
    grad1.addColorStop(1, '#38a838');
    
    const grad2 = ctx.createLinearGradient(0, 0, 300, 0); 
    grad2.addColorStop(0, '#164e63'); 
    grad2.addColorStop(1, '#2b7a98');
    
    const grad3 = ctx.createLinearGradient(0, 0, 300, 0); 
    grad3.addColorStop(0, '#911b22'); 
    grad3.addColorStop(1, '#b8252d');

    document.getElementById('dot-cand1').style.background = '#38a838';
    document.getElementById('dot-cand2').style.background = '#2b7a98';
    document.getElementById('dot-cand3').style.background = '#b8252d';
    
    const maxValor = Math.max(v1, v2, v3);
    const lideres = [];
    if(v1 === maxValor && maxValor > 0) lideres.push(c1.candidato);
    if(v2 === maxValor && maxValor > 0) lideres.push(c2.candidato);
    if(v3 === maxValor && maxValor > 0) lideres.push(c3.candidato);

    chartEscuchaComp = renderDashboardChart(ctx, {
        type: 'bar',
        data: {
            labels: [limpiarNombre(c1.candidato), limpiarNombre(c2.candidato), limpiarNombre(c3.candidato)],
            datasets: [{
                data: [v1, v2, v3],
                backgroundColor: [grad1, grad2, grad3],
                borderColor: [lideres.includes(c1.candidato)?colorOro:'transparent', lideres.includes(c2.candidato)?colorOro:'transparent', lideres.includes(c3.candidato)?colorOro:'transparent'],
                borderWidth: [lideres.includes(c1.candidato)?2.5:0, lideres.includes(c2.candidato)?2.5:0, lideres.includes(c3.candidato)?2.5:0],
                borderRadius: 6, 
                barPercentage: 0.6
            }]
        },
        options: {
            indexAxis: 'y', 
            responsive: true, 
            maintainAspectRatio: false, 
            layout: { padding: { right: 55, top: 6, bottom: 6 } },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toLocaleString()} menciones` } },
                valoresBarra: { display: true, color: '#1e293b' }
            },
            scales: {
                x: { display: false, beginAtZero: true },
                y: { ticks: { color: '#1e293b', font: { size: 11, weight: '700' } }, grid: { display: false } }
            }
        }
    });
}

window.abrirModalEncuestas = function() { 
    document.getElementById('modal-encuestas').classList.add('active'); 
    cambiarTabEncuestas('promedio'); 
}

window.cerrarModalEncuestas = function() { 
    document.getElementById('modal-encuestas').classList.remove('active'); 
    cancelarEdicion(); 
}

window.cambiarTabEncuestas = function(tipo) {
    const tabs = ['promedio', 'historial', 'agregar'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-modal-${t}`); 
        const vista = document.getElementById(`vista-modal-${t}`);
        
        if(t === tipo) { 
            btn.className = 'tab-btn activo'; 
            btn.style.background = ''; 
            btn.style.color = ''; 
            vista.style.display = (t === 'historial') ? 'flex' : 'block'; 
        } else { 
            btn.className = 'tab-btn'; 
            btn.style.background = 'transparent'; 
            btn.style.color = '#777'; 
            vista.style.display = 'none'; 
        }
    });
    
    if (tipo === 'promedio') cargarGraficaPromedio();
    if (tipo === 'historial') cargarHistorialEncuestas();
};

function cargarHistorialEncuestas() {
    const tbody = document.getElementById('tabla-historial-body'); 
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:18px; color:#64748b;">Cargando historial…</td></tr>`;
    
    dashboardFetch('/api/historial-encuestas/')
        .then(res => { 
            if (!res.ok) throw new Error('HTTP ' + res.status); 
            return res.json(); 
        })
        .then(data => {
            historialEncuestasCache = Array.isArray(data) ? data : []; 
            tbody.innerHTML = '';
            
            const btnReiniciar = document.getElementById('btn-reiniciar-encuestas'); 
            if (btnReiniciar) btnReiniciar.disabled = historialEncuestasCache.length === 0;
            
            if (historialEncuestasCache.length === 0) { 
                tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:18px; color:#64748b;">Aún no hay encuestas registradas. Agrega la primera en "Agregar Nueva".</td></tr>`; 
                return; 
            }
            
            historialEncuestasCache.forEach((e, idx) => {
                const fila = document.createElement('tr');
                fila.innerHTML = `<td>${e.fecha}</td><td><b>${e.casa}</b></td><td style="color:#1b538a; font-weight:bold;">${e.pan}%</td><td style="color:#14532d;">${e.pri}%</td><td style="color:#deb818;">${e.prd}%</td><td style="color:#38a838; font-weight:bold;">${e.pvem}%</td><td style="color:#b8252d;">${e.pt}%</td><td style="color:#d16424;">${e.mc}%</td><td style="color:#96292d; font-weight:bold;">${e.morena}%</td><td style="color:#1c9695;">${e.naem}%</td><td style="color:#94a3b8;">${e.indecisos}%</td><td style="text-align:center;"><button class="btn-editar-encuesta" data-idx="${idx}" title="Editar" style="background:none; border:none; cursor:pointer; font-size:13px; color:#1b5e20; font-weight:bold;">Editar</button><button class="btn-eliminar-encuesta" data-id="${e.id}" title="Eliminar" style="background:none; border:none; cursor:pointer; font-size:13px; color:#b8252d; font-weight:bold; margin-left:10px;">Eliminar</button></td>`;
                tbody.appendChild(fila);
            });
            
            tbody.querySelectorAll('.btn-editar-encuesta').forEach(btn => { 
                btn.addEventListener('click', () => editarEncuesta(historialEncuestasCache[Number(btn.dataset.idx)])); 
            });
            
            tbody.querySelectorAll('.btn-eliminar-encuesta').forEach(btn => { 
                btn.addEventListener('click', () => eliminarEncuesta(Number(btn.dataset.id))); 
            });
        })
        .catch(err => { 
            dashboardReadError(err);
            tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:18px; color:#b8252d;">No se pudo cargar el historial. Revisa la consola (F12) para más detalle.</td></tr>`; 
        });
}

window.eliminarEncuesta = function(id) {
    if(!confirm("¿Desea eliminar esta encuesta? El sistema recalculará las proyecciones.")) return; 
    document.getElementById('loading-overlay').style.display = 'flex';
    
    let formData = new FormData(); 
    formData.append('id', id);
    
    csrfFetch('/api/eliminar-encuesta/', { method: 'POST', body: formData })
        .then(res => { 
            if(!res.ok) throw new Error('HTTP ' + res.status); 
            return res.json(); 
        })
        .then(data => { 
            if(data.status === 'ok') { 
                cargarHistorialEncuestas(); 
                dispararRecalculoProyeccion(); 
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert('No se pudo eliminar la encuesta: ' + (data.msg || 'error desconocido')); 
            }
        })
        .catch(err => { 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
            alert('Error de conexión al eliminar la encuesta.'); 
        });
}

window.editarEncuesta = function(encuesta) {
    document.getElementById('enc-id').value = encuesta.id; 
    document.getElementById('enc-casa').value = encuesta.casa; 
    document.getElementById('enc-pan').value = encuesta.pan; 
    document.getElementById('enc-pri').value = encuesta.pri; 
    document.getElementById('enc-prd').value = encuesta.prd; 
    document.getElementById('enc-pvem').value = encuesta.pvem; 
    document.getElementById('enc-pt').value = encuesta.pt; 
    document.getElementById('enc-mc').value = encuesta.mc; 
    document.getElementById('enc-morena').value = encuesta.morena; 
    document.getElementById('enc-naem').value = encuesta.naem; 
    document.getElementById('enc-indecisos').value = encuesta.indecisos;
    
    document.getElementById('tab-modal-agregar').innerText = 'Editar Registro'; 
    document.getElementById('btn-guardar-encuesta').innerText = 'Actualizar Datos'; 
    document.getElementById('btn-cancelar-edicion').style.display = 'block'; 
    
    document.getElementById('form-encuesta').dispatchEvent(new Event('input')); 
    cambiarTabEncuestas('agregar');
}

window.cancelarEdicion = function() {
    document.getElementById('form-encuesta').reset(); 
    document.getElementById('enc-id').value = ''; 
    document.getElementById('tab-modal-agregar').innerText = 'Agregar Nueva'; 
    document.getElementById('btn-guardar-encuesta').innerText = 'Procesar Encuesta'; 
    document.getElementById('btn-cancelar-edicion').style.display = 'none'; 
    document.getElementById('total-encuesta').innerText = 'Total: 0.0%';
}

document.getElementById('form-encuesta').addEventListener('input', function() {
    let ids = ['enc-pan', 'enc-pri', 'enc-prd', 'enc-pvem', 'enc-pt', 'enc-mc', 'enc-morena', 'enc-naem', 'enc-indecisos'];
    let total = 0; 
    ids.forEach(id => total += parseFloat(document.getElementById(id).value || 0));
    
    let elTotal = document.getElementById('total-encuesta'); 
    elTotal.innerText = `Total: ${total.toFixed(1)}%`; 
    elTotal.style.color = (Math.abs(total - 100.0) < 0.05) ? '#38a838' : '#b8252d';
});

window.guardarNuevaEncuesta = function() {
    const btnGuardar = document.getElementById('btn-guardar-encuesta'); 
    if (btnGuardar) btnGuardar.disabled = true; 
    document.getElementById('loading-overlay').style.display = 'flex';

    let formData = new FormData(); 
    const idEdicion = document.getElementById('enc-id').value; 
    if(idEdicion) formData.append('id', idEdicion);
    
    formData.append('casa_encuestadora', document.getElementById('enc-casa').value); 
    formData.append('pan', document.getElementById('enc-pan').value); 
    formData.append('pri', document.getElementById('enc-pri').value); 
    formData.append('prd', document.getElementById('enc-prd').value); 
    formData.append('pvem', document.getElementById('enc-pvem').value); 
    formData.append('pt', document.getElementById('enc-pt').value); 
    formData.append('mc', document.getElementById('enc-mc').value); 
    formData.append('morena', document.getElementById('enc-morena').value); 
    formData.append('naem', document.getElementById('enc-naem').value); 
    formData.append('indecisos', document.getElementById('enc-indecisos').value);
    
    csrfFetch('/api/guardar-encuesta/', { method: 'POST', body: formData })
        .then(res => { 
            if(!res.ok) throw new Error('HTTP ' + res.status); 
            return res.json(); 
        })
        .then(data => {
            if (btnGuardar) btnGuardar.disabled = false;
            
            if(data.status === 'ok') { 
                cerrarModalEncuestas(); 
                dispararRecalculoProyeccion(); 
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert('No se pudo guardar la encuesta: ' + (data.msg || 'error desconocido')); 
            }
        })
        .catch(err => { 
            if (btnGuardar) btnGuardar.disabled = false; 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
            alert('Error de conexión al guardar la encuesta.'); 
        });
};

function reiniciarEncuestas() {
    if (!confirm('Esto eliminará TODAS las encuestas registradas y reiniciará el contador a 0. Esta acción no se puede deshacer. ¿Deseas continuar?')) return;
    const confirmacion = prompt('Para confirmar, escribe REINICIAR en mayúsculas:');
    
    if (confirmacion !== 'REINICIAR') { 
        if (confirmacion !== null) alert('Texto incorrecto. Operación cancelada.'); 
        return; 
    }
    
    document.getElementById('loading-overlay').style.display = 'flex';
    
    csrfFetch('/api/reiniciar-encuestas/', { method: 'POST' })
        .then(res => { 
            if(!res.ok) throw new Error('HTTP ' + res.status); 
            return res.json(); 
        })
        .then(data => {
            if (data.status === 'ok') { 
                cargarHistorialEncuestas(); 
                dispararRecalculoProyeccion(); 
            } else { 
                document.getElementById('loading-overlay').style.display = 'none'; 
                alert('No se pudo reiniciar el historial: ' + (data.msg || 'error desconocido')); 
            }
        })
        .catch(err => { 
            document.getElementById('loading-overlay').style.display = 'none'; 
            dashboardReadError(err);
            alert('Error de conexión al reiniciar el historial.'); 
        });
}

function cargarGraficaPromedio() {
    dashboardFetch('/api/promedio-encuestas/')
        .then(res => res.json())
        .then(data => {
            const partidosBase = ['PAN', 'PRI', 'PRD', 'PVEM', 'PT', 'MC', 'MORENA', 'NAEM', 'Indecisos'];
            const valoresBase = [data.pan, data.pri, data.prd, data.pvem, data.pt, data.mc, data.morena, data.naem, data.indecisos];
            const sumaTotal = valoresBase.reduce((a, b) => a + (Number(b) || 0), 0);
            
            const canvasWrap = document.querySelector('#vista-modal-promedio .grafica-modal'); 
            const vacioEl = document.getElementById('promedio-vacio');
            
            if (sumaTotal === 0) { 
                discardDashboardChart('grafica-encuestas'); chartEncuestas = null;
                if (canvasWrap) canvasWrap.style.display = 'none'; 
                if (vacioEl) vacioEl.style.display = 'flex'; 
                return; 
            }
            
            if (canvasWrap) canvasWrap.style.display = 'block'; 
            if (vacioEl) vacioEl.style.display = 'none';


            
            const ctx = document.getElementById('grafica-encuestas').getContext('2d');
            const { partidosOrd, votosOrd } = ordenarPorVotos(partidosBase, valoresBase);
            const colores = partidosOrd.map(p => { 
                if (p === 'Indecisos') return '#94a3b8'; 
                if (p === 'PVEM') return '#38a838'; 
                return coloresPartidos[p] ? coloresPartidos[p] : '#888888'; 
            });
            
            const maxVoto = Math.max(...votosOrd.map(Number));
            const bordeColor = partidosOrd.map((p, i) => (votosOrd[i] === maxVoto && maxVoto > 0 && p !== 'Indecisos') ? colorOro : 'transparent');
            const bordeAncho = partidosOrd.map((p, i) => (votosOrd[i] === maxVoto && maxVoto > 0 && p !== 'Indecisos') ? 3 : 0);

            chartEncuestas = renderDashboardChart(ctx, {
                type: 'bar', 
                data: { 
                    labels: partidosOrd, 
                    datasets: [{ 
                        data: votosOrd, 
                        backgroundColor: colores, 
                        borderColor: bordeColor, 
                        borderWidth: bordeAncho, 
                        borderRadius: 6, 
                        barPercentage: 0.72, 
                        categoryPercentage: 0.82, 
                        minBarLength: 4 
                    }] 
                }, 
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    layout: { padding: { right: 44 } }, 
                    plugins: { 
                        legend: { display: false }, 
                        tooltip: { 
                            backgroundColor: '#1b5e20', 
                            titleColor: '#fff', 
                            bodyColor: '#eaf6ea', 
                            padding: 10, 
                            cornerRadius: 8, 
                            displayColors: false, 
                            callbacks: { label: (ctx) => `${ctx.parsed.x}%` } 
                        }, 
                        valoresBarra: { display: true, color: '#1e293b' } 
                    }, 
                    scales: { 
                        x: { display: false, grid: { display: false }, min: 0, max: 100 }, 
                        y: { ticks: { font: {size: 10.5, weight: '700'} }, grid: { display: false } } 
                    } 
                } 
            });
        })
        .catch(err => console.error(err));
}