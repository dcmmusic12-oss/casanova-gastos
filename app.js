// Casa Nova Gastos — lógica de la app
import { firebaseConfig, APP_VERSION } from './config.js';

/* ===================== Constantes ===================== */
const DEFAULT_CATS = [
  'Obra y adecuación', 'Arriendo', 'Servicios públicos', 'Publicidad y marketing',
  'Legal y constitución', 'Mobiliario y equipos', 'Inventario y materiales',
  'Software y suscripciones', 'Transporte', 'Nómina y honorarios', 'Papelería y varios', 'Otros'
];
const DEFAULT_CFG = {
  negocio: 'Casa Nova',
  socios: { socio1: { nombre: 'David' }, socio2: { nombre: 'Socio' } },
  participacion: { socio1: 50, socio2: 50 },
  categorias: DEFAULT_CATS
};
const KEY_RE = /^[A-Za-z0-9-]{20,80}$/;
const LS = { key: 'cn_key', who: 'cn_who', theme: 'cn_theme' };

/* ===================== Utilidades ===================== */
const $ = (id) => document.getElementById(id);
const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const money = (n) => fmtCOP.format(Math.round(n || 0));
const fmtInt = (n) => Number(n || 0).toLocaleString('es-CO');
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseISO = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return new Date(y || 1970, (m || 1) - 1, d || 1); };
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return cap(new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })); };
const monthShort = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''); };
const dayLabel = (iso) => parseISO(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tsMillis = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : 0);
function randomKey() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(24); crypto.getRandomValues(arr);
  let s = ''; for (const b of arr) s += alphabet[b % alphabet.length];
  return `casanova-${s}`;
}
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ===================== Estado ===================== */
const state = {
  key: null, who: null, cfg: structuredClone(DEFAULT_CFG), movs: [],
  filters: { tipo: '', cat: '', pago: '', q: '' },
  form: { tipo: 'gasto', cat: '', pago: '', met: '' },
  store: null, sync: 'offline', unsub: [], installEvt: null
};

/* ===================== Almacenamiento ===================== */
class LocalStore {
  constructor(key) { this.k = `cn_local_${key}`; this.cbs = []; this.ccbs = []; window.addEventListener('storage', (e) => { if (e.key === this.k) this.emit(); }); }
  read() { try { return JSON.parse(localStorage.getItem(this.k)) || { movs: [], cfg: null }; } catch { return { movs: [], cfg: null }; } }
  write(d) { localStorage.setItem(this.k, JSON.stringify(d)); this.emit(); }
  emit() { const d = this.read(); this.cbs.forEach((cb) => cb(d.movs, { pending: false, fromCache: false, local: true })); this.ccbs.forEach((cb) => cb(d.cfg, { fromCache: false })); }
  onMovs(cb) { this.cbs.push(cb); cb(this.read().movs, { pending: false, fromCache: false, local: true }); return () => { this.cbs = this.cbs.filter((x) => x !== cb); }; }
  onConfig(cb) { this.ccbs.push(cb); cb(this.read().cfg, { fromCache: false }); return () => { this.ccbs = this.ccbs.filter((x) => x !== cb); }; }
  async add(data) { const d = this.read(); const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); d.movs.push({ ...data, id, creadoEn: Date.now(), actualizadoEn: Date.now() }); this.write(d); return id; }
  async update(id, data) { const d = this.read(); d.movs = d.movs.map((m) => m.id === id ? { ...m, ...data, actualizadoEn: Date.now() } : m); this.write(d); }
  async remove(id) { const d = this.read(); d.movs = d.movs.filter((m) => m.id !== id); this.write(d); }
  async setConfig(data) { const d = this.read(); d.cfg = { ...(d.cfg || {}), ...data }; this.write(d); }
}

class FirestoreStore {
  constructor(fb, key) {
    this.fb = fb; this.key = key;
    const app = fb.initializeApp(firebaseConfig);
    this.db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  }
  movsRef() { return this.fb.collection(this.db, 'libretas', this.key, 'movimientos'); }
  cfgRef() { return this.fb.doc(this.db, 'libretas', this.key, 'config', 'general'); }
  onMovs(cb, onErr) {
    return this.fb.onSnapshot(this.movsRef(), { includeMetadataChanges: true }, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
      cb(rows, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
    }, onErr);
  }
  onConfig(cb, onErr) {
    return this.fb.onSnapshot(this.cfgRef(), { includeMetadataChanges: true }, (snap) => {
      cb(snap.exists() ? snap.data() : null, { fromCache: snap.metadata.fromCache });
    }, onErr);
  }
  add(data) { const fb = this.fb; return fb.addDoc(this.movsRef(), { ...data, creadoEn: fb.serverTimestamp(), actualizadoEn: fb.serverTimestamp() }); }
  update(id, data) { const fb = this.fb; return fb.updateDoc(fb.doc(this.movsRef(), id), { ...data, actualizadoEn: fb.serverTimestamp() }); }
  remove(id) { return this.fb.deleteDoc(this.fb.doc(this.movsRef(), id)); }
  setConfig(data) { return this.fb.setDoc(this.cfgRef(), { ...data, actualizadoEn: this.fb.serverTimestamp() }, { merge: true }); }
}

/* ===================== Sincronización (indicador) ===================== */
function setSync(st, text) {
  state.sync = st;
  const el = $('sync'); el.dataset.state = st; $('syncText').textContent = text;
}
function updateSyncFromMeta(meta) {
  if (meta.local) return setSync('local', 'Modo local');
  if (meta.pending) return setSync('pending', navigator.onLine ? 'Sincronizando…' : 'Guardado, pendiente');
  if (meta.fromCache) return setSync(navigator.onLine ? 'pending' : 'offline', navigator.onLine ? 'Conectando…' : 'Sin conexión');
  setSync('ok', 'Sincronizado');
}
window.addEventListener('online', () => { if (state.sync === 'offline') setSync('pending', 'Conectando…'); });
window.addEventListener('offline', () => setSync('offline', 'Sin conexión'));

/* ===================== Arranque ===================== */
function readKeyFromUrl() {
  const m = (location.hash || '').match(/[#&]k=([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}
function setTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
}
function applyTheme() { const v = localStorage.getItem(LS.theme) || 'auto'; setTheme(v); $('themeSel').value = v; }

async function boot() {
  applyTheme();
  $('verInfo').textContent = `Casa Nova Gastos · versión ${APP_VERSION}`;
  const urlKey = readKeyFromUrl();
  let key = urlKey || localStorage.getItem(LS.key);
  if (urlKey && KEY_RE.test(urlKey)) localStorage.setItem(LS.key, urlKey);
  if (!key || !KEY_RE.test(key)) { openGate('gateKey'); return; }
  await openLedger(key);
}

async function openLedger(key) {
  state.key = key;
  localStorage.setItem(LS.key, key);
  closeGate('gateKey');
  if (firebaseConfig && firebaseConfig.projectId) {
    setSync('pending', 'Conectando…');
    try {
      const fb = await import('./firebase.js');
      state.store = new FirestoreStore(fb, key);
      hideBanner();
    } catch (e) {
      console.error(e);
      showBanner('No se pudo cargar la base de datos. Revisa la conexión y vuelve a abrir la app.', 'warn');
      setSync('error', 'Error');
      return;
    }
  } else {
    state.store = new LocalStore(key);
    showBanner('Modo local: los datos se guardan solo en este dispositivo porque la app aún no está conectada a Firebase.', 'warn');
  }
  state.unsub.push(state.store.onConfig((cfg) => { applyConfig(cfg); renderAll(); }, onStoreError));
  state.unsub.push(state.store.onMovs((rows, meta) => {
    state.movs = rows.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || tsMillis(b.creadoEn) - tsMillis(a.creadoEn));
    updateSyncFromMeta(meta); renderAll();
  }, onStoreError));
  state.who = localStorage.getItem(LS.who);
  if (!state.who) openGate('gateWho');
  renderAll();
}
function onStoreError(err) {
  console.error(err);
  const code = (err && err.code) || '';
  if (code.includes('permission-denied')) {
    setSync('error', 'Sin acceso');
    showBanner('La clave de acceso no es válida o la base de datos no la acepta. Revisa el link que te compartieron.', 'warn');
  } else {
    setSync('error', 'Error');
    showBanner('Hubo un problema con la base de datos: ' + (err && err.message ? err.message : code), 'warn');
  }
}
function applyConfig(remote) {
  const c = structuredClone(DEFAULT_CFG);
  if (remote) {
    if (remote.negocio) c.negocio = remote.negocio;
    if (remote.socios) { for (const k of ['socio1', 'socio2']) if (remote.socios[k] && remote.socios[k].nombre) c.socios[k].nombre = remote.socios[k].nombre; }
    if (remote.participacion && typeof remote.participacion.socio1 === 'number') c.participacion = { socio1: remote.participacion.socio1, socio2: remote.participacion.socio2 };
    if (Array.isArray(remote.categorias) && remote.categorias.length) c.categorias = remote.categorias.filter((x) => typeof x === 'string' && x.trim());
  }
  state.cfg = c;
}
function showBanner(msg, kind) { const b = $('banner'); b.textContent = msg; b.className = 'banner' + (kind ? ' ' + kind : ''); }
function hideBanner() { $('banner').className = 'banner hidden'; }
function openGate(id) { $(id).classList.add('open'); }
function closeGate(id) { $(id).classList.remove('open'); }

/* ===================== Cálculos ===================== */
function nombre(id) { return id === 'caja' ? 'Caja' : (state.cfg.socios[id] ? state.cfg.socios[id].nombre : id); }
function totals(movs) {
  const t = { gastos: 0, aportes: 0, cajaOut: 0, puso: { socio1: 0, socio2: 0 }, porCat: {}, porMes: {}, n: 0, primera: null };
  for (const m of movs) {
    const monto = Number(m.monto) || 0;
    if (m.tipo === 'aporte') {
      t.aportes += monto; if (t.puso[m.pagadoPor] !== undefined) t.puso[m.pagadoPor] += monto;
    } else {
      t.gastos += monto; t.n++;
      if (m.pagadoPor === 'caja') t.cajaOut += monto; else if (t.puso[m.pagadoPor] !== undefined) t.puso[m.pagadoPor] += monto;
      const c = m.categoria || 'Sin categoría'; t.porCat[c] = (t.porCat[c] || 0) + monto;
      const ym = (m.fecha || '').slice(0, 7); if (ym) t.porMes[ym] = (t.porMes[ym] || 0) + monto;
      if (!t.primera || (m.fecha && m.fecha < t.primera)) t.primera = m.fecha;
    }
  }
  t.totalPuesto = t.puso.socio1 + t.puso.socio2;
  t.cajaSaldo = t.aportes - t.cajaOut;
  return t;
}

/* ===================== Render ===================== */
function renderAll() { renderNames(); renderMovs(); renderResumen(); renderAjustes(); }

function renderNames() {
  const n1 = nombre('socio1'), n2 = nombre('socio2');
  for (const id of ['rN1', 'whoN1', 'pagoN1', 'whoBtn1']) $(id).textContent = n1;
  for (const id of ['rN2', 'whoN2', 'pagoN2', 'whoBtn2']) $(id).textContent = n2;
  $('whoAv1').textContent = n1.charAt(0).toUpperCase(); $('whoAv2').textContent = n2.charAt(0).toUpperCase();
  $('brandName').textContent = state.cfg.negocio || 'Casa Nova';
  // selects de filtro
  const fc = $('fCat'); const curC = fc.value;
  fc.innerHTML = '<option value="">Categoría</option>' + state.cfg.categorias.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  fc.value = state.cfg.categorias.includes(curC) ? curC : ''; state.filters.cat = fc.value;
  const fp = $('fPag'); const curP = fp.value;
  fp.innerHTML = `<option value="">Quién pagó</option><option value="socio1">${esc(n1)}</option><option value="socio2">${esc(n2)}</option><option value="caja">Caja</option>`;
  fp.value = curP;
  document.querySelectorAll('#whoSeg .opt').forEach((b) => b.classList.toggle('active', b.dataset.who === state.who));
}

function filteredMovs() {
  const f = state.filters; const q = norm(f.q);
  return state.movs.filter((m) => {
    if (f.tipo && (m.tipo || 'gasto') !== f.tipo) return false;
    if (f.cat && m.categoria !== f.cat) return false;
    if (f.pago && m.pagadoPor !== f.pago) return false;
    if (q && !norm([m.descripcion, m.proveedor, m.nota, m.categoria].join(' ')).includes(q)) return false;
    return true;
  });
}
function renderMovs() {
  const rows = filteredMovs(); const el = $('movsList');
  if (!rows.length) {
    el.innerHTML = `<div class="card empty">${state.movs.length ? 'Nada coincide con el filtro.' : 'Todavía no hay movimientos.<br>Toca <strong>+</strong> para registrar el primer gasto.'}</div>`;
    return;
  }
  const groups = new Map();
  for (const m of rows) { const ym = (m.fecha || '').slice(0, 7) || 'sin-fecha'; if (!groups.has(ym)) groups.set(ym, []); groups.get(ym).push(m); }
  let html = '';
  for (const [ym, list] of groups) {
    const tot = list.filter((m) => m.tipo !== 'aporte').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    html += `<div class="month-head"><h3>${ym === 'sin-fecha' ? 'Sin fecha' : esc(monthLabel(ym))}</h3><span class="tot num">${money(tot)}</span></div><div class="list">`;
    for (const m of list) {
      const ap = m.tipo === 'aporte';
      const ini = ap ? '+' : esc((m.categoria || '?').charAt(0).toUpperCase());
      const meta = ap ? `Aporte a la caja · ${esc(dayLabel(m.fecha))}` : `${esc(m.categoria || 'Sin categoría')} · ${esc(dayLabel(m.fecha))}${m.proveedor ? ' · ' + esc(m.proveedor) : ''}`;
      html += `<button class="mov" data-id="${esc(m.id)}">
        <div class="ic${ap ? ' aporte' : ''}">${ini}</div>
        <div class="t"><div class="d">${esc(m.descripcion || (ap ? 'Aporte a la caja' : 'Gasto'))}</div><div class="m">${meta}</div></div>
        <div class="a num${ap ? ' aporte' : ''}">${ap ? '+' : ''}${money(m.monto)}<span class="who"><span class="payer-dot ${esc(m.pagadoPor)}"></span>${esc(nombre(m.pagadoPor))}</span></div>
      </button>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderResumen() {
  const t = totals(state.movs);
  const n1 = nombre('socio1'), n2 = nombre('socio2');
  $('rTotal').textContent = money(t.gastos);
  $('rMeta').textContent = t.n ? `${t.n} gasto${t.n === 1 ? '' : 's'} registrado${t.n === 1 ? '' : 's'}${t.primera ? ' desde el ' + dayLabel(t.primera) : ''}` : 'Sin movimientos todavía';
  $('rP1').textContent = money(t.puso.socio1); $('rP2').textContent = money(t.puso.socio2);
  const pct = (v) => t.totalPuesto ? Math.round(v / t.totalPuesto * 100) : 0;
  $('rP1s').textContent = t.totalPuesto ? `${pct(t.puso.socio1)}% de lo invertido` : '';
  $('rP2s').textContent = t.totalPuesto ? `${pct(t.puso.socio2)}% de lo invertido` : '';
  const p1 = t.totalPuesto ? t.puso.socio1 / t.totalPuesto * 100 : 50;
  $('rSplit').innerHTML = `<div class="seg s1" style="width:${p1}%"></div><div class="seg s2" style="width:${100 - p1}%"></div>`;
  $('rLegend').innerHTML = `<span><span class="swatch s1"></span>${esc(n1)} ${pct(t.puso.socio1)}%</span><span><span class="swatch s2"></span>${esc(n2)} ${pct(t.puso.socio2)}%</span>`;
  const part = state.cfg.participacion;
  const esperado1 = t.totalPuesto * (part.socio1 / 100);
  const diff1 = t.puso.socio1 - esperado1;
  let bal;
  if (!t.totalPuesto) bal = 'Aún no hay movimientos.';
  else if (Math.abs(diff1) < 1000) bal = `Están a la par según la participación ${part.socio1}/${part.socio2}.`;
  else if (diff1 > 0) bal = `<strong>${esc(n2)}</strong> le debe <strong>${money(diff1)}</strong> a ${esc(n1)} para quedar ${part.socio1}/${part.socio2}.`;
  else bal = `<strong>${esc(n1)}</strong> le debe <strong>${money(-diff1)}</strong> a ${esc(n2)} para quedar ${part.socio1}/${part.socio2}.`;
  $('rBalance').innerHTML = bal;
  $('rCajaIn').textContent = money(t.aportes); $('rCajaOut').textContent = money(t.cajaOut); $('rCajaSaldo').textContent = money(t.cajaSaldo);
  $('rCajaSaldo').style.color = t.cajaSaldo < 0 ? 'var(--danger)' : '';
  // categorías
  const cats = Object.entries(t.porCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 0;
  $('rCats').innerHTML = cats.length ? cats.map(([c, v]) => `<div class="item"><div class="name">${esc(c)}</div><div class="val num">${money(v)}<div class="pct">${t.gastos ? Math.round(v / t.gastos * 100) : 0}%</div></div><div class="track"><div class="fill" style="width:${max ? Math.max(1, v / max * 100) : 0}%"></div></div></div>`).join('') : '<div class="empty" style="padding:12px">Sin gastos todavía.</div>';
  // meses (últimos 8 con datos, en orden)
  const months = Object.keys(t.porMes).sort().slice(-8);
  const mmax = Math.max(0, ...months.map((k) => t.porMes[k]));
  $('rMonths').innerHTML = months.length ? months.map((k) => { const v = t.porMes[k]; const h = mmax ? Math.max(2, v / mmax * 100) : 2; return `<div class="col" title="${esc(monthLabel(k))}: ${money(v)}"><div class="vlabel num">${esc(shortMoney(v))}</div><div class="bar" style="height:${h}%"></div></div>`; }).join('') : '<div class="empty" style="width:100%">Sin gastos todavía.</div>';
  $('rMonthsX').innerHTML = months.map((k) => `<span>${esc(monthShort(k))} ${k.slice(2, 4)}</span>`).join('');
}
function shortMoney(v) {
  if (v >= 1e6) return (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M';
  if (v >= 1e3) return Math.round(v / 1e3).toLocaleString('es-CO') + ' mil';
  return fmtInt(v);
}

function renderAjustes() {
  if (document.activeElement && ['cfgN1', 'cfgN2', 'cfgP1', 'cfgP2', 'newCat'].includes(document.activeElement.id)) { /* no pisar lo que escribe */ } else {
    $('cfgN1').value = nombre('socio1'); $('cfgN2').value = nombre('socio2');
    $('cfgP1').value = state.cfg.participacion.socio1; $('cfgP2').value = state.cfg.participacion.socio2;
  }
  const counts = {}; for (const m of state.movs) if (m.tipo !== 'aporte') counts[m.categoria] = (counts[m.categoria] || 0) + 1;
  $('catList').innerHTML = state.cfg.categorias.map((c, i) => `<div class="catrow"><span class="n">${esc(c)}</span><span class="c">${counts[c] ? counts[c] + ' mov.' : ''}</span><button class="btn sm" data-ren="${i}">Editar</button><button class="btn sm" data-del="${i}" aria-label="Eliminar ${esc(c)}">✕</button></div>`).join('');
  const link = shareLink();
  $('shareLink').textContent = link; $('keyBox').textContent = state.key || '';
  // instalación
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('installDone').classList.toggle('hidden', !standalone);
  $('installIos').classList.toggle('hidden', standalone || !ios);
  $('installAndroid').classList.toggle('hidden', standalone || !state.installEvt);
  $('installGeneric').classList.toggle('hidden', standalone || ios || !!state.installEvt);
}
function shareLink() { return `${location.origin}${location.pathname}#k=${state.key || ''}`; }

/* ===================== Formulario ===================== */
function openForm(mov) {
  const f = state.form;
  $('fId').value = mov ? mov.id : '';
  f.tipo = mov ? (mov.tipo || 'gasto') : 'gasto';
  f.cat = mov ? (mov.categoria || '') : '';
  f.pago = mov ? (mov.pagadoPor || '') : (state.who || '');
  f.met = mov ? (mov.metodo || '') : '';
  $('fMonto').value = mov ? fmtInt(mov.monto) : '';
  $('fDesc').value = mov ? (mov.descripcion || '') : '';
  $('fFecha').value = mov ? (mov.fecha || todayISO()) : todayISO();
  $('fProv').value = mov ? (mov.proveedor || '') : '';
  $('fNota').value = mov ? (mov.nota || '') : '';
  $('moreDetails').open = !!(mov && (mov.proveedor || mov.nota || mov.metodo));
  $('sheetTitle').textContent = mov ? 'Editar movimiento' : 'Nuevo gasto';
  $('deleteBtn').classList.toggle('hidden', !mov);
  $('fErr').textContent = '';
  $('fMeta').textContent = mov ? `Registró ${nombre(mov.registradoPor) || '—'}${mov.editadoPor ? ' · editó ' + nombre(mov.editadoPor) : ''}` : '';
  if (!mov) { // sugerir categoría más usada
    const counts = {}; for (const m of state.movs) if (m.tipo !== 'aporte' && m.categoria) counts[m.categoria] = (counts[m.categoria] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; f.cat = top ? top[0] : '';
  }
  renderForm();
  $('sheetWrap').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { if (!mov) $('fMonto').focus(); }, 150);
}
function closeForm() { $('sheetWrap').classList.remove('open'); document.body.style.overflow = ''; }
function renderForm() {
  const f = state.form; const ap = f.tipo === 'aporte';
  document.querySelectorAll('#tipoSeg .opt').forEach((b) => b.classList.toggle('active', b.dataset.tipo === f.tipo));
  $('catField').classList.toggle('hidden', ap);
  $('fDescLabel').textContent = ap ? 'Descripción (opcional)' : '¿En qué se gastó?';
  $('fDesc').placeholder = ap ? 'Ej: Aporte inicial' : 'Ej: Pintura para el local';
  $('pagoLabel').textContent = ap ? '¿Quién aporta?' : '¿Quién pagó?';
  $('pagoCaja').classList.toggle('hidden', ap);
  if (ap && f.pago === 'caja') f.pago = state.who || 'socio1';
  document.querySelectorAll('#pagoSeg .opt').forEach((b) => b.classList.toggle('active', b.dataset.pago === f.pago));
  document.querySelectorAll('#metSeg .opt').forEach((b) => b.classList.toggle('active', b.dataset.met === f.met));
  if (!$('fId').value) $('sheetTitle').textContent = ap ? 'Nuevo aporte a la caja' : 'Nuevo gasto';
  const cats = state.cfg.categorias.slice(); if (f.cat && !cats.includes(f.cat)) cats.push(f.cat);
  $('fCats').innerHTML = cats.map((c) => `<button type="button" class="chip${c === f.cat ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}
function montoValue() { return Number(($('fMonto').value || '').replace(/\D/g, '')) || 0; }
async function saveForm(e) {
  e.preventDefault();
  const f = state.form; const ap = f.tipo === 'aporte';
  const monto = montoValue();
  const desc = $('fDesc').value.trim();
  if (!monto) return ($('fErr').textContent = 'Escribe el monto.');
  if (!ap && !desc) return ($('fErr').textContent = 'Escribe en qué se gastó.');
  if (!ap && !f.cat) return ($('fErr').textContent = 'Elige una categoría.');
  if (!f.pago) return ($('fErr').textContent = ap ? 'Elige quién aporta.' : 'Elige quién pagó.');
  const fecha = $('fFecha').value || todayISO();
  const data = {
    tipo: f.tipo, monto, descripcion: desc || (ap ? 'Aporte a la caja' : ''), categoria: ap ? '' : f.cat, pagadoPor: f.pago, fecha,
    metodo: f.met || '', proveedor: $('fProv').value.trim(), nota: $('fNota').value.trim()
  };
  const id = $('fId').value;
  closeForm();
  try {
    if (id) { data.editadoPor = state.who || ''; state.store.update(id, data).catch(storeFail); toast('Movimiento actualizado'); }
    else { data.registradoPor = state.who || ''; state.store.add(data).catch(storeFail); toast(ap ? 'Aporte registrado' : 'Gasto registrado'); }
  } catch (err) { storeFail(err); }
}
function storeFail(err) { console.error(err); toast('No se pudo guardar: ' + ((err && err.code) || 'error')); }
async function deleteCurrent() {
  const id = $('fId').value; if (!id) return;
  if (!confirm('¿Eliminar este movimiento? No se puede deshacer.')) return;
  closeForm();
  state.store.remove(id).catch(storeFail); toast('Movimiento eliminado');
}

/* ===================== Ajustes: acciones ===================== */
async function saveSocios() {
  const n1 = $('cfgN1').value.trim() || 'Socio 1', n2 = $('cfgN2').value.trim() || 'Socio 2';
  let p1 = Math.max(0, Math.min(100, Number($('cfgP1').value))); if (!Number.isFinite(p1)) p1 = 50;
  const p2 = 100 - p1; $('cfgP2').value = p2;
  await state.store.setConfig({ socios: { socio1: { nombre: n1 }, socio2: { nombre: n2 } }, participacion: { socio1: p1, socio2: p2 } }).catch(storeFail);
  toast('Socios guardados');
}
async function addCategory() {
  const v = $('newCat').value.trim(); if (!v) return;
  if (state.cfg.categorias.some((c) => norm(c) === norm(v))) return toast('Esa categoría ya existe');
  $('newCat').value = '';
  await state.store.setConfig({ categorias: [...state.cfg.categorias, v] }).catch(storeFail);
  toast('Categoría agregada');
}
async function renameCategory(i) {
  const old = state.cfg.categorias[i]; const v = prompt('Nuevo nombre de la categoría', old); if (!v || v.trim() === old) return;
  const nv = v.trim(); const cats = state.cfg.categorias.slice(); cats[i] = nv;
  await state.store.setConfig({ categorias: cats }).catch(storeFail);
  for (const m of state.movs) if (m.categoria === old) state.store.update(m.id, { categoria: nv }).catch(storeFail);
  toast('Categoría actualizada');
}
async function deleteCategory(i) {
  const c = state.cfg.categorias[i];
  const used = state.movs.filter((m) => m.categoria === c).length;
  if (!confirm(used ? `"${c}" tiene ${used} movimiento(s). Se quita de la lista pero esos movimientos la conservan. ¿Continuar?` : `¿Quitar la categoría "${c}"?`)) return;
  await state.store.setConfig({ categorias: state.cfg.categorias.filter((_, j) => j !== i) }).catch(storeFail);
}
function exportCsv() {
  const head = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Monto', 'Pagó', 'Método', 'Proveedor', 'Nota', 'Registró'];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = state.movs.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map((m) => [m.fecha, m.tipo === 'aporte' ? 'Aporte a caja' : 'Gasto', m.descripcion, m.categoria, Math.round(m.monto || 0), nombre(m.pagadoPor), m.metodo, m.proveedor, m.nota, nombre(m.registradoPor)].map(q).join(';'));
  const csv = '﻿' + head.map(q).join(';') + '\r\n' + rows.join('\r\n');
  const file = new File([csv], `casanova-gastos-${todayISO()}.csv`, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Casa Nova Gastos' }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function copyText(t, msg) {
  try { await navigator.clipboard.writeText(t); toast(msg); }
  catch { prompt('Copia este texto:', t); }
}

/* ===================== Eventos ===================== */
function bind() {
  // tabs
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
    $('fab').classList.toggle('hidden', b.dataset.view === 'ajustes');
    window.scrollTo({ top: 0 });
  }));
  $('fab').addEventListener('click', () => openForm(null));
  $('movsList').addEventListener('click', (e) => { const b = e.target.closest('.mov'); if (!b) return; const m = state.movs.find((x) => x.id === b.dataset.id); if (m) openForm(m); });
  // filtros
  $('filters').addEventListener('click', (e) => { const b = e.target.closest('[data-f-tipo]'); if (!b) return; state.filters.tipo = b.dataset.fTipo; document.querySelectorAll('[data-f-tipo]').forEach((x) => x.classList.toggle('active', x === b)); renderMovs(); });
  $('fCat').addEventListener('change', (e) => { state.filters.cat = e.target.value; e.target.classList.toggle('active', !!e.target.value); renderMovs(); });
  $('fPag').addEventListener('change', (e) => { state.filters.pago = e.target.value; e.target.classList.toggle('active', !!e.target.value); renderMovs(); });
  $('q').addEventListener('input', (e) => { state.filters.q = e.target.value; renderMovs(); });
  // sheet
  $('closeSheet').addEventListener('click', closeForm); $('scrim').addEventListener('click', closeForm);
  $('form').addEventListener('submit', saveForm);
  $('deleteBtn').addEventListener('click', deleteCurrent);
  $('tipoSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-tipo]'); if (!b) return; state.form.tipo = b.dataset.tipo; renderForm(); });
  $('pagoSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-pago]'); if (!b) return; state.form.pago = b.dataset.pago; renderForm(); });
  $('metSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-met]'); if (!b) return; state.form.met = state.form.met === b.dataset.met ? '' : b.dataset.met; renderForm(); });
  $('fCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; state.form.cat = b.dataset.cat; renderForm(); });
  $('fMonto').addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 12); e.target.value = d ? fmtInt(Number(d)) : ''; });
  // ajustes
  $('whoSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-who]'); if (!b) return; state.who = b.dataset.who; localStorage.setItem(LS.who, state.who); renderNames(); toast('Listo'); });
  $('saveSocios').addEventListener('click', saveSocios);
  $('cfgP1').addEventListener('input', () => { const p = Number($('cfgP1').value); if (Number.isFinite(p)) $('cfgP2').value = Math.max(0, Math.min(100, 100 - p)); });
  $('cfgP2').addEventListener('input', () => { const p = Number($('cfgP2').value); if (Number.isFinite(p)) $('cfgP1').value = Math.max(0, Math.min(100, 100 - p)); });
  $('addCat').addEventListener('click', addCategory);
  $('newCat').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } });
  $('catList').addEventListener('click', (e) => { const r = e.target.closest('[data-ren]'); if (r) return renameCategory(Number(r.dataset.ren)); const d = e.target.closest('[data-del]'); if (d) return deleteCategory(Number(d.dataset.del)); });
  $('copyLink').addEventListener('click', () => copyText(shareLink(), 'Link copiado'));
  $('copyKey').addEventListener('click', () => copyText(state.key, 'Clave copiada'));
  $('shareBtn').addEventListener('click', async () => {
    const url = shareLink();
    if (navigator.share) { try { await navigator.share({ title: 'Casa Nova Gastos', text: 'Libreta de gastos de Casa Nova. Abre este link y guárdalo en tu celular:', url }); } catch {} }
    else copyText(url, 'Link copiado');
  });
  $('exportCsv').addEventListener('click', exportCsv);
  $('themeSel').addEventListener('change', (e) => { localStorage.setItem(LS.theme, e.target.value); setTheme(e.target.value); });
  $('logout').addEventListener('click', () => { if (!confirm('¿Salir de esta libreta en este celular?')) return; localStorage.removeItem(LS.key); location.hash = ''; location.reload(); });
  $('installBtn').addEventListener('click', async () => { const ev = state.installEvt; if (!ev) return; ev.prompt(); await ev.userChoice.catch(() => {}); state.installEvt = null; renderAjustes(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvt = e; renderAjustes(); });
  window.addEventListener('appinstalled', () => { state.installEvt = null; renderAjustes(); toast('App instalada'); });
  // gates
  $('enterKey').addEventListener('click', () => tryKey($('keyInput').value));
  $('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryKey($('keyInput').value); });
  $('pasteKey').addEventListener('click', async () => { try { const t = await navigator.clipboard.readText(); $('keyInput').value = t.trim(); tryKey(t); } catch { $('keyInput').focus(); toast('Mantén presionado el campo y elige Pegar'); } });
  $('newLedger').addEventListener('click', () => { if (!confirm('Se creará una libreta nueva y vacía con una clave nueva. ¿Continuar?')) return; openLedger(randomKey()); });
  document.querySelectorAll('#gateWho [data-who]').forEach((b) => b.addEventListener('click', () => { state.who = b.dataset.who; localStorage.setItem(LS.who, state.who); closeGate('gateWho'); renderNames(); }));
  // atajos
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('sheetWrap').classList.contains('open')) closeForm(); });
  window.addEventListener('hashchange', () => { const k = readKeyFromUrl(); if (k && KEY_RE.test(k) && k !== state.key) location.reload(); });
}
function tryKey(raw) {
  let k = (raw || '').trim();
  const m = k.match(/[#&]k=([A-Za-z0-9-]+)/); if (m) k = m[1];
  if (!KEY_RE.test(k)) { $('keyErr').textContent = 'Esa clave no parece válida. Pide el link a tu socio.'; return; }
  $('keyErr').textContent = ''; location.hash = 'k=' + k; openLedger(k);
}

/* ===================== Service worker ===================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Hay una versión nueva. Cierra y vuelve a abrir la app.', 5000); });
      });
    } catch (e) { console.warn('SW', e); }
  });
}

bind();
boot();
