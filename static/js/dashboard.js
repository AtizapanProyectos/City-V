/* Shared transport, rendering and mobile navigation. No application data is persisted here. */
const dashboardReads = new Map();
const dashboardCache = new Map();
const dashboardControllers = new Map();
const pendingDashboardCharts = new Map();
let dashboardGeneration = 0;
let dashboardImportPending = false;

function invalidateDashboardData() {
    dashboardGeneration += 1;
    dashboardCache.clear();
    dashboardReads.clear();
}

function dashboardNotice(message, retry) {
    let notice = document.getElementById('dashboard-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'dashboard-notice';
        notice.setAttribute('role', 'status');
        document.body.appendChild(notice);
    }
    notice.replaceChildren(document.createTextNode(message + ' '));
    if (retry) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Reintentar';
        button.onclick = () => { notice.hidden = true; retry(); };
        notice.appendChild(button);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Cerrar';
    close.onclick = () => { notice.hidden = true; };
    notice.appendChild(close);
    notice.hidden = false;
}

function dashboardReadError(error, retry) {
    if (error.name !== 'AbortError') dashboardNotice(error.message || 'No se pudo cargar la información.', retry);
}

function dashboardFetch(url, options = {}) {
    const { requestKey, ...fetchOptions } = options;
    const read = !options.method || options.method === 'GET';
    const cacheable = read && /^\/api\/(totales|seccion|escucha-social)/.test(url);
    const importing = !read && /cargar-promovidos|procesar-escucha/.test(url);
    if (importing && dashboardImportPending) return Promise.reject(new Error('Ya hay una importación en curso.'));
    const uploadInputs = importing ? [...document.querySelectorAll('input[type="file"]')].map(node => [node, node.disabled]) : [];
    if (importing) { dashboardImportPending = true; uploadInputs.forEach(([node]) => { node.disabled = true; }); }
    const generation = dashboardGeneration;
    const previous = requestKey && dashboardControllers.get(requestKey);
    if (previous && previous.dashboardURL !== url) previous.abort();
    const cached = dashboardCache.get(url);
    if (cacheable && cached && Date.now() - cached.time < 30000) return Promise.resolve(cached.response.clone());
    if (read && dashboardReads.has(url)) return dashboardReads.get(url).then(response => response.clone());
    if (requestKey) dashboardControllers.get(requestKey)?.abort();
    const controller = new AbortController();
    controller.dashboardURL = url;
    if (requestKey) dashboardControllers.set(requestKey, controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, read ? 15000 : 120000);
    if (!read) invalidateDashboardData();
    const promise = fetch(url, { ...fetchOptions, signal: controller.signal })
        .then(async response => {
            if (!response.ok) {
                const detail = await response.clone().json().catch(() => ({}));
                throw new Error(detail.error || detail.msg || `No se pudo completar la solicitud (${response.status}).`);
            }
            if (read && generation !== dashboardGeneration) throw new DOMException('Lectura anterior descartada', 'AbortError');
            if (cacheable) {
                if (dashboardCache.size >= 40) dashboardCache.delete(dashboardCache.keys().next().value);
                dashboardCache.set(url, { time: Date.now(), response: response.clone() });
            }
            return response;
        })
        .catch(error => {
            if (timedOut) throw new Error(read ? 'La carga tardó demasiado. Puedes reintentar.' : 'Se interrumpió la conexión. Verifica los registros antes de volver a cargar el archivo.');
            throw error;
        })
        .finally(() => {
            clearTimeout(timer);
            if (importing) { dashboardImportPending = false; uploadInputs.forEach(([node, disabled]) => { node.disabled = disabled; }); }
            if (read && dashboardReads.get(url) === promise) dashboardReads.delete(url);
            if (!read) invalidateDashboardData();
            if (requestKey && dashboardControllers.get(requestKey) === controller) dashboardControllers.delete(requestKey);
        });
    if (read) dashboardReads.set(url, promise);
    return promise.then(response => response.clone());
}

function applyLayerStyle(layer, style) {
    if (Object.entries(style).some(([name, value]) => layer.options[name] !== value)) layer.setStyle(style);
}

function dashboardCanvasVisible(canvas) {
    return canvas.getClientRects().length && canvas.clientWidth && getComputedStyle(canvas).visibility !== 'hidden' && !canvas.closest('[hidden]');
}

function renderDashboardChart(context, config) {
    const canvas = context.canvas || context;
    const existing = Chart.getChart(canvas);
    if (!dashboardCanvasVisible(canvas)) {
        pendingDashboardCharts.set(canvas, config);
        return existing || null;
    }
    pendingDashboardCharts.delete(canvas);
    if (existing && existing.config.type === config.type) {
        existing.data = config.data;
        existing.options = config.options;
        existing.update('none');
        return existing;
    }
    existing?.destroy();
    config.options = { ...config.options, animation: { duration: matchMedia('(max-width: 1024px), (prefers-reduced-motion: reduce)').matches ? 0 : 250 } };
    return new Chart(context, config);
}

let dashboardPendingBounds = null;
let dashboardMunicipalBounds = null;
function setDashboardMunicipalBounds(bounds) { dashboardMunicipalBounds = bounds; }
function moveDashboardMap(bounds, options = {}) {
    dashboardPendingBounds = { bounds, options };
    requestAnimationFrame(flushDashboardMap);
}
function flushDashboardMap() {
    if (typeof map === 'undefined' || !map || !map.getContainer().clientWidth || !map.getContainer().clientHeight || map.getContainer().closest('[hidden]')) return;
    map.stop();
    map.invalidateSize({ animate: false });
    if (dashboardMunicipalBounds) {
        map.setMinZoom(Math.max(3, map.getBoundsZoom(dashboardMunicipalBounds) - 1));
        map.setMaxBounds(dashboardMunicipalBounds.pad(0.3));
    }
    if (dashboardPendingBounds) {
        const pending = dashboardPendingBounds; dashboardPendingBounds = null;
        map.fitBounds(pending.bounds, { ...pending.options, animate: false });
    }
}

function discardDashboardChart(id) {
    const canvas = document.getElementById(id);
    pendingDashboardCharts.delete(canvas);
    Chart.getChart(canvas)?.destroy();
}

function flushDashboardCharts() {
    for (const [canvas, config] of pendingDashboardCharts) {
        if (dashboardCanvasVisible(canvas)) renderDashboardChart(canvas, config);
    }
    Object.values(Chart.instances).forEach(chart => {
        if (chart.canvas && dashboardCanvasVisible(chart.canvas)) chart.resize();
    });
}

function escapeDashboardText(value) {
    const node = document.createElement('span');
    node.textContent = value == null ? '-' : String(value);
    return node.innerHTML;
}

const mobileDashboard = (() => {
    const media = matchMedia('(max-width: 1024px)');
    let workspace, navigation;
    let active = 'mapa';
    const positions = [];
    const panels = {};

    function select(name, focus = false) {
        if (!media.matches || !workspace) return;
        if (typeof map !== 'undefined' && map) map.stop();
        active = name;
        for (const [id, panel] of Object.entries(panels)) panel.hidden = id !== name;
        navigation.querySelectorAll('button').forEach(button => {
            const selected = button.dataset.view === name;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focus) button.focus();
        });
        if (name === 'promovidos') cargarTablaPromovidos(promovidosPagina);
        requestAnimationFrame(() => {
            if (name === 'mapa') flushDashboardMap();
            flushDashboardCharts();
        });
    }

    function layout() {
        if (typeof map !== 'undefined' && map) map.stop();
        document.body.classList.toggle('mobile-dashboard', media.matches);
        workspace.hidden = navigation.hidden = !media.matches;
        if (media.matches) {
            positions.forEach(({ node, view }) => panels[view].appendChild(node));
            select(active);
        } else {
            positions.forEach(({ node, marker }) => marker.after(node));
            requestAnimationFrame(() => {
                flushDashboardMap();
                flushDashboardCharts();
            });
        }
    }

    function init() {
        workspace = document.createElement('main'); workspace.id = 'mobile-workspace';
        navigation = document.createElement('nav'); navigation.id = 'mobile-navigation';
        navigation.setAttribute('role', 'tablist'); navigation.setAttribute('aria-label', 'Herramientas electorales');
        for (const [id, title] of Object.entries({ mapa: 'Mapa', resultados: 'Resultados', promovidos: 'Promovidos', escucha: 'Escucha' })) {
            const panel = document.createElement('section');
            panel.id = `mobile-${id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `mobile-tab-${id}`);
            panels[id] = panel; workspace.appendChild(panel);
            const button = document.createElement('button');
            button.type = 'button'; button.id = `mobile-tab-${id}`; button.dataset.view = id;
            button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id); button.textContent = title;
            button.onclick = () => select(id);
            button.onkeydown = event => {
                const buttons = [...navigation.querySelectorAll('button')];
                let index = buttons.indexOf(button);
                if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
                else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
                else if (event.key === 'Home') index = 0;
                else if (event.key === 'End') index = buttons.length - 1;
                else return;
                event.preventDefault(); select(buttons[index].dataset.view, true);
            };
            navigation.appendChild(button);
        }
        const tools = document.createElement('div'); tools.className = 'mobile-result-tools';
        tools.innerHTML = '<button type="button" id="mobile-municipio">Ver municipio</button><button type="button" id="mobile-encuestas">Gestión de encuestas</button><button type="button" id="mobile-volver-mapa">Volver al mapa</button>';
        panels.resultados.appendChild(tools);
        tools.querySelector('#mobile-municipio').onclick = () => { document.getElementById('btn-restaurar-mapa').click(); select('resultados'); };
        tools.querySelector('#mobile-encuestas').onclick = () => abrirModalEncuestas();
        tools.querySelector('#mobile-volver-mapa').onclick = () => select('mapa');
        const escuchaUpload = document.createElement('button'); escuchaUpload.type = 'button'; escuchaUpload.className = 'mobile-upload btn-magenta';
        escuchaUpload.textContent = 'Cargar Escucha Social (3 Excel)';
        escuchaUpload.onclick = () => document.getElementById('file-escucha-global').click();
        panels.escucha.appendChild(escuchaUpload);
        for (const [id, view] of [
            ['mapa-wrapper', 'mapa'], ['panel-totales-municipio', 'resultados'],
            ['cuadrante-superior-derecho', 'resultados'], ['cuadrante-inferior-izquierdo', 'promovidos'], ['cuadrante-superior-izquierdo', 'escucha'],
        ]) {
            const node = document.getElementById(id), marker = document.createComment(id);
            node.before(marker); positions.push({ node, marker, view });
        }
        document.body.append(workspace, navigation);
        media.addEventListener('change', layout);
        layout();
        window.addEventListener('resize', () => requestAnimationFrame(() => { flushDashboardMap(); flushDashboardCharts(); }));
    }
    document.addEventListener('DOMContentLoaded', init);
    return { select, isMobile: () => media.matches };
})();

// Keyboard access stays within an open dialog; Escape uses the existing close action.
document.addEventListener('keydown', event => {
    const modal = document.querySelector('.modal-overlay.active');
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); modal.querySelector('.close-modal')?.click(); }
    if (event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
        .filter(node => !node.disabled && node.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});
