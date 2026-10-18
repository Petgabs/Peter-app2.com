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
    appConfigMissing: !!opts.appConfigMissing, siteWritable: opts.siteWritable !== false, readFails: opts.readFails || 0, ghFiles: new Map(),
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
      if (m === 'GET') return respond(200, W.appConfig ? [{ value: W.appConfig }] : []); // staff may read the registry
      if (m === 'POST') {
        if (role !== 'admin') return respond(403, { message: 'row-level security' });
        W.appConfig = JSON.parse(o.body).value; W.appConfigWrites = (W.appConfigWrites || 0) + 1;
        return respond(201, []);
      }
    }
    if (u.includes('/rest/v1/profiles')) {
      const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const p = W.profiles.get(id);
      return respond(200, p ? [p] : []);
    }
    if (u.includes('/rest/v1/report_files')) {
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

console.log(fails ? `\n${fails} FAILURES` : '\nALL TESTS PASSED');
process.exit(fails ? 1 : 0);
