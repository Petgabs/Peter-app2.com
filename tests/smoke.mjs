/* Student Report Studio — smoke tests (jsdom + mocked cloud APIs)
   Run:  cd tests && npm install && npm test        */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SB = 'https://schoolcloud.supabase.co', ANON = 'anon_key_PUBLIC_abc123', GH_TOKEN = 'github_pat_SHARED_999';
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const report = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) { fails++; process.exitCode = 1; }
};

/* ------------------------------------------------------------------ */
/* Shared jsdom boot                                                   */
/* ------------------------------------------------------------------ */
function boot(fetchMock, seed = {}, globals = {}) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://school.example/app/', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.scrollTo = () => {}; w.confirm = () => true; w.alert = () => {}; w.print = () => {};
  w.fetch = fetchMock;
  for (const [k, v] of Object.entries(globals)) w[k] = v;
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
  for (const s of [...d.querySelectorAll('script:not([type])')]) w.eval(s.textContent);
  const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
  return {
    w, d, q, qa, errs,
    click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    submit: f => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })),
    store: () => JSON.parse(w.localStorage.getItem('bzgfls-year11-preliminary-report-studio-v1')),
    ls: k => w.localStorage.getItem(k),
    loginLocal(role) {
      this.click(this.qa('[data-action="login-as"]').find(b => b.dataset.role === role));
      const f = this.q('#login-form');
      f.querySelector('[name="username"]').value = role === 'admin' ? 'hsc-year11-admin' : 'hsc-year11';
      f.querySelector('[name="password"]').value = role === 'admin' ? 'bzfls-hsc#-admin' : 'bzfls-hsc#';
      this.submit(f);
    },
    loginLocalAdminInModal() {
      const f = this.q('#admin-login-form');
      f.querySelector('[name="username"]').value = 'hsc-year11-admin';
      f.querySelector('[name="password"]').value = 'bzfls-hsc#-admin';
      this.submit(f);
    },
    async loginCloud(user, pass) {
      this.click(this.q('[data-role="cloud"]'));
      const f = this.q('#login-form');
      f.querySelector('[name="username"]').value = user;
      f.querySelector('[name="password"]').value = pass;
      this.submit(f);
      await wait(900);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Simulated Supabase (GoTrue + PostgREST + website file + GitHub API) */
/* ------------------------------------------------------------------ */
function sbWorld(opts = {}) {
  const W = {
    users: new Map(), profiles: new Map(), files: new Map(), tokens: new Map(), calls: [], conflicts: new Map(),
    appConfig: opts.appConfig || null, publishedSite: opts.publishedSite || null,
    appConfigMissing: !!opts.appConfigMissing, profile500: !!opts.profile500, appConfig500: !!opts.appConfig500, assignments: new Map(), assignmentsFail: !!opts.assignmentsFail, siteWritable: opts.siteWritable !== false, readFails: opts.readFails || 0, ghFiles: new Map(),
  };
  let seq = 1, stamps = 1;
  const nextStamp = () => new Date(Date.now() + (stamps++)).toISOString();
  const respond = (s, j) => ({ ok: s >= 200 && s < 300, status: s, json: async () => j });
  const addUser = (email, password, meta) => {
    const id = 'user_' + email.replace(/[^a-z0-9]/gi, '_');
    W.users.set(email, { id, password, meta });
    W.profiles.set(id, { role: meta.role || 'teacher', username: meta.username, display_name: meta.display_name });
    return id;
  };
  W.wangId = addUser('wang@school.test', 'TeachPass1!', { username: 'hsc-wang', display_name: 'Ms Wang', role: 'teacher' });
  W.adminId = addUser('admin@school.test', 'AdminPass1!', { username: 'hsc-admin', display_name: 'Coordinator', role: 'admin' });
  const Y = new Date(Date.now() - 864e5).toISOString();
  W.files.set('data/roster.json', { content: { students: [{ id: 'st_remote01', pinyin: 'Chen Xiaoming', english: 'Ming', classTeacher: '', subjectIds: ['sub_eald'], updatedAt: Y }], studentTombstones: {} }, updated_at: Y });

  W.fetch = async (url, o = {}) => {
    const u = String(url), m = (o.method || 'GET').toUpperCase();
    const h = o.headers || {};
    W.calls.push({ method: m, url: u, body: o.body, auth: h.Authorization, apikey: h.apikey });
    if (u === 'cloud-config.json' || (u.endsWith('/cloud-config.json') && !u.includes('api.github.com')))
      return W.publishedSite ? respond(200, JSON.parse(W.publishedSite)) : respond(404, {});
    if (/^https:\/\/api\.github\.com\/user$/.test(u)) return respond(200, { login: 'petgabs82' });
    if (/https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u)) return respond(200, { private: true, permissions: { push: true } });
    if (u.startsWith('https://api.github.com/repos/Petgabs/report-data/contents/')) {
      const ghPath = decodeURIComponent(u.split('/contents/')[1].split('?')[0]);
      if (m === 'GET') {
        const f = W.ghFiles.get(ghPath);
        return f ? respond(200, { sha: f.sha, content: Buffer.from(f.text, 'utf8').toString('base64') }) : respond(404, {});
      }
      if (m === 'PUT') {
        const body = JSON.parse(o.body);
        W.ghFiles.set(ghPath, { sha: 'g' + (W.ghSeq = (W.ghSeq || 0) + 1), text: Buffer.from(body.content, 'base64').toString('utf8') });
        return respond(200, { content: { sha: W.ghFiles.get(ghPath).sha } });
      }
    }
    if (u.startsWith('https://api.github.com/repos/') && u.includes('/contents/cloud-config.json')) {
      if (!W.siteWritable) return respond(403, { message: 'Resource not accessible by personal access token' });
      if (m === 'GET') return W.publishedSite ? respond(200, { sha: 'site1' }) : respond(404, {});
      const body = JSON.parse(o.body);
      W.publishedSite = Buffer.from(body.content, 'base64').toString('utf8');
      W.siteWrites = (W.siteWrites || 0) + 1;
      return respond(200, { content: { sha: 'site2' } });
    }
    if (u.includes('/auth/v1/health')) return respond(200, {});
    if (u.includes('/auth/v1/token?grant_type=password')) {
      const { email, password } = JSON.parse(o.body);
      for (const [em, usr] of W.users) if (em === email && usr.password === password) {
        const at = 'at_' + seq++, rt = 'rt_' + seq++;
        W.tokens.set(at, { id: usr.id, email: em });
        return respond(200, { access_token: at, refresh_token: rt, expires_in: 3600, user: { id: usr.id, email: em } });
      }
      return respond(400, { error_description: 'invalid_grant' });
    }
    if (u.includes('/auth/v1/token?grant_type=refresh_token')) {
      const rt = JSON.parse(o.body).refresh_token;
      if (!String(rt).startsWith('rt_')) return respond(400, { error_description: 'bad_refresh' });
      const at = 'at_' + seq++;
      W.tokens.set(at, { id: W.wangId, email: 'wang@school.test' });
      return respond(200, { access_token: at, refresh_token: rt, expires_in: 3600 });
    }
    if (u.includes('/auth/v1/logout')) return respond(204, {});
    if (u.includes('/rest/v1/rpc/email_for_username')) {
      if (h.apikey !== ANON) return respond(401, {});
      const name = JSON.parse(o.body).u;
      for (const [em, usr] of W.users) if (String(usr.meta.username).toLowerCase() === String(name || '').toLowerCase()) return respond(200, em);
      return respond(200, null);
    }
    const bearer = String(h.Authorization || '').replace(/^Bearer /, '');
    const who = bearer === 'at_seed' ? { id: W.adminId, email: 'admin@school.test' } : W.tokens.get(bearer);
    if (!who) return respond(401, { message: 'JWT required' });
    const role = (W.profiles.get(who.id) || {}).role || 'teacher';
    if (u.includes('/rest/v1/app_config')) {
      if (W.appConfigMissing) return respond(404, { message: 'relation "public.app_config" does not exist' });
      if (m === 'GET') { if (W.appConfig500) return respond(500, { code: '42P17', message: 'infinite recursion detected in policy for relation "profiles"' }); return respond(200, W.appConfig ? [{ value: W.appConfig }] : []); } // staff may read the registry
      if (m === 'POST') {
        if (role !== 'admin') return respond(403, { message: 'row-level security' });
        W.appConfig = JSON.parse(o.body).value; W.appConfigWrites = (W.appConfigWrites || 0) + 1;
        return respond(201, []);
      }
    }
    if (u.includes('/rest/v1/subject_teachers')) {
      if (W.assignmentsFail) return respond(500, { message: 'assignments unavailable' });
      if (m === 'GET') { const rows = []; for (const [sid, set] of W.assignments) for (const uid of set) rows.push({ subject_id: sid, user_id: uid }); return respond(200, rows); }
      if (role !== 'admin') return respond(403, { message: 'row-level security' });
      if (m === 'DELETE') { const sid = decodeURIComponent((u.match(/subject_id=eq\.([^&]+)/) || [])[1] || ''); W.assignments.delete(sid); return respond(204, {}); }
      if (m === 'POST') { for (const r of JSON.parse(o.body)) { if (!W.assignments.has(r.subject_id)) W.assignments.set(r.subject_id, new Set()); W.assignments.get(r.subject_id).add(r.user_id); } return respond(201, []); }
    }
    if (u.includes('/rest/v1/profiles')) {
      if (W.profile500) return respond(500, { code: '42P17', message: 'infinite recursion detected in policy for relation "profiles"' });
      const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
      if (!id) return respond(200, [...W.profiles.entries()].map(([pid, p]) => ({ id: pid, ...p })));
      const p = W.profiles.get(id);
      return respond(200, p ? [{ id, ...p }] : []);
    }
    if (u.includes('/rest/v1/report_files')) {
      if (m !== 'GET') {
        let wpath = decodeURIComponent((u.match(/path=eq\.([^&]+)/) || [])[1] || '');
        if (!wpath && o.body) { try { wpath = JSON.parse(o.body).path || ''; } catch (e) {} }
        const wm = /^data\/reports\/(.+)\.json$/.exec(wpath), wset = wm && W.assignments.get(wm[1]);
        if (wset && wset.size && role !== 'admin' && !wset.has(who.id)) return respond(403, { message: 'subject assignment: not your subject' });
      }
      if (m === 'GET' && u.includes('select=path')) {
        if (W.readFails > 0) { W.readFails--; return respond(503, { message: 'unavailable' }); }
        return respond(200, [...W.files.keys()].map(p => ({ path: p })));
      }
      if (m === 'GET') {
        if (W.readFails > 0) { W.readFails--; return respond(503, { message: 'unavailable' }); }
        const p = decodeURIComponent((u.match(/path=eq\.([^&]+)/) || [])[1] || ''), row = W.files.get(p);
        return respond(200, row ? [{ path: p, content: row.content, updated_at: row.updated_at }] : []);
      }
      if (m === 'PATCH') {
        const mm = u.match(/path=eq\.([^&]+)&updated_at=eq\.([^&]+)/);
        const p = decodeURIComponent(mm ? mm[1] : ''), base = decodeURIComponent(mm ? mm[2] : ''), row = W.files.get(p);
        const budget = W.conflicts.get(p) || 0;
        if (budget > 0) {
          W.conflicts.set(p, budget - 1);
          const rival = { ...(row ? row.content : {}) };
          rival.entries = { ...(rival.entries || {}), st_rival: { overallGrade: 'B', comment: 'RIVAL DEVICE ENTRY', updatedAt: nextStamp() } };
          W.files.set(p, { content: rival, updated_at: nextStamp() });
          return respond(200, []);
        }
        if (!row || row.updated_at !== base) return respond(200, []);
        const body = JSON.parse(o.body);
        W.files.set(p, { content: body.content, updated_at: body.updated_at });
        return respond(200, [{ path: p, content: body.content, updated_at: body.updated_at }]);
      }
      if (m === 'POST') {
        const body = JSON.parse(o.body);
        W.files.set(body.path, { content: body.content, updated_at: body.updated_at });
        return respond(201, []);
      }
    }
    return respond(404, { message: 'unmatched ' + u });
  };
  return W;
}

const SESSION_SEED = () => ({
  'bzgfls-report-studio-supabase-v1': JSON.stringify({ url: SB, anon: ANON, enabled: true }),
  'bzgfls-report-studio-cloud-v1': JSON.stringify({ backend: 'supabase' }),
});

/* ================================================================== */
/* 0. PAGE WEIGHT: external libraries and image files                  */
/* ================================================================== */
console.log('\n— Page weight —');
const htmlBytes = Buffer.byteLength(html, 'utf8');
report('index.html no longer embeds the PDF libraries', !/html2canvas 1\.4\.1/.test(html) && htmlBytes < 300000, (htmlBytes / 1024).toFixed(0) + ' KB');
const vendorSrc = fs.readFileSync(new URL('../vendor/pdf-libs.js', import.meta.url), 'utf8');
report('vendor/pdf-libs.js carries the PDF bundle', vendorSrc.length > 500000 && vendorSrc.includes('html2canvas') && vendorSrc.includes('jspdf'), (vendorSrc.length / 1024).toFixed(0) + ' KB');
report('The download path loads the bundle on demand', /if\(!\(await ensurePdfLibs\(\)\)\)/.test(html) && /el\.src='vendor\/pdf-libs\.js'/.test(html));
const seedAssets = JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).assets;
report('School images are files, not inline data URLs', seedAssets.emblem === 'assets/emblem.png' && seedAssets.schoolName === 'assets/school-name.png' && seedAssets.watermark === 'assets/watermark.png', JSON.stringify(seedAssets));
// execute the extracted bundle in a bare window: proves the file is complete and
// still defines the renderer globals the app waits for
{
  const libDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  libDom.window.TextEncoder = TextEncoder; libDom.window.TextDecoder = TextDecoder; // jsdom lacks them; every browser has them
  libDom.window.eval(vendorSrc);
  report('The extracted bundle still defines the PDF renderer',
    typeof libDom.window.jspdf?.jsPDF === 'function' && typeof libDom.window.html2canvas === 'function',
    'jsPDF=' + typeof libDom.window.jspdf?.jsPDF + ' html2canvas=' + typeof libDom.window.html2canvas);
}
for (const f of ['assets/emblem.png', 'assets/school-name.png', 'assets/watermark.png']) {
  const buf = fs.readFileSync(new URL('../' + f, import.meta.url));
  report(f + ' exists as a real PNG', buf.length > 1000 && buf.subarray(1, 4).toString() === 'PNG', buf.length + ' bytes');
}

/* ================================================================== */
/* 1. LOCAL APP REGRESSION (no cloud)                                  */
/* ================================================================== */
console.log('\n— App basics —');
{
  const app = boot(async () => { throw new TypeError('offline test'); });
  await wait(200);
  report('Sign-in gate on first load', app.q('#app').innerHTML.includes('login-shell'));
  app.loginLocal('teacher');
  report('Local teacher login works', app.qa('.nav-btn').length === 6, 'nav=' + app.qa('.nav-btn').length);
  for (const v of ['overview', 'subjects', 'reports', 'help']) {
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === v));
    report(`View "${v}" renders`, (app.q('main')?.innerHTML || '').length > 200);
  }
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  await wait(60);
  report('Teacher opening Cloud sync gets the admin login', !!app.q('#admin-login-form'));
  app.loginLocalAdminInModal();
  await wait(150);
  report('Admin login opens Cloud sync', !!app.q('#sb-form'));
  report('Unconfigured cloud is explained, not just "not connected"', (app.q('#sync-status-text').textContent || '').includes('Cloud sync is off'), app.q('#sync-status-text').textContent);
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  report('Subjects view renders for admin', !!app.q('[data-action="open-subject"]'));
  report('No uncaught errors (offline app)', app.errs.length === 0, app.errs[0] || '');
}

/* ================================================================== */
/* 2. SCHOOL CLOUD: setup, publish, devices, teacher, statuses         */
/* ================================================================== */
console.log('\n— School cloud (Supabase) —');
const world = sbWorld();
const A = boot(world.fetch);
await wait(250);
A.q('#cs-url').value = SB; A.q('#cs-anon').value = ANON;
A.submit(A.q('#cloud-setup-form'));
report('First-time setup reveals School account login', !!A.q('[data-role="cloud"]'));
await A.loginCloud('hsc-admin', 'AdminPass1!');
report('School admin signs in', A.q('.topbar-meta').textContent.includes('Admin session'));
A.click(A.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
report('Cloud sync opens for the school admin', !!A.q('#sb-form') && !!A.q('#registry-text'));
A.submit(A.q('#sb-form'));
await wait(700);
report('Save and connect stores the URL + anon key', JSON.parse(A.ls('bzgfls-report-studio-supabase-v1')).url === SB);
report('Save and connect publishes the admin registry', !!world.appConfig && world.appConfig.supabaseUrl === SB);
report('Status reads connected', (A.q('#sync-status-text').textContent || '').includes('Connected'), A.q('#sync-status-text').textContent);

// second device: configured but signed out
world.appConfig.githubToken = GH_TOKEN;
const B = boot(world.fetch, SESSION_SEED());
await wait(300);
report('Configured device offers school sign-in on the gate', !!B.q('[data-role="cloud"]'));
B.loginLocal('admin');
await wait(150);
report('Configured-but-signed-out device says "sign in", not "not connected"', B.q('#sync-pill').textContent.includes('sign in'), B.q('#sync-pill').textContent);
B.click(B.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
report('Configured cloud is described accurately on the sync page', (B.q('#sync-status-text').textContent || '').includes('sign in'), B.q('#sync-status-text').textContent);

// teacher device: role gating + data sync
const C = boot(world.fetch, SESSION_SEED());
await wait(300);
await C.loginCloud('hsc-wang', 'TeachPass1!');
report('Teacher school sign-in works', C.q('#app').innerHTML.includes('app-shell'));
report('Teacher is given the repository token from the school cloud', JSON.parse(C.ls('bzgfls-report-studio-github-v1') || '{}').token === GH_TOKEN);
report('GitHub cloud turns on automatically for the teacher', C.q('#sync-pill').textContent.includes('GitHub'), C.q('#sync-pill').textContent);
C.click(C.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
await wait(60);
report('Cloud sync is admin-gated for teachers', !!C.q('#admin-login-form'));

C.click(C.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
C.click(C.q('[data-action="open-subject"]'));
C.click(C.q('[data-action="edit-entry"]'));
const ef = C.q('#teacher-report-form');
C.qa('#teacher-report-form select[name^="crit_"]').forEach(s => s.value = 'A');
ef.querySelector('select[name="overallGrade"]').value = 'B';
C.qa('#teacher-report-form select[name^="profile_"]').forEach(s => s.value = 'Often');
ef.querySelector('textarea[name="comment"]').value = 'SCHOOL CLOUD COMMENT — well organised.';
C.submit(ef);
await wait(1600);
const writes = world.calls.filter(c => c.url.includes('/rest/v1/report_files') && (c.method === 'PATCH' || c.method === 'POST'));
report('Teacher saves write to the school database', writes.length >= 1, writes.length + ' writes');
const row = JSON.parse(writes[writes.length - 1].body);
report('Writes record the author', row.updated_by === world.wangId);
report('Writes never contain the repository token', !JSON.stringify(row.content).includes(GH_TOKEN));

world.conflicts.set('data/reports/sub_eald.json', 1);
C.click(C.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
C.click(C.q('[data-action="open-subject"]'));
C.click(C.q('[data-action="edit-entry"]'));
const ef2 = C.q('#teacher-report-form');
ef2.querySelector('textarea[name="comment"]').value = 'SECOND LOCAL EDIT.';
C.submit(ef2);
await wait(1600);
const merged = world.files.get('data/reports/sub_eald.json').content;
report('Concurrent writes merge both sides', JSON.stringify(merged).includes('RIVAL DEVICE ENTRY') && JSON.stringify(merged).includes('SECOND LOCAL EDIT'));
report('Saves are mirrored to the GitHub repository automatically', world.ghFiles.size > 0 && [...world.ghFiles.values()].some(f => f.text.includes('SECOND LOCAL EDIT')), [...world.ghFiles.keys()].join(', ').slice(0, 80));
C.click(C.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
if (C.q('#admin-login-form')) { C.q('#admin-login-form').querySelector('[name="username"]').value = 'hsc-year11-admin'; C.q('#admin-login-form').querySelector('[name="password"]').value = 'bzfls-hsc#-admin'; C.submit(C.q('#admin-login-form')); await wait(150); }
report('Cloud sync page reports GitHub mirroring on', /On/.test(C.q('#sync-mirror-text').textContent || ''), C.q('#sync-mirror-text').textContent);

// a device that already holds the repository token: local teacher login turns GitHub on
const T = boot(world.fetch, {
  'bzgfls-report-studio-github-v1': JSON.stringify({ repo: 'Petgabs/report-data', branch: 'main', token: GH_TOKEN, enabled: true }),
});
await wait(250);
T.loginLocal('teacher');
await wait(900);
report('Local teacher login activates the GitHub cloud automatically', T.q('#sync-pill').textContent === 'Cloud: GitHub', T.q('#sync-pill').textContent);
report('Local teacher login syncs through GitHub', world.ghFiles.size > 0, [...world.ghFiles.keys()].slice(0, 3).join(', '));

/* ================================================================== */
/* 2b. OFFLINE BANNER + BACKGROUND REFRESH                             */
/* ================================================================== */
console.log('\n— Offline and background refresh —');
const N = boot(world.fetch, SESSION_SEED());
await wait(300);
report('Offline banner is hidden while connected', N.q('#net-banner').hidden);
N.w.dispatchEvent(new N.w.Event('offline'));
report('Going offline warns the teacher', N.q('#net-banner').hidden === false && /offline/i.test(N.q('#net-banner').textContent), N.q('#net-banner').textContent);
report('Offline shifts the layout clear of the banner', N.d.body.classList.contains('offline'));
N.w.dispatchEvent(new N.w.Event('online'));
report('Coming back online clears the banner', N.q('#net-banner').hidden === true && !N.d.body.classList.contains('offline'));
report('No uncaught errors (offline handling)', N.errs.length === 0, N.errs.join(' | '));

const R = boot(world.fetch, SESSION_SEED(), { __AUTO_REFRESH_MS__: 250 });
await wait(300);
await R.loginCloud('hsc-wang', 'TeachPass1!');
report('Auto-refresh device signs in with the school account', R.q('#app').innerHTML.includes('app-shell'));
const rivalStamp = new Date(Date.now() + 60000).toISOString();
world.files.set('data/reports/sub_eald.json', {
  content: { version: 1, updatedAt: rivalStamp, subjectId: 'sub_eald', entries: { st_remote01: { criteriaGrades: ['B', 'B', 'B', 'B', 'B'], overallGrade: 'C', profile: ['Often', 'Often', 'Often', 'Often'], comment: 'WRITTEN ON ANOTHER DEVICE', updatedAt: rivalStamp } }, entryTombstones: {} },
  updated_at: rivalStamp,
});
await wait(1400);
report('Background refresh pulls another device’s work', JSON.stringify(R.store()).includes('WRITTEN ON ANOTHER DEVICE'));
report('Background refresh tells the teacher it happened', /Newer report data/.test(R.q('#toast').textContent || ''), R.q('#toast').textContent);
report('No uncaught errors (background refresh)', R.errs.length === 0, R.errs.join(' | '));

/* ================================================================== */
/* 3. STATUS MESSAGING (the reported "cloud error / not connected")    */
/* ================================================================== */
console.log('\n— Cloud status messaging —');
const failing = sbWorld({ readFails: 3 });
const D = boot(failing.fetch, {
  ...SESSION_SEED(),
  'bzgfls-report-studio-sb-session-v1': JSON.stringify({ access_token: 'at_seed', refresh_token: 'rt_seed', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'user_admin_school_test', email: 'admin@school.test' }, role: 'admin', username: 'hsc-admin', display_name: 'Coordinator' }),
});
await wait(900);
report('A failed sync shows an error with a reason', D.q('#sync-pill').textContent === 'Cloud: error', D.q('#sync-pill').textContent);
D.click(D.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
await wait(60);
if (D.q('#sb-form')) {
  D.submit(D.q('#sb-form'));
  await wait(900);
  report('Reconnecting clears the stale error', D.q('#sync-pill').textContent !== 'Cloud: error', D.q('#sync-pill').textContent);
}

const partial = sbWorld({ appConfigMissing: true });
const E = boot(partial.fetch, SESSION_SEED());
await wait(300);
await E.loginCloud('hsc-admin', 'AdminPass1!');
E.click(E.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
E.submit(E.q('#sb-form'));
await wait(700);
report('Missing app_config gives the SQL fix', (E.q('#registry-text').textContent || '').includes('re-run supabase-setup.sql'), (E.q('#registry-text').textContent || '').slice(0, 70));
report('Missing app_config does not mark the cloud as errored', E.q('#sync-pill').textContent === 'Cloud: school', E.q('#sync-pill').textContent);

const noSite = sbWorld({ siteWritable: false });
const F = boot(noSite.fetch, SESSION_SEED());
await wait(300);
await F.loginCloud('hsc-admin', 'AdminPass1!');
F.click(F.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
F.q('#sync-token').value = GH_TOKEN;
F.submit(F.q('#sync-form'));
await wait(700);
report('Website publish failure explains itself', /not published/.test(F.q('#registry-text').textContent || ''), (F.q('#registry-text').textContent || '').slice(0, 80));
report('Website publish failure is not a cloud error', F.q('#sync-pill').textContent !== 'Cloud: error', F.q('#sync-pill').textContent);
report('School cloud publish still succeeded', !!noSite.appConfig);
const allErrs = [...A.errs, ...B.errs, ...C.errs, ...D.errs, ...E.errs, ...F.errs];
report('No uncaught errors across cloud tests', allErrs.length === 0, allErrs[0] || '');

/* ================================================================== */
/* 4. GITHUB BACKEND                                                   */
/* ================================================================== */
console.log('\n— GitHub repository backend —');
{
  const files = new Map(); let shaN = 1, siteCfg = null;
  const conflicts = new Map();
  const set = (p, o) => files.set(p, { sha: 'sha' + shaN++, text: JSON.stringify(o, null, 2) + '\n' });
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const unb64 = s => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8');
  const fetchMock = async (url, o = {}) => {
    const m = (o.method || 'GET').toUpperCase(), u = String(url);
    const r = (s, j) => ({ ok: s >= 200 && s < 300, status: s, json: async () => j });
    if (/api\.github\.com\/user$/.test(u)) return r(200, { login: 'teacher-test' });
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u)) return r(200, { name: 'report-data', private: true, permissions: { push: true } });
    const mm = u.match(/contents\/([^?]+)(\?|$)/);
    if (mm) {
      const p = decodeURIComponent(mm[1]);
      if (m === 'GET') {
        if (p === 'data/reports') return r(200, [...files.keys()].filter(x => x.startsWith('data/reports/')).map(x => ({ name: x.split('/').pop() })));
        const f = files.get(p);
        return f ? r(200, { sha: f.sha, content: b64(f.text) }) : r(404, {});
      }
      if (m === 'PUT') {
        const body = JSON.parse(o.body), f = files.get(p), budget = conflicts.get(p) || 0;
        if (budget) { conflicts.set(p, budget - 1); return r(409, {}); }
        if (f && body.sha !== f.sha) return r(409, {});
        const sha = 'sha' + shaN++;
        files.set(p, { sha, text: unb64(body.content) });
        if (p === 'cloud-config.json') siteCfg = unb64(body.content);
        return r(200, { content: { sha } });
      }
    }
    return r(404, {});
  };
  const Y = new Date(Date.now() - 864e5).toISOString();
  set('data/roster.json', { version: 1, students: [{ id: 'st_remote01', pinyin: 'Chen Xiaoming', english: 'Ming', classTeacher: '', subjectIds: ['sub_eald'], updatedAt: Y }], studentTombstones: {} });
  const G = boot(fetchMock);
  await wait(150);
  G.loginLocal('admin');
  G.click(G.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  G.click(G.q('[data-action="cloud-check"]'));
  await wait(500);
  report('Setup check reports the missing website file', /MISSING/.test(G.q('#cloud-diagnosis').textContent), (G.q('#cloud-diagnosis').textContent || '').slice(0, 60));
  G.q('#sync-token').value = 'github_pat_TEST123';
  G.submit(G.q('#sync-form'));
  await wait(900);
  report('GitHub settings save and activate', G.q('#sync-pill').textContent.includes('GitHub'), G.q('#sync-pill').textContent);
  report('cloud-config.json is published on save', !!siteCfg && JSON.parse(siteCfg).githubRepo === 'Petgabs/report-data');
  report('Website file never contains the token', !!siteCfg && !siteCfg.includes('TEST123'));
  report('Remote roster pulled', G.store().students.some(s => s.pinyin === 'Chen Xiaoming'));
  G.click(G.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  G.click(G.q('[data-action="sync-test"]'));
  await wait(400);
  const testText = G.q('#sync-test-result').textContent || '';
  report('Token test confirms sign-in + write access', /GitHub token works/.test(testText) && /read \+ write/.test(testText), testText.split('\n')[0]);
  report('Token test reports the published website file', /cloud-config\.json is present/.test(testText), (testText.split('\n').pop() || '').slice(0, 60));
  G.click(G.q('[data-action="cloud-check"]'));
  await wait(500);
  const diag = G.q('#cloud-diagnosis').textContent || '';
  report('Setup check confirms the cloud is complete', /cloud-config\.json is published/.test(diag) && /GitHub token signs in as @teacher-test/.test(diag), diag.split('\n')[0]);
  const pupil = G.store().students.find(s => s.pinyin === 'Chen Xiaoming');
  G.click(G.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  G.click(G.q('[data-action="open-subject"]'));
  G.click(G.qa('[data-action="edit-entry"]').find(b => b.closest('tr')?.textContent.includes('Ming')));
  const gf = G.q('#teacher-report-form');
  G.qa('#teacher-report-form select[name^="crit_"]').forEach(s => s.value = 'A');
  gf.querySelector('select[name="overallGrade"]').value = 'B';
  G.qa('#teacher-report-form select[name^="profile_"]').forEach(s => s.value = 'Consistently');
  gf.querySelector('textarea[name="comment"]').value = 'GITHUB COMMENT.';
  G.submit(gf);
  await wait(1700);
  report('Report data pushed to the repository', [...files.keys()].some(k => k.includes('sub_eald.json')) && files.get('data/reports/sub_eald.json').text.includes('GITHUB COMMENT'));
  const remote = { criteriaGrades: ['A', 'A', 'A', 'A', 'A'], overallGrade: 'A', profile: ['Consistently'], comment: 'THEIR COMMENT', updatedAt: new Date(Date.now() + 36e5).toISOString() };
  set('data/reports/sub_eald.json', { version: 1, subjectId: 'sub_eald', entries: { [pupil.id]: remote }, entryTombstones: {} });
  conflicts.set('data/reports/sub_eald.json', 1);
  G.click(G.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  G.click(G.q('[data-action="open-subject"]'));
  G.click(G.qa('[data-action="edit-entry"]').find(b => b.closest('tr')?.textContent.includes('Ming')));
  const gf2 = G.q('#teacher-report-form');
  gf2.querySelector('textarea[name="comment"]').value = 'LOCAL EDIT.';
  G.submit(gf2);
  await wait(1700);
  const mergedText = files.has('data/reports/sub_eald.json') ? files.get('data/reports/sub_eald.json').text : '';
  report('409 conflict retried, newer entry wins', mergedText.includes('THEIR COMMENT') && !mergedText.includes('LOCAL EDIT.'));
  report('No uncaught errors (GitHub backend)', G.errs.length === 0, G.errs[0] || '');
}

/* ================================================================== */
/* 5. TOKEN WITHOUT ACCESS TO THE DATA REPOSITORY                      */
/* ================================================================== */
console.log('\n— Repository token without access —');
{
  const fetchMock = async (url, o = {}) => {
    const u = String(url);
    const r = (s, j) => ({ ok: s >= 200 && s < 300, status: s, json: async () => j });
    if (/api\.github\.com\/user$/.test(u)) return r(200, { login: 'petgabs82' });
    if (/api\.github\.com\/repos\/Petgabs\/report-data$/.test(u)) return r(403, { message: 'Resource not accessible by integration' });
    if (/api\.github\.com\/repos\/Petgabs\/Peter-app2\.com$/.test(u)) return r(200, { private: false, permissions: { push: true } });
    if (u === 'cloud-config.json') return r(404, {});
    return r(404, {});
  };
  const H = boot(fetchMock);
  await wait(150);
  H.loginLocal('admin');
  H.click(H.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  H.q('#sync-token').value = 'github_pat_NO_ACCESS';
  H.submit(H.q('#sync-form'));
  await wait(600);
  const msg = H.q('#sync-test-result').textContent || '';
  report('Save is blocked when the token cannot see the data repo', !JSON.parse(H.ls('bzgfls-report-studio-github-v1') || '{}').enabled, msg.split('\n')[0]);
  report('Blocked save shows the two-step fix', /create it as a PRIVATE repository/.test(msg) && /Repository access/.test(msg), '');
  report('Blocked save says GitHub is optional', /optional/.test(msg), '');
  H.click(H.q('[data-action="cloud-check"]'));
  await wait(500);
  const diag = H.q('#cloud-diagnosis').textContent || '';
  report('Unsaved token is treated as an optional backend, not a failure', /Optional GitHub data backend/.test(diag) && !/Data repository.*not available/.test(diag), diag.split('\n').filter(l => l.includes('Optional')).join('').slice(0, 90));

  // a device where the token is saved but has lost access
  const H2 = boot(fetchMock, {
    'bzgfls-report-studio-github-v1': JSON.stringify({ repo: 'Petgabs/report-data', branch: 'main', token: 'github_pat_NO_ACCESS', enabled: true }),
    'bzgfls-report-studio-cloud-v1': JSON.stringify({ backend: 'github' }),
  });
  await wait(300);
  H2.loginLocal('admin');
  await wait(120);
  H2.click(H2.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  H2.click(H2.q('[data-action="cloud-check"]'));
  await wait(600);
  const diag2 = H2.q('#cloud-diagnosis').textContent || '';
  report('Setup check explains the inaccessible repo with the fix', /is not available to this token/.test(diag2) && /github\.com\/new/.test(diag2) && /Repository access/.test(diag2), diag2.split('\n').filter(l => l.includes('report-data')).join(' ').slice(0, 120));
  report('Setup check still calls GitHub optional', /school cloud/i.test(diag2), '');
  report('No uncaught errors (denied token)', H.errs.length === 0 && H2.errs.filter(e => !/favicon/.test(e)).length === 0, H.errs[0] || H2.errs[0] || '');
}


/* ================================================================== */
/* 6. RECOVERY, ACCESSIBILITY AND WORKFLOW IMPROVEMENTS                */
/* ================================================================== */
console.log('\n— Recovery, accessibility, workflow —');
{
  report('Favicon, description and theme colour are declared',
    html.includes('rel="icon"') && html.includes('name="description"') && html.includes('name="theme-color"'));
  report('A noscript message is present', html.includes('<noscript>'));
  report('Table headers declare their scope', (html.match(/<th scope="col"/g) || []).length >= 40,
    (html.match(/<th scope="col"/g) || []).length + ' scoped headers');
  report('Brand colours meet WCAG AA on white/surface',
    html.includes('--gold:#8a652e') && html.includes('--muted:#5c6c83'));
  report('Reduced-motion preference is honoured', html.includes('prefers-reduced-motion:reduce'));
  report('Modals are labelled by their heading and Escape closes them',
    html.includes('aria-labelledby="modal-title"') && html.includes("e.key==='Escape'"));
  report('Recovery snapshots exist and are taken before destructive actions',
    html.includes('function createSnapshot') && html.includes("createSnapshot('Before importing") && html.includes("createSnapshot('Before deleting a student')"));
  report('CSV roster import, draft autosave and roster search are wired',
    html.includes('function readCsvImport') && html.includes('function saveDraft') && html.includes("e.target.id==='student-search'"));
  report('Idle auto-lock and a global error banner are installed',
    html.includes('function lockForIdle') && html.includes('id="fatal-error"') && html.includes("addEventListener('unhandledrejection'"));
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  report('Service worker caches the shell network-first for pages',
    sw.includes("req.mode === 'navigate'") && sw.includes('vendor/pdf-libs.js') && sw.includes('report-studio-shell-v1'));

  const app = boot(async () => { throw new TypeError('offline test'); });
  await wait(200);
  app.loginLocal('admin');
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'students'));

  // CSV roster import (header row + two students, one enrolled in MAD by code)
  const csvInput = app.q('#csv-import');
  const csvText = 'pinyin,english,classTeacher,subjects\nZhang Wei,Alice,,MAD\nWang Fang,Bob,,';
  const csvFile = { name: 'roster.csv', size: csvText.length, text: async () => csvText }; // jsdom Files lack .text()
  Object.defineProperty(csvInput, 'files', { value: [csvFile], configurable: true });
  csvInput.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await wait(300);
  report('CSV import adds students and enrols by subject code',
    app.store().students.length === 2 && app.store().students[0].subjectIds.length === 1,
    JSON.stringify(app.store().students.map(s => s.english)));
  report('CSV import snapshots the workspace first',
    JSON.parse(app.ls('bzgfls-report-studio-snapshots-v1') || '[]').length >= 1);

  // Roster search filters rows in place
  const search = app.q('#student-search');
  search.value = 'alice';
  search.dispatchEvent(new app.w.Event('input', { bubbles: true }));
  const rows = app.qa('tr[data-search]');
  const aliceRow = rows.find(r => r.dataset.search.includes('alice'));
  const bobRow = rows.find(r => r.dataset.search.includes('bob'));
  report('Roster search hides non-matching students',
    rows.length === 2 && aliceRow.style.display !== 'none' && bobRow.style.display === 'none');

  // Modal: labelled dialog, Escape closes it
  app.click(app.q('[data-action="student-modal"]'));
  report('Dialog is labelled by its heading', !!app.q('.modal[aria-labelledby="modal-title"]') && !!app.q('#modal-title'));
  app.d.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  report('Escape closes the dialog', !app.q('.modal'));

  // Draft autosave: type a comment, then reboot with the same storage
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  app.click(app.qa('[data-action="open-subject"]')[1] || app.qa('[data-action="open-subject"]')[0]);
  app.click(app.q('[data-action="edit-entry"]'));
  const box = app.q('#comment-box');
  box.value = 'DRAFT COMMENT typed but never saved.';
  box.dispatchEvent(new app.w.Event('input', { bubbles: true }));
  await wait(60);
  report('Typing a comment autosaves a local draft',
    (app.ls('bzgfls-report-studio-drafts-v1:y2027') || '').includes('DRAFT COMMENT'));
  report('Comment box requests spellchecking', box.getAttribute('spellcheck') === 'true');
  const saved = {};
  for (let i = 0; i < app.w.localStorage.length; i++) { const k = app.w.localStorage.key(i); saved[k] = app.w.localStorage.getItem(k); }
  const app2 = boot(async () => { throw new TypeError('offline test'); }, saved);
  await wait(200);
  // a draft only makes sense after sign-in; the draft store must survive the reboot untouched
  report('Drafts survive a browser restart', (app2.ls('bzgfls-report-studio-drafts-v1:y2027') || '').includes('DRAFT COMMENT'));

  // Snapshot now + delete + restore round trip
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
  app.click(app.q('[data-action="snapshot-now"]'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'students'));
  app.click(app.q('[data-action="delete-student"]'));
  report('Deleting a student removes them', app.store().students.length === 1);
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
  app.click(app.q('[data-action="snapshot-restore"]'));
  report('Restoring the pre-delete snapshot brings the student back', app.store().students.length === 2);

  // Global error banner
  app.w.dispatchEvent(new app.w.ErrorEvent('error', { message: 'boom-test' }));
  report('Uncaught errors surface in the fatal-error banner, not a blank page',
    app.q('#fatal-error').hidden === false && app.q('#fatal-error').textContent.includes('boom-test'));

  // Idle auto-lock
  const idle = boot(async () => { throw new TypeError('offline test'); }, {}, { __IDLE_LOCK_MS__: 60 });
  await wait(200);
  idle.loginLocal('teacher');
  await wait(1400);
  report('An idle shared computer locks itself', !!idle.q('.login-shell') && idle.d.body.textContent.includes('without activity'));
  report('No uncaught errors (improvements)', app.errs.filter(e => !/boom-test/.test(e)).length === 0, app.errs[0] || '');
}


/* ================================================================== */
/* 7. REPAIR 2026-10-18: RLS failure visibility, CAL mapping, cohorts  */
/* ================================================================== */
console.log('\n— Repair: role failure, CAL profiles, cohort guard —');
{
  report('Report tables still render proper <thead> elements',
    !html.includes('<th scope="col"ead') && html.includes('<thead>'));
  report('Setup SQL routes role checks through definer helpers, not self-queries in policies',
    fs.readFileSync(new URL('../supabase-setup.sql', import.meta.url), 'utf8').includes('function public.is_admin()'));
  const mig = fs.readFileSync(new URL('../supabase-migration-2026-10-18-fix-rls-recursion.sql', import.meta.url), 'utf8');
  const rb = fs.readFileSync(new URL('../supabase-migration-2026-10-18-fix-rls-recursion.rollback.sql', import.meta.url), 'utf8');
  report('Reviewed migration + rollback are version controlled',
    mig.includes('42P17') && mig.includes('security definer') && mig.includes('set search_path = public') && rb.includes('ROLLBACK'));
  report('No migration disables RLS or adds a service-role key',
    !/disable row level security/i.test(mig) && !/service_role/i.test(mig + html));
  report('Help no longer claims a single-file offline app',
    html.includes('vendor/pdf-libs.js') && html.includes('并非单个文件'));
  report('Full-backup import warns before crossing academic years',
    html.includes('COHORT WARNING'));

  // profile lookup 500 -> teacher-level only, explicit error, cloud badge = error
  const w500 = sbWorld({ profile500: true });
  const P = boot(w500.fetch, {
    'bzgfls-report-studio-supabase-v1': JSON.stringify({ url: SB, anon: ANON, enabled: true }),
    'bzgfls-report-studio-cloud-v1': JSON.stringify({ backend: 'supabase' }),
  });
  await wait(250);
  await P.loginCloud('hsc-admin', 'AdminPass1!');
  await wait(400);
  report('Failed profile lookup does NOT promote the user to admin',
    (P.q('.topbar-meta') || { textContent: '' }).textContent.includes('Teacher session'),
    (P.q('.topbar-meta') || { textContent: '' }).textContent.slice(0, 60));
  report('Failed profile lookup is explained, not silent',
    P.d.body.textContent.includes('could not be verified') || (P.q('#sync-pill') || {}).textContent === 'Cloud: error',
    (P.q('#sync-pill') || {}).textContent || '');
  report('Cloud badge refuses to say "school" while role checks fail',
    (P.q('#sync-pill') || {}).textContent === 'Cloud: error', (P.q('#sync-pill') || {}).textContent || '');
  report('Profile failure never escalates to the fatal-error banner',
    !html.includes('showFatalError(sbProfileError)') && (P.q('#fatal-error') || {}).hidden !== false);

  // Session restore on reload (the reported screenshot): same 500, still no red banner
  const P2 = boot(w500.fetch, {
    ...SESSION_SEED(),
    'bzgfls-report-studio-sb-session-v1': JSON.stringify({ access_token: 'at_seed', refresh_token: 'rt_seed', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: w500.adminId, email: 'admin@school.test' }, role: 'admin', username: 'hsc-admin', display_name: 'Admin' }),
  });
  await wait(1800);
  report('Reload with a saved session does not show the fatal banner either',
    (P2.q('#fatal-error') || {}).hidden !== false && (P2.q('.topbar-meta') || { textContent: '' }).textContent.includes('Teacher session'),
    (P2.q('#fatal-error') || {}).textContent || '');

  // CAL import: A-D profile codes normalise; MAD descriptors untouched; preview dots
  const app = boot(async () => { throw new TypeError('offline test'); });
  await wait(200);
  app.loginLocal('admin');
  // subjects exactly as initialState() builds them from the seed data
  const seedAll = JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const subs = seedAll.subjects.map(x => ({ id: 'sub_' + x.code.toLowerCase().replace(/[^a-z0-9]/g, ''), code: x.code, name: x.name, units: x.units, teachers: '', criteria: [...x.criteria], updatedAt: '' }));
  report('Seed subjects available for CAL test', !!subs);
  if (subs) {
    const cal = subs.find(x => x.code === 'CAL'), mad = subs.find(x => x.code === 'MAD');
    const pkg = {
      format: 'report-studio-backup-v1', version: 1,
      data: {
        version: 1, schoolEn: 'Test School', schoolCn: '', academicYear: '2027', period: 'Academic Year 2027', issueDate: '2027-06-01',
        staff: { classTeacher: 'T', hscCoordinator: 'H', deputyPrincipal: 'D' },
        subjects: subs,
        students: [{ id: 'st_test01', pinyin: 'Ce Shi', english: 'Teststudent', classTeacher: '', subjectIds: [cal.id, mad.id] }],
        reports: { st_test01: {
          [cal.id]: { criteriaGrades: ['A', 'B', 'C', 'D'], overallGrade: 'B', profile: ['A', ' b ', 'C', 'd'], comment: 'CAL comment preserved.', updatedAt: '2027-06-01T00:00:00.000Z' },
          [mad.id]: { criteriaGrades: mad.criteria.map(() => 'A'), overallGrade: 'A', profile: ['Consistently', 'Often', 'Occasionally', 'Rarely'], comment: 'MAD comment.', updatedAt: '2027-06-01T00:00:00.000Z' },
        } },
        summaries: {}, settingsUpdatedAt: '', tombstones: { students: {}, subjects: {}, entries: {} },
      },
    };
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
    app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
    const ji = app.q('#json-import');
    const txt = JSON.stringify(pkg);
    Object.defineProperty(ji, 'files', { value: [{ name: 'backup.json', size: txt.length, text: async () => txt }], configurable: true });
    ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await wait(300);
    const stored = app.store();
    const calRec = stored.reports.st_test01[cal.id], madRec = stored.reports.st_test01[mad.id];
    report('CAL A/B/C/D codes normalise to the four descriptors',
      JSON.stringify(calRec.profile) === JSON.stringify(['Consistently', 'Often', 'Occasionally', 'Rarely']), JSON.stringify(calRec.profile));
    report('CAL normalisation preserves grades and comment exactly',
      calRec.overallGrade === 'B' && calRec.criteriaGrades.join(',') === 'A,B,C,D' && calRec.comment === 'CAL comment preserved.');
    report('Other subjects are not reinterpreted',
      JSON.stringify(madRec.profile) === JSON.stringify(['Consistently', 'Often', 'Occasionally', 'Rarely']) && madRec.overallGrade === 'A');

    // invalid CAL code is rejected and changes nothing
    const bad = JSON.parse(txt); bad.data.reports.st_test01[cal.id].profile = ['X', 'A', 'B', 'C'];
    Object.defineProperty(ji, 'files', { value: [{ name: 'bad.json', size: 10, text: async () => JSON.stringify(bad) }], configurable: true });
    ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await wait(300);
    report('An invalid CAL profile code is rejected without changing data',
      app.store().reports.st_test01[cal.id].comment === 'CAL comment preserved.');

    // full preview shows the CAL dots
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'reports'));
    app.click(app.q('[data-action="preview"]'));
    await wait(120);
    const stage = app.q('#report-stage').innerHTML;
    report('Full report preview renders CAL dots from the mapped descriptors',
      stage.includes('●●●●') && stage.includes('●○○○') && stage.includes('Teststudent'));
    report('No uncaught errors (repair tests)', app.errs.filter(e => !/boom/.test(e)).length === 0, app.errs[0] || '');
  }
}


/* ================================================================== */
/* 8. PDF RACE + STORED CAL LETTERS                                    */
/* ================================================================== */
console.log('\n— PDF race after sign-in, stored CAL letters —');
{
  report('PDF download waits for the initial cloud sync',
    html.includes('await waitForInitialSync()') && html.includes('let initialSyncPromise'));
  report('Background sync never re-renders over an open preview',
    (html.match(/!previewState&&!document\.body\.classList\.contains\('preview-mode'\)/g) || []).length >= 2);
  report('Sign-out resets the initial-sync promise',
    html.includes('initialSyncPromise=null;authRole=null'));
  report('Profiles policy is least-privilege (own row only)',
    fs.readFileSync(new URL('../supabase-migration-2026-10-18-fix-rls-recursion.sql', import.meta.url), 'utf8')
      .includes('using (id = auth.uid())'));

  // Cloud already stores RAW CAL letters (pre-fix data). The app must render
  // descriptors + dots without the stored record being rewritten first.
  const seedAll = JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const subs = seedAll.subjects.map(x => ({ id: 'sub_' + x.code.toLowerCase().replace(/[^a-z0-9]/g, ''), code: x.code, name: x.name, units: x.units, teachers: 'T', criteria: [...x.criteria], updatedAt: '' }));
  const cal = subs.find(x => x.code === 'CAL');
  const localState = {
    version: 1, schoolEn: 'Test School', schoolCn: '', academicYear: '2027', period: 'Academic Year 2027', issueDate: '2027-06-01',
    staff: { classTeacher: 'T', hscCoordinator: 'H', deputyPrincipal: 'D' }, subjects: subs,
    students: [{ id: 'st_test01', pinyin: 'Ce Shi', english: 'Teststudent', classTeacher: '', subjectIds: [cal.id] }],
    reports: {}, summaries: {}, settingsUpdatedAt: '', tombstones: { students: {}, subjects: {}, entries: {} },
  };
  const w = sbWorld();
  w.files.set('data/reports/' + cal.id + '.json', {
    content: { subjectId: cal.id, entries: { st_test01: { criteriaGrades: ['A', 'B', 'C', 'D'], overallGrade: 'B', profile: ['A', 'B', 'C', 'D'], comment: 'Stored CAL comment.', updatedAt: '2027-06-01T00:00:00.000Z' } }, entryTombstones: {} },
    updated_at: new Date().toISOString(),
  });
  // Slow the cloud pull down so the preview is opened mid-sync (the reported race).
  const slowFetch = async (u, o) => { if (String(u).includes('/rest/v1/report_files')) await wait(1200); return w.fetch(u, o); };
  const app = boot(slowFetch, {
    'bzgfls-report-studio-supabase-v1': JSON.stringify({ url: SB, anon: ANON, enabled: true }),
    'bzgfls-report-studio-cloud-v1': JSON.stringify({ backend: 'supabase' }),
    'bzgfls-year11-preliminary-report-studio-v1': JSON.stringify(localState),
  });
  await wait(250);
  await app.loginCloud('hsc-wang', 'TeachPass1!');
  // Immediately open the full preview while the first pull is still running.
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'reports'));
  app.click(app.q('[data-action="preview"]'));
  report('Preview opens immediately after sign-in', app.d.body.classList.contains('preview-mode'));
  // wait on a condition, not a fixed sleep: the slow pull must land the entry
  for (let i = 0; i < 40 && !(app.store() && app.store().reports && app.store().reports.st_test01); i++) await wait(500);
  report('Initial sync does not hide the open preview', app.d.body.classList.contains('preview-mode'));
  const stored = app.store().reports.st_test01[cal.id];
  report('Stored CAL entry keeps its academic grade and comment after sync',
    stored.overallGrade === 'B' && stored.comment === 'Stored CAL comment.', JSON.stringify(stored.profile));
  app.click(app.q('[data-action="close-preview"]'));
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'reports'));
  app.click(app.q('[data-action="preview"]'));
  const stage = app.q('#report-stage').innerHTML;
  report('Already-stored raw CAL letters render as descriptors with dots',
    stage.includes('Consistently&nbsp;') && stage.includes('●●●●') && stage.includes('●○○○'));
  report('No uncaught errors (race tests)', app.errs.length === 0, app.errs[0] || '');
}


/* ================================================================== */
/* 9. "TEST CONNECTION" MUST NOT CLAIM SUCCESS ON 42P17                */
/* ================================================================== */
console.log('\n— Test connection honesty —');
{
  report('sbTestConnection probes profiles and fails on any non-2xx app_config',
    html.includes("rest/v1/profiles?id=eq.'+encodeURIComponent(sbSession.user.id)+'&select=role'")
    && html.includes('the database is NOT fully set up yet'));

  const wCfg = sbWorld({ appConfig500: true });
  const D = boot(wCfg.fetch, SESSION_SEED());
  await wait(250);
  await D.loginCloud('hsc-admin', 'AdminPass1!');
  await wait(400);
  D.click(D.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  D.click(D.q('[data-action="sb-test"]'));
  await wait(900);
  const msgD = (D.q('#sb-test-result') || {}).textContent || '';
  report('app_config HTTP 500 makes Test connection fail, not claim success',
    msgD.includes('app_config') && msgD.includes('NOT fully set up') && !msgD.includes('teachers can sign in'), msgD.slice(0, 110));

  const wProf = sbWorld({ profile500: true });
  const E = boot(wProf.fetch, SESSION_SEED());
  await wait(250);
  await E.loginCloud('hsc-admin', 'AdminPass1!');
  await wait(400);
  E.click(E.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  if (E.q('#admin-login-form')) { E.loginLocalAdminInModal(); await wait(300); }
  E.click(E.q('[data-action="sb-test"]'));
  await wait(1600);
  const msgE = (E.q('#sb-test-result') || {}).textContent || '';
  report('profiles HTTP 500 (42P17) makes Test connection fail with the repair pointer',
    msgE.includes('profile cannot be read') && msgE.includes('v2-rls-repair'), msgE.slice(0, 110));
  report('No uncaught errors (honesty tests)', D.errs.length === 0 && E.errs.length === 0, (D.errs[0] || E.errs[0] || ''));
}


/* ================================================================== */
/* 10. TEACHER ASSIGNMENT PER SUBJECT                                  */
/* ================================================================== */
console.log('\n— Teacher assignment per subject —');
{
  const mig3 = fs.readFileSync(new URL('../supabase-migration-2026-10-18-v3-subject-assignments.sql', import.meta.url), 'utf8');
  report('v3 migration creates gated subject assignments with rollback',
    mig3.includes('subject_teachers') && mig3.includes('can_write_subject')
    && fs.existsSync(new URL('../supabase-migration-2026-10-18-v3-subject-assignments.rollback.sql', import.meta.url)));
  report('App fetches assignments and filters the subject grid',
    html.includes('sbFetchSubjectAccess') && html.includes('visibleSubjects().map') && html.includes('btn-gold" data-action="assign-modal"') && html.includes('Teacher assignment:'));

  const wA = sbWorld();
  wA.assignments.set('sub_eald', new Set([wA.adminId])); // EAL/D locked to admin only
  wA.assignments.set('sub_cal', new Set([wA.wangId]));   // CAL assigned to the teacher
  const T = boot(wA.fetch, SESSION_SEED());
  await wait(250);
  await T.loginCloud('hsc-wang', 'TeachPass1!');
  await wait(600);
  T.click(T.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  const grid = T.q('.subject-grid').textContent;
  report('Teacher sees her assigned subject and open subjects',
    grid.includes('Chinese and Literature') && grid.includes('Mathematics Advanced'));
  report('Teacher does NOT see a subject assigned only to others',
    !grid.includes('English as an Additional'));
  T.click(T.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  report('Teachers get no Assign buttons (admin surface stays gated)',
    !T.q('[data-action="assign-modal"]') && T.d.body.textContent.includes('Admin sign-in required'));

  // Admin assigns the teacher to MAD through the UI; database mock records it
  const Adm = boot(wA.fetch, SESSION_SEED());
  await wait(250);
  await Adm.loginCloud('hsc-admin', 'AdminPass1!');
  await wait(600);
  Adm.click(Adm.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  Adm.click(Adm.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'subjects'));
  report('Subjects tab shows assignment guidance and a gold Assign button per row',
    Adm.d.body.textContent.includes('Teacher assignment:') && !!Adm.q('.btn-gold[data-action="assign-modal"]')
    && Adm.qa('[data-action="assign-modal"]').length === Adm.qa('[data-action="subject-modal"]').length - 1);
  const madRowBtn = Adm.qa('[data-action="assign-modal"]')[1]; // seed order: EAL/D, MAD, ...
  Adm.click(madRowBtn);
  await wait(500);
  report('Assignment modal lists the teacher accounts',
    (Adm.q('#assign-form') || { textContent: '' }).textContent.includes('Ms Wang'));
  const box = Adm.q('#assign-form input[name="assign"]');
  box.checked = true;
  Adm.submit(Adm.q('#assign-form'));
  await wait(500);
  report('Saving the assignment writes it to the database',
    (wA.assignments.get('sub_mad') || new Set()).has(wA.wangId),
    [...(wA.assignments.get('sub_mad') || [])].join(','));

  // Teacher accounts tab: admin sees every account and its assignments —
  // but never a password (hashes cannot be read back; page must not print them)
  Adm.click(Adm.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'accounts'));
  await wait(600);
  const acctText = Adm.d.body.textContent;
  report('Teacher accounts tab lists staff and their assigned subjects',
    acctText.includes('Ms Wang') && acctText.includes('@hsc-wang') && acctText.includes('Mathematics Advanced'),
    acctText.slice(0, 160));
  report('Passwords are never printed on the admin page',
    acctText.includes('Passwords are not shown here') && acctText.includes('cannot be shown or recovered')
    && !acctText.includes('TeachPass1!') && !acctText.includes('AdminPass1!'));
  report('No uncaught errors (assignment tests)', T.errs.length === 0 && Adm.errs.length === 0, (T.errs[0] || Adm.errs[0] || ''));

  // Every subject locked to a different teacher: EALD-style account sees ONE subject
  const wB = sbWorld();
  wB.assignments.set('sub_eald', new Set([wB.wangId]));
  for (const sid of ['sub_mad', 'sub_cal', 'sub_bs', 'sub_va', 'sub_phy', 'sub_mex']) wB.assignments.set(sid, new Set([wB.adminId]));
  const T2 = boot(wB.fetch, SESSION_SEED());
  await wait(250);
  await T2.loginCloud('hsc-wang', 'TeachPass1!');
  await wait(600);
  T2.click(T2.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  const grid2 = T2.q('.subject-grid') ? T2.q('.subject-grid').textContent : '';
  report('With every subject assigned, the teacher sees exactly one subject (their own)',
    T2.qa('.subject-card').length === 1 && grid2.includes('English as an Additional')
    && !grid2.includes('Mathematics Advanced') && !grid2.includes('Chinese and Literature')
    && !grid2.includes('Business Studies') && !grid2.includes('Visual Arts') && !grid2.includes('Physics'),
    grid2.slice(0, 160));
  // Even a forged Enter-reports click for another subject is refused
  const forged = T2.d.createElement('button');
  forged.dataset.action = 'open-subject'; forged.dataset.id = 'sub_mad';
  T2.d.body.appendChild(forged); T2.click(forged);
  report('Enter reports for another teacher’s subject is refused',
    !!T2.q('.subject-grid') && T2.d.body.textContent.includes('assigned to other teachers'));

  // If assignments cannot be loaded, entry locks completely (no open default)
  const wF = sbWorld({ assignmentsFail: true });
  const TF = boot(wF.fetch, SESSION_SEED());
  await wait(250);
  await TF.loginCloud('hsc-wang', 'TeachPass1!');
  await wait(600);
  TF.click(TF.qa('.nav-btn').find(b => b.dataset.view === 'subjects'));
  report('When assignments cannot load, subject entry is locked with an explanation',
    TF.qa('.subject-card').length === 0 && TF.d.body.textContent.includes('Subject entry is locked'),
    TF.d.body.textContent.slice(0, 160));
  report('No uncaught errors (single-subject lock tests)', T2.errs.length === 0 && TF.errs.length === 0, (T2.errs[0] || TF.errs[0] || ''));
}


/* ================================================================== */
/* 11. 2026 INDIVIDUAL REPORT TEMPLATE (fictional records only)        */
/* ================================================================== */
console.log('\n— 2026 individual report template —');
{
  const summarySrc = html.slice(html.indexOf('function rptCourseSummary'), html.indexOf('function rptAppendixStart'));
  report('Reporting staff replaces certification and signature lines',
    html.includes('function rptReportingStaff') && html.includes('>Reporting Staff<')
    && !html.includes('sig-line') && !html.includes('Report Certification') && !html.includes('HSC Coordinator'));
  report('Units are "Reported", never "Earned"',
    html.includes('Total Preliminary Units Reported') && !html.includes('Units Earned'));
  report('Course summary uses words, with no profile total or dot cells',
    summarySrc.includes("const word=v=>RATING[v]?v:'Not set'") && !summarySrc.includes('Profile<br>Total')
    && !summarySrc.includes('/16') && !summarySrc.includes('DOTS'));
  report('A missing rating can never be mislabeled "Never" (not a supported rating)',
    !html.includes("'Never'") && !summarySrc.includes('Never'));
  report('Issue date is validated and data-driven (not hard-coded for 2026)',
    !html.includes('2026-10-23') && html.includes('valid calendar date')
    && html.includes("staff:{classTeacher:cleanText") && html.includes('hscCoordinator:cleanText(staff.hscCoordinator,100)'));

  // Fictional 2026 workspace: one 6-course (12-unit) and one 7-course (13-unit) student
  const seedAll = JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const subs = seedAll.subjects.map(x => ({ id: 'sub_' + x.code.toLowerCase().replace(/[^a-z0-9]/g, ''), code: x.code, name: x.name, units: x.units, teachers: 'T. Eacher', criteria: [...x.criteria], updatedAt: '' }));
  const entry = (eng, profile) => ({ criteriaGrades: null, overallGrade: 'A', profile, comment: eng + ' made steady progress in this fictional entry.', updatedAt: '2026-10-01T00:00:00.000Z' });
  const mkReports = (eng, ids) => Object.fromEntries(ids.map((id, ix) => {
    const e = entry(eng, ix === 0 ? ['Consistently', 'Often', 'Occasionally', 'Rarely'] : ['Often', 'Often', 'Consistently', 'Often']);
    e.criteriaGrades = subs.find(x => x.id === id).criteria.map(() => 'A');
    return [id, e];
  }));
  const six = subs.filter(x => x.code !== 'MEX').map(x => x.id), seven = subs.map(x => x.id);
  const pkg = { format: 'report-studio-backup-v1', version: 1, data: {
    version: 1, schoolEn: 'Fictional School', schoolCn: '', academicYear: '2026', period: 'Academic Year 2026', issueDate: '2026-10-23',
    staff: { classTeacher: 'Ms. Wang Le', hscCoordinator: 'Mr. Peter Paul Gabato', deputyPrincipal: 'Ms. Qian Zhang' },
    subjects: subs,
    students: [
      { id: 'st_fic01', pinyin: 'Jia Ce', english: 'Alex', classTeacher: '', subjectIds: six },
      { id: 'st_fic02', pinyin: 'Yi Ce', english: 'Bella', classTeacher: 'Ms. Earlier Teacher', subjectIds: seven },
    ],
    reports: { st_fic01: mkReports('Alex', six), st_fic02: mkReports('Bella', seven) },
    summaries: {}, settingsUpdatedAt: '', tombstones: { students: {}, subjects: {}, entries: {} },
  } };
  const app = boot(async () => { throw new TypeError('offline test'); });
  await wait(200);
  app.loginLocal('admin');
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
  const ji = app.q('#json-import'); const txt = JSON.stringify(pkg);
  Object.defineProperty(ji, 'files', { value: [{ name: 'fic2026.json', size: txt.length, text: async () => txt }], configurable: true });
  ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await wait(300);
  // The 2026 backup is filed into its own workspace; open it explicitly.
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  app.q('#ws-year').value = '2026';
  app.click(app.q('[data-action="ws-switch"]'));
  await wait(150);
  report('11: switching opens the filed 2026 workspace (2 fictional students)',
    app.store().academicYear === '2026' && app.store().students.length === 2, app.store().academicYear);

  const openPreview = async id => {
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'reports'));
    const sel = app.q('#report-student');
    if (sel && sel.value !== id) { sel.value = id; sel.dispatchEvent(new app.w.Event('change', { bubbles: true })); }
    app.click(app.q('[data-action="preview"]'));
    await wait(120);
    return app.q('#report-stage').innerHTML;
  };
  const slice = (t, a, b) => t.slice(t.indexOf(a), t.indexOf(b, t.indexOf(a)));

  // --- 6-course / 12-unit student ---
  const stageA = await openPreview('st_fic01');
  report('Issue date prints as 23 October 2026 on cover and final page',
    (stageA.split('23 October 2026').length - 1) >= 2, String(stageA.split('23 October 2026').length - 1));
  report('Cover totals the enrolled units as Reported (6 courses = 12 units)',
    stageA.includes('Total Preliminary Units Reported') && stageA.includes('12 units') && !stageA.includes('Units Earned'));
  report('Reporting staff prints the three exact names and roles, no signatures',
    stageA.includes('Ms. Wang Le') && stageA.includes('Mr. Peter Paul Gabato') && stageA.includes('Ms. Qian Zhang')
    && stageA.includes('Head of HSC') && stageA.includes('>Reporting Staff<')
    && !stageA.includes('sig-line') && !stageA.includes('Certification'));
  const csA = slice(stageA, 'Course-by-Course Summary', 'Appendix');
  report('Course summary profiles are words (never dot symbols, no profile total)',
    csA.includes('Consistently') && csA.includes('Often') && csA.includes('Rarely')
    && !csA.includes('●') && !csA.includes('○') && !csA.includes('/16') && !csA.includes('Profile Total'),
    csA.slice(0, 120));
  report('Detailed profiles and appendix legend keep their dots',
    stageA.includes('●●●●') && stageA.includes('Learner Profile Descriptors'));
  report('A complete report shows no false "Never" and no "Not set" gaps',
    !stageA.includes('Never') && !csA.includes('Not set'));
  report('Cohort denominators come from actual enrolments (EAL/D = 2 students)',
    slice(stageA, 'Summary of Results', 'Profile Summary').includes('2/2'));
  const sheetCount = app.qa('.sheet').length, pageNums = app.qa('.page-n').map(x => x.textContent);
  report('Preview paginates into several numbered A4 sheets',
    sheetCount >= 3 && pageNums[pageNums.length - 1] === 'Page ' + sheetCount + ' of ' + sheetCount,
    sheetCount + ' sheets: ' + pageNums.join(','));
  app.click(app.q('[data-action="close-preview"]'));

  // --- 7-course / 13-unit student, with a legacy Class Teacher override ---
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'reports'));
  { const sel = app.q('#report-student'); sel.value = 'st_fic02'; sel.dispatchEvent(new app.w.Event('change', { bubbles: true })); }
  report('Preflight names the Class Teacher override conflict before the report can be final',
    app.d.body.textContent.includes('Class Teacher override conflict') && app.d.body.textContent.includes('has not been changed'),
    app.d.body.textContent.slice(0, 160));
  const stageB = await openPreview('st_fic02');
  report('The conflicting report is marked DRAFT, not final',
    stageB.includes('DRAFT'));
  report('Seven enrolled courses total 13 units reported',
    stageB.includes('Total Preliminary Units Reported') && stageB.includes('13 units'));
  report('MEX cohort denominator is its own enrolment (1), not a fixed number',
    slice(stageB, 'Summary of Results', 'Profile Summary').includes('1/1'));
  report('A differing Class Teacher override is honoured in print (not silently overwritten)',
    stageB.includes('Ms. Earlier Teacher') && !stageB.includes('Ms. Wang Le'));
  app.click(app.q('[data-action="close-preview"]'));

  // --- Admin: renamed labels + override flagged for review ---
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  const adminText = app.d.body.textContent;
  report('Admin settings say Reporting staff / Head of HSC and flag the override for review',
    adminText.includes('Reporting staff') && adminText.includes('Head of HSC')
    && adminText.includes('Class Teacher overrides to review') && adminText.includes('Bella'),
    adminText.slice(0, 120));
  report('Read-only inventory shows the shared 2026 settings actually in force',
    adminText.includes('Shared settings inventory (read-only)') && adminText.includes('2026-10-23 / 23 October 2026')
    && adminText.includes('one') && adminText.includes('workspace'),
    adminText.slice(0, 120));
  report('Legacy backups keep working: hscCoordinator key still stores the Head of HSC',
    app.store().staff.hscCoordinator === 'Mr. Peter Paul Gabato', JSON.stringify(app.store().staff));
  report('No uncaught errors (2026 template tests)', app.errs.length === 0, app.errs[0] || '');
}


/* ================================================================== */
/* 12. MISSING / UNRECOGNISED PROFILE RATINGS (fictional only)         */
/* ================================================================== */
console.log('\n— Missing profile ratings —');
{
  const seedAll = JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const subs = seedAll.subjects.map(x => ({ id: 'sub_' + x.code.toLowerCase().replace(/[^a-z0-9]/g, ''), code: x.code, name: x.name, units: x.units, teachers: 'T. Eacher', criteria: [...x.criteria], updatedAt: '' }));
  const eald = subs.find(x => x.code === 'EAL/D');
  const pkg = { format: 'report-studio-backup-v1', version: 1, data: {
    version: 1, schoolEn: 'Fictional School', schoolCn: '', academicYear: '2026', period: 'Academic Year 2026', issueDate: '2026-10-23',
    staff: { classTeacher: 'Ms. Wang Le', hscCoordinator: 'Mr. Peter Paul Gabato', deputyPrincipal: 'Ms. Qian Zhang' },
    subjects: subs,
    students: [{ id: 'st_fic03', pinyin: 'San Ce', english: 'Cara', classTeacher: '', subjectIds: [eald.id] }],
    // 2nd rating is empty; the 4th rating is missing entirely
    reports: { st_fic03: { [eald.id]: { criteriaGrades: eald.criteria.map(() => 'A'), overallGrade: 'A', profile: ['Consistently', '', 'Often'], comment: 'Cara is a fictional student with an incomplete profile.', updatedAt: '2026-10-01T00:00:00.000Z' } } },
    summaries: {}, settingsUpdatedAt: '', tombstones: { students: {}, subjects: {}, entries: {} },
  } };
  const app = boot(async () => { throw new TypeError('offline test'); });
  await wait(200);
  app.loginLocal('admin');
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
  const ji = app.q('#json-import'); const txt = JSON.stringify(pkg);
  Object.defineProperty(ji, 'files', { value: [{ name: 'fic-missing.json', size: txt.length, text: async () => txt }], configurable: true });
  ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await wait(300);
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  app.q('#ws-year').value = '2026';
  app.click(app.q('[data-action="ws-switch"]'));
  await wait(150);
  report('12: switching opens the filed 2026 workspace',
    app.store().academicYear === '2026' && app.store().students.length === 1, app.store().academicYear);
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'reports'));
  app.click(app.q('[data-action="preview"]'));
  await wait(120);
  const stage = app.q('#report-stage').innerHTML;
  const cs = stage.slice(stage.indexOf('Course-by-Course Summary'), stage.indexOf('Appendix', stage.indexOf('Course-by-Course Summary')));
  report('Missing and empty ratings display "Not set" in the course summary',
    cs.includes('Not set') && cs.includes('Consistently') && cs.includes('Often'), cs.slice(0, 160));
  report('No false "Never" is printed anywhere for missing data (CAL D still means Rarely)',
    !stage.includes('Never'));
  report('The detailed profile also shows "Not set" (dots legend untouched)',
    (stage.split('Not set').length - 1) >= 2 && stage.includes('○○○○'));
  report('An incomplete profile keeps the report DRAFT, never final',
    stage.includes('DRAFT') && (app.q('.preview-bar') || { textContent: '' }).textContent.includes('Draft'));
  // An unrecognised rating cannot be imported at all — data stays untouched
  const bad = JSON.parse(txt); bad.data.reports.st_fic03[eald.id].profile = ['Consistently', 'Sometimes', 'Often', 'Rarely'];
  Object.defineProperty(ji, 'files', { value: [{ name: 'fic-bad.json', size: 10, text: async () => JSON.stringify(bad) }], configurable: true });
  // the import input lives on the admin Data tab
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
  app.q('#json-import').dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await wait(300);
  report('An unrecognised profile rating is rejected on import without changing data',
    JSON.stringify(app.store().reports.st_fic03[eald.id].profile) === JSON.stringify(['Consistently', '', 'Often']),
    JSON.stringify(app.store().reports.st_fic03[eald.id].profile));
  report('No uncaught errors (missing-rating tests)', app.errs.length === 0, app.errs[0] || '');
}

/* ------------------------------------------------------------------ */
console.log('\n— Year workspaces —');
{
  const app = boot(async () => { throw new TypeError('offline test'); });
  app.loginLocal ? app.loginLocal('admin') : null;
  const seed = app.store(); // default template workspace
  const ARCH = 'bzgfls-year11-preliminary-report-studio-v1:y';
  const mkPkg = (year, stuId, pinyin, en, staff, issueDate) => {
    const subjects = seed.subjects.map(s => ({ ...s, criteria: ['Uses strategies', 'Solves problems'] }));
    const eald = subjects[0];
    return { format: 'report-studio-backup-v1', version: 1, exportedAt: '2026-10-19T00:00:00.000Z', data: { version: 1,
      schoolEn: seed.schoolEn, schoolCn: seed.schoolCn, academicYear: year, period: 'Academic Year ' + year, issueDate,
      staff, subjects,
      students: [{ id: stuId, pinyin, english: en, classTeacher: '', subjectIds: [eald.id], updatedAt: '2026-10-19T00:00:00.000Z' }],
      reports: { [stuId]: { [eald.id]: { criteriaGrades: ['A', 'A'], overallGrade: 'A', profile: ['Consistently', 'Often', 'Occasionally', 'Rarely'], comment: 'Fictional comment.', updatedAt: '2026-10-19T00:00:00.000Z', updatedBy: 'Fictional' } } },
      summaries: { [stuId]: { overview: 'O', strengths: 'S', development: 'D', updatedAt: '2026-10-19T00:00:00.000Z' } },
      updatedAt: '2026-10-19T00:00:00.000Z', settingsUpdatedAt: '2026-10-19T00:00:00.000Z', summariesUpdatedAt: '2026-10-19T00:00:00.000Z',
      tombstones: { students: {}, subjects: {}, entries: {}, summaries: {} } } };
  };
  const importJSON = async pkg => {
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
    app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
    const ji = app.q('#json-import'); const txt = JSON.stringify(pkg);
    Object.defineProperty(ji, 'files', { value: [{ name: 'fictional.json', size: txt.length, text: async () => txt }], configurable: true });
    ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await wait(300);
  };
  const gotoSettings = () => {
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
    app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  };
  const staff2027 = { classTeacher: 'Ms. Ada Byron', hscCoordinator: 'Mr. Alan Turing', deputyPrincipal: 'Dr. Katherine Johnson' };
  const staff2026 = { classTeacher: 'Ms. Wang Le', hscCoordinator: 'Mr. Peter Paul Gabato', deputyPrincipal: 'Ms. Qian Zhang' };

  report('13: a fresh device starts on the default template year, empty',
    app.store().academicYear === '2027' && app.store().students.length === 0, app.store().academicYear);

  await importJSON(mkPkg('2027', 'st_y27', 'Liu Yang', 'Dana', staff2027, '2027-06-04'));
  report('13: a same-year backup imports into the open workspace as before',
    app.store().academicYear === '2027' && app.store().students.length === 1 && app.store().students[0].english === 'Dana',
    JSON.stringify(app.store().students.map(s => s.english)));

  await importJSON(mkPkg('2026', 'st_y26', 'Wang Xiao', 'Alex', staff2026, '2026-10-23'));
  report('13: a 2026 backup is filed into its own workspace and does NOT replace 2027',
    app.store().academicYear === '2027' && app.store().students.length === 1 && app.store().students[0].english === 'Dana'
      && String(app.ls(ARCH + '2026') || '').includes('"Alex"'),
    app.store().academicYear + ':' + app.store().students.map(s => s.english).join(','));

  gotoSettings();
  app.q('#ws-year').value = '2026';
  app.click(app.q('[data-action="ws-switch"]'));
  await wait(150);
  const s26 = app.store();
  report('13: switching to 2026 restores its own roster, staff and date, unchanged',
    s26.academicYear === '2026' && s26.students.length === 1 && s26.students[0].english === 'Alex'
      && s26.staff.classTeacher === 'Ms. Wang Le' && s26.staff.hscCoordinator === 'Mr. Peter Paul Gabato'
      && s26.staff.deputyPrincipal === 'Ms. Qian Zhang' && s26.issueDate === '2026-10-23',
    JSON.stringify({ y: s26.academicYear, n: s26.students.map(s => s.english), staff: s26.staff, d: s26.issueDate }));
  report('13: the workspace card names the year-scoped cloud location',
    /years\/2026\/data/.test(app.d.body.innerHTML));

  app.q('#ws-new-year').value = '2028';
  app.click(app.q('[data-action="ws-create"]'));
  await wait(150);
  const s28 = app.store();
  report('13: a new year starts empty of students with the subject template',
    s28.academicYear === '2028' && s28.students.length === 0 && s28.subjects.length === 7 && s28.period === 'Academic Year 2028',
    JSON.stringify({ y: s28.academicYear, n: s28.students.length, subs: s28.subjects.length, period: s28.period }));

  gotoSettings();
  app.q('#ws-year').value = '2027';
  app.click(app.q('[data-action="ws-switch"]'));
  await wait(150);
  const back27 = app.store();
  report('13: switching back to 2027 restores Dana and the 2027 staff/date untouched',
    back27.academicYear === '2027' && back27.students.length === 1 && back27.students[0].english === 'Dana'
      && back27.staff.classTeacher === 'Ms. Ada Byron' && back27.issueDate === '2027-06-04',
    JSON.stringify({ y: back27.academicYear, n: back27.students.map(s => s.english), staff: back27.staff, d: back27.issueDate }));
  report('13: per-year archives keep the other workspaces for later reopening',
    String(app.ls(ARCH + '2026') || '').includes('"Alex"') && String(app.ls(ARCH + '2028') || '').includes('"2028"'));
  report('13: the settings year field refuses to relabel the open workspace',
    html.includes('Academic years are kept separate'));
  report('13: cloud paths are year-scoped in code while the legacy year keeps data/...',
    html.includes("return 'years/'+y+'/';") && html.includes('function logicalSyncFileList')
      && html.includes('function physicalPath') && html.includes('belongs to another year'));
}

/* ------------------------------------------------------------------ */
console.log('\n— Year-workspace security (v4) —');
{
  const sqlV4 = fs.readFileSync(new URL('../supabase-migration-2026-10-20-v4-year-scoped-permissions.sql', import.meta.url), 'utf8');
  const sqlV4rb = fs.readFileSync(new URL('../supabase-migration-2026-10-20-v4-year-scoped-permissions.rollback.sql', import.meta.url), 'utf8');
  report('14: v4 migration registers the verified 2027 legacy workspace server-side',
    sqlV4.includes('workspace_years') && sqlV4.includes("(2027, '', true)") && sqlV4.includes('report_path_info'));
  report('14: v4 write gate is fail-closed for unknown, shared and unassigned paths',
    sqlV4.includes('where i.is_report') && sqlV4.includes('t.academic_year = i.academic_year')
      && sqlV4.includes('t.user_id = auth.uid()')
      && !sqlV4.includes('sid = p_path then return true')
      && !/return true; end if;\s*sid :=/.test(sqlV4)
      && sqlV4.includes("'^years/([0-9]{4})/data/reports/([A-Za-z0-9_-]+)\\.json$'"));
  report('14: assignments are year-specific and settings content must match its path year',
    sqlV4.includes('primary key (academic_year, subject_id, user_id)')
      && sqlV4.includes('check_report_file_year') && sqlV4.includes('report_files_year_check'));
  report('14: rollback restores the v3 gate and removes the registry',
    sqlV4rb.includes('drop table if exists public.workspace_years') && sqlV4rb.includes('can_write_subject'));
  report('14: legacy year is the verified server year, never the first local year',
    html.includes("const LEGACY_CLOUD_YEAR='2027'") && !html.includes('if(!yearIndex.legacyYear)yearIndex.legacyYear=y'));
  report('14: sync operations capture a fixed year/prefix and verify the remote year first',
    html.includes('function syncContext()') && html.includes('async function verifyRemoteYear')
      && html.includes('Remote workspace year mismatch') && html.includes('workspace changed during sync'));
  report('14: GitHub mirroring is disabled unless the destination repo is verified private',
    html.includes('ghMirrorRepoIsPrivate') && html.includes('is not a private repository'));
  report('14: inventory help distinguishes the 2027 legacy location from year-prefixed paths',
    html.includes('2027 legacy year') && html.includes('years/&lt;year&gt;/data/'));

  // --- (a) an old 2026-browser device must not claim the 2027 cloud paths
  const base = boot(async () => { throw new TypeError('offline test'); });
  base.loginLocal('admin');
  const template = base.store();
  const oldLocal2026 = { ...template, academicYear: '2026', students: [{ id: 'st_old26', pinyin: 'Jiu Ce', english: 'Bong', classTeacher: '', subjectIds: [template.subjects[0].id], updatedAt: '2026-01-01T00:00:00.000Z' }] };
  const dev = boot(async () => { throw new TypeError('offline test'); }, {
    'bzgfls-year11-preliminary-report-studio-v1': JSON.stringify(oldLocal2026),
  });
  dev.loginLocal('admin');
  dev.click(dev.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  dev.click(dev.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  report('14: old local 2026 data stays a 2026 workspace and does not claim legacy paths',
    dev.store().academicYear === '2026' && dev.store().students.length === 1 && dev.store().students[0].english === 'Bong'
      && /years\/2026\/data/.test(dev.d.body.innerHTML)
      && String(dev.ls('bzgfls-report-studio-years-v1') || '').includes('"legacyYear":"2027"'),
    dev.store().academicYear + ':' + dev.store().students.map(s => s.english).join(','));

  // --- (c) importing into a year that already has data needs an explicit choice
  const app = boot(async () => { throw new TypeError('offline test'); });
  app.loginLocal('admin');
  const seed = app.store();
  const mkPkg14 = (en, stuId) => {
    const subjects = seed.subjects.map(s => ({ ...s, criteria: ['Uses strategies'] }));
    return { format: 'report-studio-backup-v1', version: 1, exportedAt: '2026-10-19T00:00:00.000Z', data: { version: 1,
      schoolEn: seed.schoolEn, schoolCn: seed.schoolCn, academicYear: '2026', period: 'Academic Year 2026', issueDate: '2026-10-23',
      staff: { classTeacher: 'Ms. Wang Le', hscCoordinator: 'Mr. Peter Paul Gabato', deputyPrincipal: 'Ms. Qian Zhang' }, subjects,
      students: [{ id: stuId, pinyin: 'Ce Shi', english: en, classTeacher: '', subjectIds: [subjects[0].id], updatedAt: '2026-10-19T00:00:00.000Z' }],
      reports: {}, summaries: {}, updatedAt: '2026-10-19T00:00:00.000Z', settingsUpdatedAt: '2026-10-19T00:00:00.000Z', summariesUpdatedAt: '2026-10-19T00:00:00.000Z',
      tombstones: { students: {}, subjects: {}, entries: {}, summaries: {} } } };
  };
  const import14 = async pkg => {
    app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
    app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
    const ji = app.q('#json-import'); const txt = JSON.stringify(pkg);
    Object.defineProperty(ji, 'files', { value: [{ name: 'fic.json', size: txt.length, text: async () => txt }], configurable: true });
    ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
    await wait(300);
  };
  const ARCH = 'bzgfls-year11-preliminary-report-studio-v1:y2026';
  await import14(mkPkg14('Alex', 'st_i26a'));
  app.w.confirm = () => false;
  await import14(mkPkg14('Charlie', 'st_i26b'));
  report('14: declining the replacement choice keeps the existing 2026 workspace',
    String(app.ls(ARCH) || '').includes('"Alex"') && !String(app.ls(ARCH) || '').includes('"Charlie"'));
  app.w.confirm = () => true;
  await import14(mkPkg14('Charlie', 'st_i26b'));
  report('14: accepting replaces it only after a recovery copy is snapshotted',
    String(app.ls(ARCH) || '').includes('"Charlie"')
      && String(app.ls('bzgfls-report-studio-snapshots-v1') || '').includes('Recovery copy of the 2026 workspace')
      && String(app.ls('bzgfls-report-studio-snapshots-v1') || '').includes('"Alex"'));
  report('14: the open 2027 workspace was never touched by the 2026 imports',
    app.store().academicYear === '2027' && app.store().students.length === 0, app.store().academicYear);

  // --- cloud isolation: a new year syncs to its own prefix only
  const W = sbWorld();
  const capp = boot(W.fetch, SESSION_SEED());
  await capp.loginCloud('hsc-admin', 'AdminPass1!');
  await wait(1600);
  capp.click(capp.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  capp.click(capp.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  capp.q('#ws-new-year').value = '2026';
  capp.click(capp.q('[data-action="ws-create"]'));
  await wait(1800);
  const y26settings = W.files.get('years/2026/data/settings.json');
  const legacySettings = W.files.get('data/settings.json');
  report('14: cloud sync writes the new year only under years/<year>/ and leaves legacy 2027 intact',
    !!y26settings && String(y26settings.content.academicYear) === '2026'
      && !!legacySettings && String(legacySettings.content.academicYear) === '2027'
      && capp.store().academicYear === '2026',
    JSON.stringify({ y26: y26settings && y26settings.content.academicYear, legacy: legacySettings && legacySettings.content.academicYear }));
  report('14: the legacy roster (fictional Ming) was not moved into the 2026 workspace',
    JSON.stringify((W.files.get('data/roster.json') || {}).content || {}).includes('Ming')
      && !JSON.stringify((W.files.get('years/2026/data/roster.json') || {}).content || {}).includes('Ming'));

  // remote-year mismatch: tamper with the 2026 cloud settings, sync must stop
  const beforeRoster = JSON.stringify(W.files.get('years/2026/data/roster.json').content);
  W.files.set('years/2026/data/settings.json', { content: { ...y26settings.content, academicYear: '2027' }, updated_at: new Date().toISOString() });
  capp.click(capp.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  capp.click(capp.q('[data-action="sync-now"]'));
  await wait(1500);
  report('14: a remote year mismatch stops sync and overwrites nothing',
    JSON.stringify(W.files.get('years/2026/data/roster.json').content) === beforeRoster
      && capp.d.body.innerHTML.includes('Remote workspace year mismatch'),
    'roster unchanged; mismatch explained');
  report('14: no uncaught errors (year-workspace security tests)', capp.errs.length === 0 && app.errs.length === 0 && dev.errs.length === 0,
    (capp.errs[0] || app.errs[0] || dev.errs[0] || ''));
}

/* ------------------------------------------------------------------ */
console.log('\n— Import year checks + in-flight sync (15) —');
{
  // A teacher starter for another year must not convert the open workspace
  const app = boot(async () => { throw new TypeError('offline test'); });
  app.loginLocal('admin');
  const seed = app.store();
  const starter = { format: 'report-studio-starter-v1', version: 1,
    subject: { ...seed.subjects[0] }, roster: [], academicYear: '2026',
    schoolEn: seed.schoolEn, schoolCn: seed.schoolCn, period: 'Academic Year 2026' };
  app.click(app.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  app.click(app.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'data'));
  const ji = app.q('#json-import'); const txt = JSON.stringify(starter);
  Object.defineProperty(ji, 'files', { value: [{ name: 'starter.json', size: txt.length, text: async () => txt }], configurable: true });
  ji.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  await wait(300);
  report('15: a starter for another year is rejected, open workspace unchanged',
    app.store().academicYear === '2027' && app.store().students.length === 0
      && app.errs.some(e => e.includes('This starter is for academic year 2026')),
    app.store().academicYear);

  // Slow in-flight sync cancelled by a year switch writes nothing further
  const W = sbWorld();
  const slowFetch = async (url, o = {}) => {
    if (String(url).includes('/rest/v1/report_files') && (o.method || 'GET').toUpperCase() === 'GET')
      await wait(350);
    return W.fetch(url, o);
  };
  const capp = boot(slowFetch, SESSION_SEED());
  await capp.loginCloud('hsc-admin', 'AdminPass1!');
  await wait(2500);
  capp.click(capp.qa('.nav-btn').find(b => b.dataset.view === 'sync'));
  capp.click(capp.q('[data-action="sync-now"]'));
  await wait(60); // push is now in flight (its reads take ~350 ms each)
  const callsAtSwitch = W.calls.length;
  capp.click(capp.qa('.nav-btn').find(b => b.dataset.view === 'admin'));
  capp.click(capp.qa('[data-action="admin-tab"]').find(b => b.dataset.tab === 'settings'));
  capp.q('#ws-new-year').value = '2026';
  capp.click(capp.q('[data-action="ws-create"]'));
  await wait(8000);
  const lateLegacyWrites = W.calls.slice(callsAtSwitch).filter(c =>
    (c.method === 'POST' || c.method === 'PATCH') && String(c.url).includes('/rest/v1/report_files')
    && decodeURIComponent(String(c.url)).includes('path=eq.data/'));
  report('15: switching year mid-sync cancels the in-flight push (no legacy writes after the switch)',
    lateLegacyWrites.length === 0 && capp.store().academicYear === '2026',
    JSON.stringify(lateLegacyWrites.map(c => c.url)));
  report('15: after the switch, sync resumes against the new year prefix only',
    !!W.files.get('years/2026/data/settings.json')
      && (!W.files.get('data/settings.json') || String(W.files.get('data/settings.json').content?.academicYear || '') === '2027'),
    [...W.files.keys()].join(' | '));
  report('15: no uncaught errors (import/in-flight tests)',
    capp.errs.length === 0 && app.errs.filter(e => !e.includes('Import failed')).length === 0,
    (capp.errs[0] || app.errs.find(e => !e.includes('Import failed')) || ''));
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL TESTS PASSED');
process.exit(fails ? 1 : 0);
