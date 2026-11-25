import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(window.CONFIG.url, window.CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true } });
const app = document.getElementById('app');
const S = { user: null, profile: null, st: null, timers: [], channel: null, urlCache: {} };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');
const phoneEmail = (p) => `p${digits(p)}@members.jackdan-match.app`;
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; if (S.channel) { sb.removeChannel(S.channel); S.channel = null; } }
function every(ms, fn) { const h = setInterval(fn, ms); S.timers.push(h); return h; }
function hms(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const p = (n) => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`; }
function render(html) { app.innerHTML = html; window.scrollTo(0, 0); }
const spinner = () => render('<div class="screen"><div class="spinner" aria-label="טוען"></div></div>');
const icon = {
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6"/></svg>',
  flag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
  home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9H3z"/></svg>',
  heart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6z"/></svg>',
  me: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
};
const ERR = {
  busy: 'יש לך כבר הצעה או צ\'אט פתוחים. אפשר רק אחד בכל פעם.',
  other_busy: 'הצד השני באמצע היכרות אחרת כרגע. נסו שוב מאוחר יותר.',
  not_compatible: 'ההתאמה כבר לא רלוונטית.', exists: 'כבר הייתה ביניכם הצעה.', not_found: 'ההצעה כבר לא בתוקף.',
  phone: 'צריך מספר וואטסאפ תקין.',
};
function errMsg(e) { const m = e?.message || ''; for (const k in ERR) if (m.includes(k)) return ERR[k]; return 'משהו השתבש, נסו שוב.'; }

async function signedUrls(paths) {
  const need = paths.filter((p) => p && !S.urlCache[p]);
  if (need.length) {
    const { data } = await sb.storage.from('photos').createSignedUrls(need, 3600);
    (data || []).forEach((d) => { if (d.signedUrl) S.urlCache[d.path] = d.signedUrl; });
  }
  return paths.map((p) => S.urlCache[p] || '');
}
async function compress(file) {
  const img = await createImageBitmap(file);
  const max = 1280, r = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
}
async function loadProfile() {
  if (!S.user) { S.profile = null; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  S.profile = data;
}
async function saveProfile(patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', S.user.id);
  if (error) throw error;
  Object.assign(S.profile, patch);
}
const VAPID = 'BF8lS93wvvgh_cC40FwxlyMj9ZXDh5oWDw4FB1_oPWg7DTFUvrCZt7WmfV18mvA07mguWuON52Kwlcu4Gf2SGjg';
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let swReg = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then((r) => { swReg = r; }).catch(() => {});
function b64u(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('ההתראות לא הודלקו. אפשר להדליק אותן בהגדרות הטלפון.'); return false; }
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: S.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) { toast('הדלקת ההתראות נכשלה, נסו שוב.'); return false; }
  toast('ההתראות דולקות'); return true;
}
async function pushBanner() {
  if (localStorage.getItem('jd_push_off')) return pushChip();
  if (isIOS && !standalone()) return `<div class="box" id="pushbox"><b style="font-weight:500">רוצה התראות על הצעות והודעות?</b><br>באייפון: לוחצים על כפתור השיתוף ואז "הוסף למסך הבית", ופותחים את האפליקציה משם.</div>`;
  if (!pushOk()) return '';
  if (Notification.permission === 'granted') {
    const reg = swReg || await navigator.serviceWorker.ready.catch(() => null);
    if (reg && await reg.pushManager.getSubscription()) return '';
  }
  if (Notification.permission === 'denied') return '';
  return `<div class="status" id="pushbox" style="background:#f5f5f5;color:#0a0a0a"><b style="font-weight:500;font-size:16px">שלא תפספס/י אף הצעה</b><span style="font-size:14px;color:#444">נשלח לך התראה כשמישהו רוצה להכיר, כשמגיעה הודעה וכשנשארות 10 שעות.</span>
    <button class="btn" id="pushon" type="button" style="height:48px;font-size:16px">הדלקת התראות</button><button class="linkbtn" id="pushlater" type="button" style="align-self:center">לא עכשיו</button></div>`;
}
async function pushNeeded() {
  if (isIOS && !standalone()) return 'ios';
  if (!pushOk() || Notification.permission === 'denied') return null;
  if (Notification.permission === 'granted') { const reg = swReg || await navigator.serviceWorker.ready.catch(() => null); if (reg && await reg.pushManager.getSubscription()) return null; }
  return 'off';
}
async function pushChip() {
  const n = await pushNeeded(); if (!n) return '';
  if (n === 'ios') return '<div class="alert" id="pushbox" style="background:#f5f5f5;color:#333"><span>להתראות באייפון: שיתוף ← "הוסף למסך הבית"</span></div>';
  return '<div class="alert" id="pushbox"><span>ההתראות כבויות. שלא תפספס/י הודעות</span><a href="#" id="pushon" role="button">הדלקה</a></div>';
}
function bindPush() {
  const on = document.getElementById('pushon'); if (on) on.onclick = async (ev) => { ev.preventDefault(); on.disabled = true; if (await enablePush()) document.getElementById('pushbox')?.remove(); else on.disabled = false; };
  const later = document.getElementById('pushlater'); if (later) later.onclick = () => { localStorage.setItem('jd_push_off', '1'); document.getElementById('pushbox')?.remove(); };
}
async function loadState() { const { data, error } = await sb.rpc('my_state'); if (!error) S.st = data; return S.st; }
function nav(active) {
  const dot = S.st && S.st.incoming && S.st.incoming.length ? '<span class="dot" aria-label="הצעה חדשה"></span>' : '';
  const a = (k, href, ic, label, extra = '') => `<a href="${href}" class="${active === k ? 'on' : ''}" ${active === k ? 'aria-current="page"' : ''}>${extra}${ic}${label}</a>`;
  return `<nav class="nav" aria-label="ניווט ראשי">${a('home', '#/home', icon.home, 'בית', dot)}${a('browse', '#/browse', icon.heart, 'התאמות')}${a('profile', '#/profile', icon.me, 'הפרופיל שלי')}</nav>`;
}
function chips(name, options, value, multi = false, small = false) {
  const vals = multi ? (value || []) : [value];
  return `<div class="chips" data-chips="${name}" data-multi="${multi}">${options.map(([v, l]) =>
    `<button type="button" class="chip${small ? ' sm' : ''}${vals.includes(v) ? ' on' : ''}" data-v="${esc(v)}" aria-pressed="${vals.includes(v)}">${esc(l)}</button>`).join('')}</div>`;
}
function bindChips(onChange) {
  app.querySelectorAll('[data-chips]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const multi = g.dataset.multi === 'true';
    if (multi) { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); }
    else { g.querySelectorAll('.chip').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
    onChange && onChange(g.dataset.chips);
  }));
}
function chipVal(name) {
  const g = app.querySelector(`[data-chips="${name}"]`); if (!g) return null;
  const on = [...g.querySelectorAll('.chip.on')].map((b) => b.dataset.v);
  return g.dataset.multi === 'true' ? on : (on[0] ?? null);
}
const age = (d) => { const b = new Date(d), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };

// ---------- questionnaire ----------
const QUESTIONS = [
  ['q1', 'ערב שישי מושלם בשבילך זה…', [['a', 'ארוחה משפחתית'], ['b', 'בית, שקט וסרט'], ['c', 'יציאה עם חברים'], ['d', 'בית כנסת ואז בית']]],
  ['q2', 'בחופשה הכי כיף לך…', [['a', 'ים ובטן גב'], ['b', 'טיול בטבע'], ['c', 'עיר ותרבות'], ['d', 'בבית עם המשפחה']]],
  ['q3', 'עם כסף את/ה יותר…', [['a', 'חוסך/ת'], ['b', 'נהנה/ית מהרגע'], ['c', 'באמצע']]],
  ['q4', 'בשלב הזה בחיים, מה קודם?', [['a', 'קריירה'], ['b', 'משפחה'], ['c', 'שתיהן באותה מידה']]],
  ['q5', 'חיות מחמד?', [['a', 'אוהב/ת ורוצה'], ['b', 'אוהב/ת, לא בבית'], ['c', 'לא בשבילי']]],
  ['q6', 'את/ה יותר…', [['a', 'איש/ת בוקר'], ['b', 'איש/ת לילה']]],
  ['q7', 'ספורט אצלך זה…', [['a', 'כמעט כל יום'], ['b', 'מדי פעם'], ['c', 'לא ממש']]],
  ['q8', 'איפה הכי מתאים לך לגור?', [['a', 'בעיר'], ['b', 'ביישוב שקט'], ['c', 'לא משנה לי']]],
  ['q9', 'אוכל אצלך זה…', [['a', 'מבשל/ת בבית'], ['b', 'אוהב/ת לצאת'], ['c', 'גם וגם']]],
  ['q10', 'כשיש ויכוח את/ה…', [['a', 'מדבר/ת על זה מיד'], ['b', 'צריך/ה זמן להירגע']]],
];
const REL = [['חילוני', 'חילוני/ת'], ['מסורתי', 'מסורתי/ת'], ['דתי', 'דתי/ה'], ['חרדי', 'חרדי/ת']];
const OBS = [['כן', 'כן'], ['חלקית', 'חלקית'], ['לא', 'לא']];

// ---------- screens ----------
function entry() {
  render(`<section class="entry" aria-label="מסך פתיחה">
    <video src="./cake.mp4" poster="./cake-poster.jpg" autoplay muted playsinline aria-label="עוגת חתונה של JackDan: החתן שובר כוס והזוג מתנשק מתחת לחופה"></video>
    <button class="skip" type="button" id="skip">דילוג</button>
    <div class="panel" id="panel">
      <h1>הצעד הראשון לחופה מתחיל כאן</h1>
      <p style="font-size:14px;color:#c8c8c8">היכרות אישית, דיסקרטית ובאישור שני הצדדים</p>
      <a class="btn light" href="#/register/1">הרשמה</a>
      <a class="btn ghost" href="#/login">כבר רשום/ה? כניסה</a>
    </div></section>`);
  const v = app.querySelector('video'), panel = document.getElementById('panel');
  const show = () => panel.classList.add('show');
  v.addEventListener('timeupdate', () => { if (v.currentTime >= 7.8) show(); });
  v.addEventListener('ended', show); v.addEventListener('error', show);
  document.getElementById('skip').onclick = () => { show(); v.pause(); };
  S.timers.push(setTimeout(show, 11000));
}

function login() {
  render(`<form class="screen" id="f" novalidate>
    <div class="top"><span class="brand">JackDan</span><a href="#/" class="linkbtn">חזרה</a></div>
    <h1>כניסה</h1>
    <label class="field">מספר טלפון<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="050-0000000" dir="ltr" style="text-align:right"></label>
    <label class="field">סיסמה<input name="pw" type="password" autocomplete="current-password"></label>
    <p class="err" id="err"></p>
    <div class="grow"></div>
    <button class="btn" type="submit">כניסה</button>
    <a href="#/register/1" class="btn ghost">עוד לא נרשמת? הרשמה</a>
  </form>`);
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = document.getElementById('err');
    if (digits(f.phone.value).length < 9 || !f.pw.value) { err.textContent = 'צריך טלפון וסיסמה.'; return; }
    f.querySelector('[type=submit]').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: phoneEmail(f.phone.value), password: f.pw.value });
    f.querySelector('[type=submit]').disabled = false;
    if (error) { err.textContent = 'הטלפון או הסיסמה לא נכונים.'; return; }
    await boot(); go(S.profile?.completed ? '#/home' : resumeStep());
  };
}

function progress(n, label) {
  return `<div class="progress"><div class="meta"><span>שלב ${n} מתוך 5</span><span>${label}</span></div><div class="bar"><i style="width:${n * 20}%"></i></div></div>`;
}
function resumeStep() { const n = Number(localStorage.getItem('jd_step') || 2); return `#/register/${Math.min(Math.max(n, 2), 5)}`; }
const isEdit = () => location.hash.startsWith('#/edit');
function stepFooter(next) {
  return isEdit() ? `<button class="btn" type="submit">שמירה</button><a href="#/profile" class="btn ghost">ביטול</a>` : `<button class="btn" type="submit">${next}</button>`;
}
async function afterStep(n) {
  if (isEdit()) { toast('נשמר'); go('#/profile'); return; }
  localStorage.setItem('jd_step', n + 1); go(n === 5 ? '#/home' : `#/register/${n + 1}`);
}

function step1() {
  if (S.user && S.profile) { go(resumeStep()); return; }
  render(`<form class="screen" id="f" novalidate>
    <div class="top"><span class="brand">JackDan</span><a href="#/" class="linkbtn">חזרה</a></div>
    ${progress(1, 'פרטים')}
    <h1>נעים להכיר</h1>
    <p class="muted">הפרופיל שלך מוצג רק לחברי הקהילה שנרשמו לאפליקציה.</p>
    <label class="field">שם פרטי<input name="name" autocomplete="given-name" maxlength="30"></label>
    <div class="group"><span class="label">אני</span>${chips('gender', [['m', 'גבר'], ['f', 'אישה']], null)}</div>
    <div class="row2">
      <label class="field">תאריך לידה<input name="birth" type="date" max="${new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10)}"></label>
      <label class="field">עיר<input name="city" autocomplete="address-level2" placeholder="נתניה"></label>
    </div>
    <label class="field">מספר טלפון (לכניסה)<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="050-0000000" dir="ltr" style="text-align:right"></label>
    <label class="field">סיסמה (לפחות 6 תווים)<input name="pw" type="password" autocomplete="new-password"></label>
    <label style="display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;color:#555"><input name="ok" type="checkbox" style="width:20px;height:20px;margin:0;accent-color:#0a0a0a">אני מעל גיל 18 ומסכים/ה שהפרטים שלי ישמשו להיכרויות באפליקציה בלבד</label>
    <p class="err" id="err"></p>
    <button class="btn" type="submit">המשך</button>
  </form>`);
  bindChips();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = document.getElementById('err');
    const g = chipVal('gender');
    if (!f.name.value.trim() || !g || !f.birth.value || !f.city.value.trim()) { err.textContent = 'צריך למלא שם, מגדר, תאריך לידה ועיר.'; return; }
    if (age(f.birth.value) < 18) { err.textContent = 'ההרשמה מגיל 18 ומעלה.'; return; }
    if (digits(f.phone.value).length < 9) { err.textContent = 'צריך מספר טלפון תקין.'; return; }
    if (f.pw.value.length < 6) { err.textContent = 'הסיסמה צריכה להיות לפחות 6 תווים.'; return; }
    if (!f.ok.checked) { err.textContent = 'צריך לאשר את התנאים.'; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; err.textContent = '';
    const { data, error } = await sb.auth.signUp({ email: phoneEmail(f.phone.value), password: f.pw.value });
    if (error || !data.user) { btn.disabled = false; err.textContent = /registered|exists/i.test(error?.message || '') ? 'המספר הזה כבר רשום. אפשר להיכנס.' : 'ההרשמה לא הצליחה, נסו שוב.'; return; }
    S.user = data.user;
    const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, name: f.name.value.trim(), gender: g, birth_date: f.birth.value, city: f.city.value.trim(), phone: digits(f.phone.value) });
    if (e2) { btn.disabled = false; err.textContent = 'שמירת הפרופיל נכשלה, נסו שוב.'; return; }
    await loadProfile(); afterStep(1);
  };
}

async function step2() {
  const p = S.profile, photos = [...(p.photos || [])];
  const draw = async () => {
    const urls = await signedUrls(photos);
    render(`<form class="screen" id="f">
      ${isEdit() ? '<div class="top"><span class="brand">JackDan</span></div>' : progress(2, 'תמונות')}
      <h1>תמונות שלך</h1>
      <p class="muted">2 עד 4 תמונות. הראשונה היא תמונת הפנים הראשית.</p>
      <div class="photos">
        ${photos.map((ph, i) => `<div class="slot"><img src="${esc(urls[i])}" alt="תמונה ${i + 1}">${i === 0 ? '<span class="main">ראשית</span>' : ''}<button type="button" class="x" data-del="${i}" aria-label="מחיקת תמונה">×</button></div>`).join('')}
        ${photos.length < 4 ? `<label class="slot add"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>הוספת תמונה<input type="file" accept="image/*" id="file" hidden></label>` : ''}
      </div>
      <p class="small">התמונות מוצגות רק למי שמתאים/ה לך. אפשר להחליף אותן בכל רגע.</p>
      <p class="err" id="err"></p>
      <div class="grow"></div>
      ${stepFooter('המשך')}
    </form>`);
    const file = document.getElementById('file');
    if (file) file.onchange = async () => {
      const fl = file.files[0]; if (!fl) return;
      document.getElementById('err').textContent = 'מעלה…';
      try {
        const blob = await compress(fl);
        const path = `${S.user.id}/${Date.now()}.jpg`;
        const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
        if (error) throw error;
        photos.push(path); await saveProfile({ photos }); draw();
      } catch { document.getElementById('err').textContent = 'ההעלאה נכשלה, נסו תמונה אחרת.'; }
    };
    app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const [rm] = photos.splice(Number(b.dataset.del), 1);
      await saveProfile({ photos }); sb.storage.from('photos').remove([rm]); draw();
    });
    document.getElementById('f').onsubmit = (e) => {
      e.preventDefault();
      if (photos.length < 2) { document.getElementById('err').textContent = 'צריך לפחות 2 תמונות.'; return; }
      afterStep(2);
    };
  };
  draw();
}

function step3() {
  const p = S.profile;
  const obsRow = (k, l) => `<div class="obs"><span>${l}</span>${chips(k, OBS, p[k], false, true)}</div>`;
  render(`<form class="screen" id="f">
    ${isEdit() ? '<div class="top"><span class="brand">JackDan</span></div>' : progress(3, 'רקע')}
    <h1>קצת רקע עלייך</h1>
    <div class="group"><span class="label">מצב משפחתי</span>${chips('marital', [['רווק', 'רווק/ה'], ['גרוש', 'גרוש/ה'], ['אלמן', 'אלמן/ה']], p.marital)}</div>
    <div class="group"><span class="label">ילדים</span>${chips('has_kids', [['no', 'אין לי ילדים'], ['yes', 'יש לי ילדים']], p.has_kids ? 'yes' : 'no')}</div>
    <div class="group"><span class="label">ילדים בעתיד</span>${chips('wants_kids', [['yes', 'רוצה'], ['open', 'פתוח/ה'], ['no', 'לא רוצה']], p.wants_kids || 'open')}</div>
    <div class="group"><span class="label">רמת דתיות</span>${chips('religiosity', REL, p.religiosity)}
      <div id="obs" style="display:flex;flex-direction:column">${obsRow('shabbat', 'שומר/ת שבת')}${obsRow('kashrut', 'שומר/ת כשרות')}${obsRow('negiah', 'שומר/ת נגיעה')}</div></div>
    <div class="row2">
      <label class="field">עיסוק<input name="occupation" value="${esc(p.occupation)}" maxlength="40"></label>
      <label class="field">גובה (ס"מ)<input name="height" type="number" inputmode="numeric" min="130" max="220" value="${esc(p.height)}"></label>
    </div>
    <div class="group"><span class="label">עישון</span>${chips('smoking', [['no', 'לא מעשן/ת'], ['yes', 'מעשן/ת']], p.smoking ? 'yes' : 'no')}</div>
    <label class="field">כמה מילים עלייך<textarea name="about" maxlength="300" placeholder="אוהב/ת ים, ארוחות שישי גדולות וטיולים בצפון">${esc(p.about)}</textarea></label>
    <p class="err" id="err"></p>
    ${stepFooter('המשך')}
  </form>`);
  const toggleObs = () => { const r = chipVal('religiosity'); document.getElementById('obs').style.display = (r === 'מסורתי' || r === 'דתי') ? 'flex' : 'none'; };
  bindChips(toggleObs); toggleObs();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = document.getElementById('err');
    const rel = chipVal('religiosity');
    if (!chipVal('marital') || !rel) { err.textContent = 'צריך לבחור מצב משפחתי ורמת דתיות.'; return; }
    const showObs = rel === 'מסורתי' || rel === 'דתי';
    try {
      await saveProfile({
        marital: chipVal('marital'), has_kids: chipVal('has_kids') === 'yes', wants_kids: chipVal('wants_kids'), religiosity: rel,
        shabbat: showObs ? chipVal('shabbat') : null, kashrut: showObs ? chipVal('kashrut') : null, negiah: showObs ? chipVal('negiah') : null,
        occupation: f.occupation.value.trim() || null, height: f.height.value ? Number(f.height.value) : null,
        smoking: chipVal('smoking') === 'yes', about: f.about.value.trim() || null,
      });
      afterStep(3);
    } catch { err.textContent = 'השמירה נכשלה, נסו שוב.'; }
  };
}

function step4() {
  const p = S.profile, mine = age(p.birth_date);
  const dMin = p.pref_age_min && p.pref_age_min !== 18 ? p.pref_age_min : Math.max(18, mine - (p.gender === 'm' ? 8 : 3));
  const dMax = p.pref_age_max && p.pref_age_max !== 99 ? p.pref_age_max : mine + (p.gender === 'm' ? 3 : 8);
  render(`<form class="screen" id="f">
    ${isEdit() ? '<div class="top"><span class="brand">JackDan</span></div>' : progress(4, 'מה אני מחפש/ת')}
    <h1>את מי את/ה מחפש/ת?</h1>
    <p class="muted" style="font-size:14px">מי שמתאים/ה לזה יופיע/ו אצלך ראשונים, עם אחוז התאמה גבוה יותר.</p>
    <div class="group"><span class="label">טווח גילאים</span><div class="row2">
      <label class="field">מגיל<input name="min" type="number" inputmode="numeric" min="18" max="99" value="${dMin}"></label>
      <label class="field">עד גיל<input name="max" type="number" inputmode="numeric" min="18" max="99" value="${dMax}"></label></div></div>
    <div class="group"><span class="label">אזור</span>${chips('area', [['city', 'רק בעיר שלי'], ['all', 'כל הארץ']], p.pref_area || 'all')}</div>
    <div class="group"><span class="label">רמת דתיות מועדפת (אפשר כמה, או אף אחת = לא משנה)</span>${chips('rel', REL, p.pref_religiosity || [], true)}</div>
    <div class="group"><span class="label">פחות מתאים לי</span><div class="chips">
      <button type="button" class="chip${p.no_smoker ? ' on' : ''}" data-flag="no_smoker" aria-pressed="${!!p.no_smoker}">מעשן/ת</button>
      <button type="button" class="chip${p.no_kids ? ' on' : ''}" data-flag="no_kids" aria-pressed="${!!p.no_kids}">עם ילדים</button></div></div>
    <p class="err" id="err"></p>
    <div class="grow"></div>
    ${stepFooter('המשך')}
  </form>`);
  bindChips();
  app.querySelectorAll('[data-flag]').forEach((b) => b.onclick = () => { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); });
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = document.getElementById('err');
    const mn = Number(f.min.value), mx = Number(f.max.value);
    if (!(mn >= 18 && mx <= 99 && mn <= mx)) { err.textContent = 'טווח הגילאים לא תקין.'; return; }
    try {
      await saveProfile({ pref_age_min: mn, pref_age_max: mx, pref_area: chipVal('area'), pref_religiosity: chipVal('rel'),
        no_smoker: app.querySelector('[data-flag=no_smoker]').classList.contains('on'), no_kids: app.querySelector('[data-flag=no_kids]').classList.contains('on') });
      afterStep(4);
    } catch { err.textContent = 'השמירה נכשלה, נסו שוב.'; }
  };
}

function step5() {
  const answers = { ...(S.profile.answers || {}) };
  let i = 0;
  const draw = () => {
    const [k, q, opts] = QUESTIONS[i];
    render(`<div class="screen">
      ${isEdit() ? '<div class="top"><span class="brand">JackDan</span></div>' : progress(5, `שאלה ${i + 1} מתוך ${QUESTIONS.length}`)}
      ${isEdit() ? `<p class="small">שאלה ${i + 1} מתוך ${QUESTIONS.length}</p>` : ''}
      <h1>${esc(q)}</h1>
      <div style="display:flex;flex-direction:column;gap:10px">${opts.map(([v, l]) => `<button type="button" class="chip${answers[k] === v ? ' on' : ''}" style="height:56px;border-radius:14px;font-size:16px" data-a="${v}">${esc(l)}</button>`).join('')}</div>
      <div class="grow"></div>
      <div style="display:flex;gap:10px">${i > 0 ? '<button class="btn ghost" style="width:110px" id="back" type="button">חזרה</button>' : ''}<p class="small" style="align-self:center">לחיצה על תשובה עוברת לשאלה הבאה</p></div>
    </div>`);
    app.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
      answers[k] = b.dataset.a;
      if (i < QUESTIONS.length - 1) { i++; draw(); return; }
      spinner();
      try { await saveProfile({ answers, completed: true }); await loadState(); afterStep(5); if (!isEdit()) toast('ברוכים הבאים!'); }
      catch { toast('השמירה נכשלה, נסו שוב.'); draw(); }
    });
    const back = document.getElementById('back'); if (back) back.onclick = () => { i--; draw(); };
  };
  draw();
}

async function home() {
  const st = await loadState();
  const chat = (st.chats || []).find((c) => c.open && !c.matched);
  const matched = (st.chats || []).filter((c) => c.matched);
  const inc = st.incoming || [];
  const avatars = await signedUrls([...(chat ? [chat.partner.photos?.[0]] : []), ...inc.map((x) => x.person.photos?.[0])]);
  let k = 0;
  const av = () => { const u = avatars[k++]; return `<div class="avatar">${u ? `<img src="${esc(u)}" alt="">` : ''}</div>`; };
  let main = '';
  if (chat) {
    main = `<a href="#/chat/${chat.id}" class="status"><span class="sub">עכשיו אצלך</span>
      <div style="display:flex;align-items:center;gap:12px">${av()}<div style="display:flex;flex-direction:column"><span style="font-size:18px;font-weight:500">צ'אט פעיל עם ${esc(chat.partner.name)}</span>
      <span class="sub">${chat.my_decision === true ? 'בחרת להמשיך. מחכים לצד השני' : 'לחיצה לפתיחת הצ\'אט'}</span></div></div>
      <div class="line"><span class="sub">נשאר לכם</span><b data-ends="${chat.ends_at}" style="font-weight:500;direction:ltr;font-variant-numeric:tabular-nums">--:--:--</b></div></a>`;
  } else if (st.outgoing) {
    main = `<div class="status"><span class="sub">ההצעה שלך נשלחה</span><span style="font-size:18px;font-weight:500">מחכים לתשובה של ${esc(st.outgoing.name)}</span>
      <div class="line"><span class="sub">ההצעה בתוקף עוד</span><b data-ends="${st.outgoing.expires_at}" style="font-weight:500;direction:ltr">--:--:--</b></div></div>`;
  } else {
    main = `<div class="status"><span class="sub">עכשיו אצלך</span><span style="font-size:18px;font-weight:500">אין לך היכרות פתוחה</span>
      <a href="#/browse" class="btn light" style="height:48px;font-size:16px">לראות את ההתאמות שלי</a></div>`;
  }
  const incHtml = inc.length ? `<div class="group"><h2>הצעות שמחכות לך</h2>${inc.map((x) => `<a href="#/p/${x.id}" class="list" style="text-decoration:none"><span style="display:flex;align-items:center;gap:12px;padding:10px 14px">${av()}<span style="display:flex;flex-direction:column;flex:1"><b style="font-weight:500">${esc(x.person.name)}, ${x.person.age}</b><span class="small">${esc(x.person.city)} · ${x.person.score}% התאמה</span></span><span class="small">לצפייה ‹</span></span></a>`).join('')}</div>` : '';
  const matchHtml = matched.length ? `<div class="group"><h2>ממשיכים בפרטי</h2>${matched.map((m) => `<a href="#/match/${m.id}" class="list" style="text-decoration:none"><span style="display:flex;justify-content:space-between;padding:16px">${esc(m.partner.name)}<span class="small">לוואטסאפ ‹</span></span></a>`).join('')}</div>` : '';
  render(`<div class="screen">
    <div class="top"><span class="brand">JackDan</span><span class="small" style="font-size:14px">שלום ${esc(S.profile.name)}</span></div>
    ${await pushBanner()}
    ${S.profile.frozen ? '<div class="box">הפרופיל שלך מוקפא ולא מוצג לאחרים. אפשר להחזיר אותו מהפרופיל.</div>' : ''}
    ${main}${incHtml}${matchHtml}
    <div class="group"><h2>איך זה עובד</h2><div class="box" style="background:#fff;border:1px solid #e4e4e4">
      1. גוללים בהתאמות ושולחים הצעה אחת בכל פעם.<br>2. אם הצד השני מאשר, יש לכם 48 שעות לדבר.<br>3. שניכם רוצים להמשיך? מקבלים את הוואטסאפ.</div></div>
  </div>${nav('home')}`);
  bindPush();
  const tick = () => app.querySelectorAll('[data-ends]').forEach((el) => { el.textContent = hms(new Date(el.dataset.ends) - Date.now()); });
  tick(); every(1000, tick);
  every(30000, async () => { const before = JSON.stringify(S.st); await loadState(); if (JSON.stringify(S.st) !== before && location.hash === '#/home') route(); });
}

async function browse() {
  spinner(); await loadState();
  const { data, error } = await sb.rpc('get_matches');
  if (error) { render(`<div class="screen"><p class="err">הטעינה נכשלה.</p></div>${nav('browse')}`); return; }
  const list = data || []; let i = 0, ph = 0;
  const draw = async () => {
    if (!list.length || i >= list.length) {
      render(`<div class="screen"><div class="top"><span class="brand">JackDan</span></div><h1>ההתאמות שלך</h1>
        <div class="empty"><p style="font-size:17px">${list.length ? 'זהו, ראית את כולם להיום' : 'עוד אין התאמות בשבילך'}</p><p class="small">כל יום מצטרפים חדשים. כדאי לחזור לבדוק.</p>
        ${list.length ? '<button class="btn ghost" id="again" type="button" style="width:auto;padding:0 20px">להתחיל מההתחלה</button>' : '<a href="#/edit/4" class="btn ghost" style="width:auto;padding:0 20px">להרחיב את מה שאני מחפש/ת</a>'}</div></div>${nav('browse')}`);
      const a = document.getElementById('again'); if (a) a.onclick = () => { i = 0; draw(); };
      return;
    }
    const m = list[i], urls = await signedUrls(m.photos || []); const chip = await pushChip();
    const tags = [m.religiosity, m.occupation].filter(Boolean);
    render(`<div class="screen">
      <div class="top"><span class="brand">JackDan</span><span class="small" style="font-size:13px">${i + 1} מתוך ${list.length}</span></div>
      ${chip}
      <div class="card">
        <div class="ph" id="ph">${urls[ph] ? `<img src="${esc(urls[ph])}" alt="תמונה של ${esc(m.name)}">` : icon.user}
          <span class="badge">${m.score}% התאמה</span>
          ${urls.length > 1 ? `<div class="dots">${urls.map((_, j) => `<i class="${j === ph ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>
        <div class="body">
          <div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:22px;font-weight:500">${esc(m.name)}, ${m.age}</span><span class="small" style="font-size:14px">${esc(m.city)}</span></div>
          ${tags.length ? `<div class="chips" style="gap:6px">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          ${m.about ? `<p style="font-size:14px;line-height:1.55;color:#333">${esc(m.about)}</p>` : ''}
        </div></div>
      ${S.st.busy ? '<p class="small" style="text-align:center">יש לך כבר הצעה או צ\'אט פתוחים. אפשר לשלוח הצעה חדשה כשהם ייסגרו.</p>' : ''}
      <div style="display:flex;gap:10px"><button class="btn ghost" style="width:110px;height:54px" id="next" type="button">הבא</button>
        <button class="btn" id="send" type="button" ${S.st.busy ? 'disabled' : ''}>שליחת הצעה</button></div>
    </div>${nav('browse')}`);
    bindPush();
    document.getElementById('ph').onclick = () => { if (urls.length > 1) { ph = (ph + 1) % urls.length; draw(); } };
    document.getElementById('next').onclick = () => { i++; ph = 0; draw(); };
    document.getElementById('send').onclick = async (e) => {
      e.target.disabled = true;
      const { error: er } = await sb.rpc('send_proposal', { target: m.id });
      if (er) { toast(errMsg(er)); e.target.disabled = false; return; }
      toast(`ההצעה נשלחה ל${m.name}. יש לו/ה 24 שעות לענות.`); go('#/home');
    };
  };
  draw();
}

async function proposal(id) {
  await loadState();
  const x = (S.st.incoming || []).find((p) => p.id === id);
  if (!x) { toast('ההצעה כבר לא בתוקף'); go('#/home'); return; }
  const m = x.person, urls = await signedUrls(m.photos || []); let ph = 0; const chip = await pushChip();
  const draw = () => {
    render(`<div class="screen">
      <div class="top"><span class="brand">JackDan</span><span class="small">הצעה חדשה · עוד <b data-ends="${x.expires_at}" style="font-weight:500;direction:ltr">--</b></span></div>
      ${chip}
      <h1>${esc(m.name)} רוצה להכיר אותך</h1>
      <div class="card"><div class="ph" id="ph">${urls[ph] ? `<img src="${esc(urls[ph])}" alt="תמונה של ${esc(m.name)}">` : icon.user}<span class="badge">${m.score}% התאמה</span>
        ${urls.length > 1 ? `<div class="dots">${urls.map((_, j) => `<i class="${j === ph ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>
        <div class="body"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:22px;font-weight:500">${esc(m.name)}, ${m.age}</span><span class="small" style="font-size:14px">${esc(m.city)} · ${esc(m.religiosity || '')}</span></div>
        ${m.about ? `<p style="font-size:14px;line-height:1.55;color:#333"><b style="font-weight:500">על עצמו/ה:</b> ${esc(m.about)}</p>` : ''}</div></div>
      <button class="btn" id="yes" type="button">מעוניין/ת</button>
      <button class="btn ghost" id="no" type="button">לא הפעם</button>
      <p class="small" style="text-align:center">התשובה שלך דיסקרטית. אם תסרב/י, הצד השני לא יידע מי.</p>
    </div>${nav('home')}`);
    document.getElementById('ph').onclick = () => { if (urls.length > 1) { ph = (ph + 1) % urls.length; draw(); } };
    bindPush();
    document.getElementById('yes').onclick = async (e) => {
      e.target.disabled = true; const { error } = await sb.rpc('respond_proposal', { pid: id, accept: true });
      if (error) { toast(errMsg(error)); e.target.disabled = false; return; } go(`#/chat/${id}`);
    };
    document.getElementById('no').onclick = async () => { await sb.rpc('respond_proposal', { pid: id, accept: false }); toast('סגרנו בעדינות'); go('#/home'); };
    const t = () => app.querySelectorAll('[data-ends]').forEach((el) => { el.textContent = hms(new Date(el.dataset.ends) - Date.now()); }); t();
  };
  draw(); every(1000, () => app.querySelectorAll('[data-ends]').forEach((el) => { el.textContent = hms(new Date(el.dataset.ends) - Date.now()); }));
}

async function chat(id) {
  await loadState();
  const c = (S.st.chats || []).find((x) => x.id === id);
  if (!c) { go('#/home'); return; }
  if (c.matched) { go(`#/match/${id}`); return; }
  const [avatar] = await signedUrls([c.partner.photos?.[0]]);
  const { data: msgs } = await sb.from('messages').select('*').eq('proposal_id', id).order('created_at');
  const ends = new Date(c.ends_at).getTime();
  const msgHtml = (m) => `<div class="msg ${m.sender_id === S.user.id ? 'me' : 'them'}">${esc(m.body)}</div>`;
  render(`<section class="chat">
    <header>
      <a href="#/home" aria-label="חזרה" style="text-decoration:none;font-size:22px;padding:4px">›</a>
      <div class="avatar" style="width:40px;height:40px;background:#ededed">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}</div>
      <div style="flex:1;display:flex;flex-direction:column"><b style="font-weight:500;font-size:17px">${esc(c.partner.name)}</b><span class="small">היכרות דרך JackDan</span></div>
      <div class="timer" role="timer" aria-label="הזמן שנשאר לשיחה" id="timer">${icon.clock}<span id="left">--:--:--</span></div>
      <button type="button" id="report" aria-label="דיווח או חסימה" style="width:40px;height:40px;border:none;background:none;cursor:pointer">${icon.flag}</button>
    </header>
    ${await pushChip()}
    <div id="alert"></div>
    <div class="msgs" id="msgs"><div class="sys" style="text-align:right;max-width:320px"><b style="font-weight:500">איך זה עובד? בקצרה:</b><br>יש לכם 48 שעות להכיר כאן בצ'אט. מרגישים שזה זה? כל אחד לוחץ "להמשיך בפרטי" ומשאיר לשדכן מספר וואטסאפ. רק כששניכם מוכנים, השדכן מעביר לכם את המספרים.<br>אם תוך 48 שעות זה לא קרה, כנראה שזה לא השידוך, והשיחה תיסגר בכבוד. בהצלחה!</div>${(msgs || []).map(msgHtml).join('')}</div>
    ${c.open ? `<form class="composer" id="cf"><label style="flex:1;display:flex"><span style="position:absolute;width:1px;height:1px;overflow:hidden">הודעה</span><input id="txt" autocomplete="off" maxlength="1000" placeholder="כתיבת הודעה…"></label><button type="submit" aria-label="שליחה">${icon.send}</button></form>`
      : '<div class="box" style="margin:12px">השיחה נסגרה.</div>'}
  </section>`);
  bindPush();
  const box = document.getElementById('msgs'); box.scrollTop = box.scrollHeight;
  const tick = () => {
    const left = ends - Date.now(); document.getElementById('left').textContent = hms(left);
    document.getElementById('timer').classList.toggle('low', left < 10 * 3600e3);
    const al = document.getElementById('alert');
    const html = c.my_decision === true ? '<div class="alert"><span>בחרת להמשיך. מחכים לצד השני</span></div>'
      : left < 10 * 3600e3 ? `<div class="alert"><span>נשארו לכם פחות מ-10 שעות. רוצה להמשיך?</span><a href="#/decide/${id}">להחליט</a></div>`
      : `<div class="alert" style="background:#f5f5f5;color:#333"><span>אהבת? אפשר להחליט מתי שרוצים</span><a href="#/decide/${id}" style="background:#0a0a0a;color:#fff">להמשיך בפרטי</a></div>`;
    if (al.innerHTML !== html) al.innerHTML = html;
    if (left <= 0 && c.open) route();
  };
  tick(); every(1000, tick);
  const f = document.getElementById('cf');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault(); const t = document.getElementById('txt'); const body = t.value.trim(); if (!body) return;
    t.value = ''; const { error } = await sb.from('messages').insert({ proposal_id: id, sender_id: S.user.id, body });
    if (error) { toast('ההודעה לא נשלחה'); t.value = body; }
  };
  S.channel = sb.channel(`m-${id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `proposal_id=eq.${id}` }, (p) => {
    box.insertAdjacentHTML('beforeend', msgHtml(p.new)); box.scrollTop = box.scrollHeight;
  }).subscribe();
  every(20000, async () => { await loadState(); const n = (S.st.chats || []).find((x) => x.id === id); if (!n || n.matched || n.open !== c.open) route(); });
  document.getElementById('report').onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = '1'; toast('לחיצה נוספת תדווח ותסגור את השיחה'); setTimeout(() => delete b.dataset.sure, 4000); return; }
    await sb.rpc('report_user', { target: c.partner.id }); toast('דיווחת. השיחה נסגרה.'); go('#/home');
  };
}

async function decide(id) {
  await loadState();
  const c = (S.st.chats || []).find((x) => x.id === id);
  if (!c || !c.open) { go('#/home'); return; }
  if (c.matched) { go(`#/match/${id}`); return; }
  let step = c.my_decision === true ? 'waiting' : 'ask'; const chip = await pushChip();
  const draw = () => {
    const body = step === 'ask' ? `<h1>רוצה להמשיך להכיר את ${esc(c.partner.name)}?</h1>
        <p class="muted">אם שניכם תבחרו להמשיך, תמשיכו לדבר באופן פרטי. אם לא, השיחה תיסגר בכבוד, ואף אחד לא יידע מי בחר מה.</p>
        <div class="grow"></div><button class="btn" id="yes" type="button">כן, להמשיך</button><button class="btn ghost" id="no" type="button">לסגור בכבוד</button>
        <p class="small" style="text-align:center">אם לא תבחר/י עד שהזמן נגמר, השיחה תיסגר מעצמה</p>`
      : step === 'phone' ? `<h1>איזה כיף! עוד צעד קטן</h1>
        <p class="muted">השאר/י מספר וואטסאפ. ברגע ששניכם תאשרו ותמלאו מספר, השדכן יעביר לכם את המספרים ותמשיכו לדבר בפרטי.</p>
        <label class="field">מספר וואטסאפ<input id="wa" type="tel" inputmode="tel" value="${esc(S.profile.phone)}" dir="ltr" style="text-align:right;font-size:17px"></label>
        <p class="err" id="err"></p><div class="grow"></div><button class="btn" id="send" type="button">אישור ושליחה</button>
        <p class="small" style="text-align:center">המספר נשמר אצלנו ונחשף לצד השני רק אם גם הוא מאשר</p>`
      : `<div class="group center" style="text-align:center"><div class="ring"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></div>
        <h1>שמרנו! עכשיו מחכים ל${esc(c.partner.name)}</h1><p class="muted">ברגע שגם הצד השני יאשר וימלא מספר, תקבלו שניכם מיד את מספרי הוואטסאפ. אנחנו מחזיקים לכם אצבעות.</p></div>
        <div class="grow"></div><a href="#/chat/${id}" class="btn ghost">חזרה לצ'אט</a>`;
    render(`<div class="screen"><div class="top"><span class="brand">JackDan</span><a href="#/chat/${id}" class="linkbtn">חזרה לצ'אט</a></div>
      ${chip}<div class="clock">${icon.clock.replace('width="14" height="14"', 'width="30" height="30"')}<b id="left">--:--:--</b><span style="font-size:14px;color:#cfcfcf">נשארו לשיחה עם ${esc(c.partner.name)}</span></div>${body}</div>`);
    bindPush();
    const y = document.getElementById('yes'); if (y) y.onclick = () => { step = 'phone'; draw(); };
    const n = document.getElementById('no'); if (n) n.onclick = async () => { await sb.rpc('decide', { pid: id, keep: false, wa: null }); toast('השיחה נסגרה בכבוד'); go('#/home'); };
    const s = document.getElementById('send'); if (s) s.onclick = async () => {
      const wa = document.getElementById('wa').value;
      if (digits(wa).length < 9) { document.getElementById('err').textContent = 'צריך מספר וואטסאפ תקין.'; return; }
      s.disabled = true; const { error } = await sb.rpc('decide', { pid: id, keep: true, wa });
      if (error) { s.disabled = false; toast(errMsg(error)); return; }
      await loadState(); const now = (S.st.chats || []).find((x) => x.id === id);
      if (now?.matched) go(`#/match/${id}`); else { step = 'waiting'; draw(); }
    };
    tick();
  };
  const tick = () => { const el = document.getElementById('left'); if (el) el.textContent = hms(new Date(c.ends_at) - Date.now()); };
  draw(); every(1000, tick);
  every(15000, async () => { if (step !== 'waiting') return; await loadState(); const now = (S.st.chats || []).find((x) => x.id === id); if (now?.matched) go(`#/match/${id}`); });
}

async function match(id) {
  await loadState();
  const c = (S.st.chats || []).find((x) => x.id === id && x.matched);
  if (!c) { go('#/home'); return; }
  const [avatar] = await signedUrls([c.partner.photos?.[0]]);
  let d = digits(c.partner_whatsapp); if (d.startsWith('0')) d = '972' + d.slice(1);
  render(`<div class="screen">
    <span class="brand" style="align-self:center">JackDan</span>
    <div class="group center" style="text-align:center"><div class="ring">${icon.heart}</div><h1>שניכם בחרתם להמשיך</h1>
      <p class="muted">מכאן ממשיכים בפרטי. הנה הוואטסאפ של ${esc(c.partner.name)}:</p></div>
    <div class="list" style="flex-direction:row;align-items:center;gap:14px;padding:16px"><div class="avatar" style="width:52px;height:52px;background:#ededed">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}</div>
      <div style="display:flex;flex-direction:column"><b style="font-weight:500;font-size:18px">${esc(c.partner.name)}</b><span dir="ltr" style="text-align:right">${esc(c.partner_whatsapp)}</span></div></div>
    <div class="row2"><a class="btn" href="https://wa.me/${d}" target="_blank" rel="noopener">פתיחה בוואטסאפ</a><a class="btn ghost" style="height:54px" href="tel:${esc(digits(c.partner_whatsapp))}">התקשרות</a></div>
    <div class="grow"></div>
    <div class="wedding"><p>ורק בקשה קטנה מאיתנו:<br>כשזה יגיע לחופה, אל תשכחו להזמין אותנו לחתונה</p>
      <p style="font-size:14px;line-height:1.5;color:#333">ואת השיער והאיפור לחתונה? נראה לנו שאתם כבר יודעים איפה סוגרים ;)</p></div>
    <a href="#/home" class="btn ghost">בהצלחה! חזרה לדף הבית</a>
  </div>`);
}

async function profile() {
  const p = S.profile; const [avatar] = await signedUrls([p.photos?.[0]]);
  render(`<div class="screen">
    <h1>הפרופיל שלי</h1>
    <div style="display:flex;align-items:center;gap:14px"><div class="avatar" style="width:76px;height:76px;border-radius:38px;background:#ededed">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}</div>
      <div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:20px;font-weight:500">${esc(p.name)}, ${age(p.birth_date)}</b><span class="small" style="font-size:14px">${esc(p.city)}${p.religiosity ? ' · ' + esc(p.religiosity) : ''}</span></div></div>
    <div class="list">
      <a href="#/edit/2">עריכת תמונות<span aria-hidden="true">‹</span></a><a href="#/edit/3">פרטים ורקע<span aria-hidden="true">‹</span></a>
      <a href="#/edit/4">מה אני מחפש/ת<span aria-hidden="true">‹</span></a><a href="#/edit/5">שאלון אישיות<span aria-hidden="true">‹</span></a></div>
    <div class="list" style="flex-direction:row;align-items:center;justify-content:space-between;padding:14px 16px;gap:12px">
      <span style="display:flex;flex-direction:column;gap:2px"><b style="font-weight:500">הקפאת פרופיל</b><span class="small">לא תופיע/י אצל אחרים עד שתחזיר/י</span></span>
      <button type="button" class="switch" role="switch" aria-checked="${!!p.frozen}" aria-label="הקפאת פרופיל" id="freeze"><i></i></button></div>
    ${pushOk() && Notification.permission !== 'granted' ? '<button class="btn ghost" id="pushon" type="button">הדלקת התראות</button>' : ''}
    <div class="grow"></div>
    <button class="btn ghost" id="logout" type="button">התנתקות</button>
    <button class="linkbtn" id="del" type="button" style="color:#a32d2d">מחיקת החשבון</button>
  </div>${nav('profile')}`);
  bindPush();
  document.getElementById('freeze').onclick = async (e) => { const v = !S.profile.frozen; await saveProfile({ frozen: v }); e.currentTarget.setAttribute('aria-checked', v); toast(v ? 'הפרופיל מוקפא' : 'הפרופיל חזר להופיע'); };
  document.getElementById('logout').onclick = async () => { await sb.auth.signOut(); S.user = null; S.profile = null; go('#/'); };
  document.getElementById('del').onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'בטוח/ה? לחיצה נוספת מוחקת הכול לצמיתות'; return; }
    await sb.rpc('delete_me'); await sb.auth.signOut(); localStorage.removeItem('jd_step'); S.user = null; S.profile = null; toast('החשבון נמחק'); go('#/');
  };
}

// ---------- router ----------
async function route() {
  clearTimers();
  const h = location.hash || '#/';
  const [, a, b] = h.split('/');
  const authed = !!S.user;
  if (!authed && !['', 'login', 'register'].includes(a || '')) { go('#/'); return; }
  if (authed && !S.profile && a !== 'register') { go('#/register/1'); return; }
  if (authed && S.profile && !S.profile.completed && !['register'].includes(a)) { go(resumeStep()); return; }
  if (authed && S.profile?.completed && (!a || a === 'login' || a === 'register')) { go('#/home'); return; }
  try {
    switch (a || '') {
      case '': return entry();
      case 'login': return login();
      case 'register': case 'edit': {
        const n = Number(b) || 1;
        if (n > 1 && !S.profile) { go('#/register/1'); return; }
        return [step1, step2, step3, step4, step5][n - 1]();
      }
      case 'home': return home();
      case 'browse': return browse();
      case 'p': return proposal(b);
      case 'chat': return chat(b);
      case 'decide': return decide(b);
      case 'match': return match(b);
      case 'profile': return profile();
      default: go('#/');
    }
  } catch (e) { console.error(e); render('<div class="screen"><p class="err">משהו השתבש. נסו לרענן.</p></div>'); }
}

async function boot() {
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user || null;
  await loadProfile();
}
window.addEventListener('hashchange', route);
spinner();
await boot();
route();
