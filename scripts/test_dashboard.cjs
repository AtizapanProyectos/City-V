const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function runtime(fetch, overrides = {}) {
    const sandbox = {
        fetch, Response, Headers, AbortController, DOMException, setTimeout, clearTimeout,
        document: { addEventListener() {}, querySelectorAll() { return []; } },
        matchMedia: () => ({ matches: false }),
        ...overrides,
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/dashboard.js'), 'utf8'), sandbox);
    return sandbox;
}

test('simultaneous reads share a request and each caller receives its own body', async () => {
    let calls = 0;
    const state = runtime(async () => { calls++; return Response.json({ count: 1 }); });
    const responses = await Promise.all([
        state.dashboardFetch('/api/totales/'), state.dashboardFetch('/api/totales/'),
    ]);
    assert.deepEqual(await responses[0].json(), { count: 1 });
    assert.deepEqual(await responses[1].json(), { count: 1 });
    await state.dashboardFetch('/api/totales/');
    assert.equal(calls, 1);
    await state.dashboardFetch('/api/guardar-encuesta/', { method: 'POST' });
    await state.dashboardFetch('/api/totales/');
    assert.equal(calls, 3);
});

test('selecting another section cancels the old request', async () => {
    const state = runtime((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
        if (url.endsWith('/2/')) resolve(Response.json({ section: 2 }));
    }));
    const first = state.dashboardFetch('/api/seccion/1/', { requestKey: 'section' });
    const rejection = assert.rejects(first, { name: 'AbortError' });
    const latest = await state.dashboardFetch('/api/seccion/2/', { requestKey: 'section' });
    await rejection;
    assert.equal((await latest.json()).section, 2);
});

test('timeouts and HTTP errors are visible and no request remains cached', async () => {
    let expire;
    const state = runtime((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }), { setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {} });
    const pending = state.dashboardFetch('/api/promovidos/');
    const rejection = assert.rejects(pending, /tardó demasiado/);
    expire();
    await rejection;
    assert.equal(vm.runInContext('dashboardReads.size', state), 0);
    const failed = runtime(async () => Response.json({ error: 'Fixture error' }, { status: 409 }));
    await assert.rejects(failed.dashboardFetch('/api/promovidos/'), /Fixture error/);
});

test('hidden charts wait for visibility and updates reuse the canvas instance', () => {
    let visible = false, creations = 0, updates = 0;
    const charts = new Map();
    class Chart {
        static instances = {};
        static getChart(canvas) { return charts.get(canvas); }
        constructor(context, config) {
            this.canvas = context.canvas || context; this.config = config;
            charts.set(this.canvas, this); Chart.instances[creations++] = this;
        }
        update(mode) { assert.equal(mode, 'none'); updates++; }
        resize() {}
    }
    const canvas = { clientWidth: 200, getClientRects: () => visible ? [1] : [], closest: () => null };
    const state = runtime(null, { Chart, getComputedStyle: () => ({ visibility: 'visible' }) });
    const config = { type: 'bar', data: { values: [1] }, options: {} };
    state.renderDashboardChart({ canvas }, config);
    assert.equal(creations, 0);
    visible = true;
    state.flushDashboardCharts();
    assert.equal(creations, 1);
    state.renderDashboardChart({ canvas }, { ...config, data: { values: [2] } });
    assert.equal(creations, 1);
    assert.equal(updates, 1);
});
