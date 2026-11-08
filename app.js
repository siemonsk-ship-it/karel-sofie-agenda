import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://zmrwhlsnftvdpmcsjuii.supabase.co";
const SUPABASE_KEY = "sb_publishable_iOJIZswa4AIfuipwxB76TQ_7Lbd_Do1";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const EMOJI = ["💛", "🍝", "🎬", "🎉", "✈️", "🏠", "🏃", "🎂", "☕", "🛒", "👨‍👩‍👧", "🍷"];
const OTHER = { Karel: "Sofie", Sofie: "Karel" };
const WHO_LABEL = { samen: "Samen", karel: "Karel", sofie: "Sofie" };
const $ = (id) => document.getElementById(id);
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let me = null;
let events = [];
let loaded = false;
const now = new Date();
let cur = new Date(now.getFullYear(), now.getMonth(), 1);
let sel = ymd(now);
let form = { who: "samen", emoji: EMOJI[0] };
let confirmDel = null;
let channel = null;
let impSource = null;     // { last_synced, last_error } or null
let impItems = [];        // items with state 'new'
let impLoaded = false, impBusy = false, confirmUnlink = false;

/* ---------- helpers ---------- */
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function parse(s) { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
const fMonth = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" });
const fDay = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const fShort = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short" });
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const fDM = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
function addDays(k, n) { const d = parse(k); d.setDate(d.getDate() + n); return ymd(d); }
function spans(ev) { return !!ev.end_date && ev.end_date > ev.date; }
function daysOf(ev) { const out = [ev.date]; if (!spans(ev)) return out; let k = ev.date; while (k < ev.end_date && out.length < 64) { k = addDays(k, 1); out.push(k); } return out; }
function timeText(ev) {
  if (!spans(ev)) return ev.all_day ? "Hele dag" : (ev.start_time || "") + (ev.end_time ? " – " + ev.end_time : "");
  const a = fDM.format(parse(ev.date)), b = fDM.format(parse(ev.end_date));
  return ev.all_day ? a + " t/m " + b : a + " " + ev.start_time + " – " + b + (ev.end_time ? " " + ev.end_time : "");
}
function whenText(ev) { return spans(ev) ? timeText(ev) : fShort.format(parse(ev.date)) + " · " + timeText(ev); }
function sortEv(a, b) { return (a.date + (a.all_day ? "00" : a.start_time || "")).localeCompare(b.date + (b.all_day ? "00" : b.start_time || "")); }
function showNote(t) { $("note").textContent = t || ""; $("note").hidden = !t; }

/* ---------- holidays ---------- */
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114; return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1); }
const hCache = {};
function holidays(y) {
  if (hCache[y]) return hCache[y];
  const H = {}; const D = (m, d) => new Date(y, m - 1, d); const E = easter(y); const off = (n) => new Date(y, E.getMonth(), E.getDate() + n);
  const add = (d, full, short) => { const k = ymd(d); if (H[k]) H[k].full += " & " + full; else H[k] = { full, short }; };
  const nthSun = (m, n) => { const f = D(m, 1); return D(m, 1 + (7 - f.getDay()) % 7 + 7 * (n - 1)); };
  add(D(1, 1), "Nieuwjaarsdag", "Nieuwjaar"); add(D(2, 14), "Valentijnsdag", "Valentijn");
  add(off(-2), "Goede Vrijdag", "Goede Vr."); add(E, "Eerste Paasdag", "Pasen"); add(off(1), "Tweede Paasdag", "2e Pasen");
  let kd = D(4, 27); if (kd.getDay() === 0) kd = D(4, 26); add(kd, "Koningsdag", "Koningsdag");
  add(D(5, 5), "Bevrijdingsdag", "Bevrijding"); add(off(39), "Hemelvaartsdag", "Hemelvaart");
  add(nthSun(5, 2), "Moederdag", "Moederdag"); add(off(49), "Eerste Pinksterdag", "Pinksteren"); add(off(50), "Tweede Pinksterdag", "2e Pinkst.");
  add(nthSun(6, 3), "Vaderdag", "Vaderdag"); add(D(12, 5), "Pakjesavond", "Sinterklaas");
  add(D(12, 25), "Eerste Kerstdag", "Kerst"); add(D(12, 26), "Tweede Kerstdag", "2e Kerst"); add(D(12, 31), "Oudejaarsavond", "Oudjaar");
  return (hCache[y] = H);
}

/* ---------- login ---------- */
let createMode = false;
function setLoginMode(c) {
  createMode = c;
  $("loginLead").textContent = c ? "Kies je eigen wachtwoord. Dat doe je maar één keer." : "Log in om jullie agenda te openen.";
  $("loginBtn").textContent = c ? "Account aanmaken" : "Inloggen";
  $("modeBtn").textContent = c ? "Ik heb al een wachtwoord" : "Eerste keer? Maak je wachtwoord aan";
  $("lPass").autocomplete = c ? "new-password" : "current-password";
  $("loginErr").hidden = true;
}
$("modeBtn").onclick = () => setLoginMode(!createMode);
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("lEmail").value.trim().toLowerCase();
  const password = $("lPass").value;
  const err = (m) => { $("loginErr").textContent = m; $("loginErr").hidden = false; };
  if (!email) return err("Vul je e-mailadres in.");
  if (password.length < 8) return err("Je wachtwoord moet minstens 8 tekens hebben.");
  $("loginBtn").disabled = true;
  try {
    if (createMode) {
      const r = await fetch(SUPABASE_URL + "/functions/v1/account", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return err(j.error || "Account aanmaken lukte niet.");
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return err(/invalid/i.test(error.message) ? "E-mailadres of wachtwoord klopt niet." : "Inloggen lukte niet. Controleer je internet.");
  } catch {
    err("Geen verbinding. Controleer je internet.");
  } finally {
    $("loginBtn").disabled = false;
  }
};

/* ---------- session ---------- */
async function startApp(session) {
  if (!session) {
    me = null; if (channel) { sb.removeChannel(channel); channel = null; }
    $("appView").hidden = true; $("fab").hidden = true; $("loginView").hidden = false;
    return;
  }
  const email = session.user.email.toLowerCase();
  const { data: m } = await sb.from("members").select("name").ilike("email", email).maybeSingle();
  if (!m) {
    await sb.auth.signOut();
    $("loginErr").textContent = "Dit e-mailadres hoort niet bij deze agenda."; $("loginErr").hidden = false;
    return;
  }
  me = m.name;
  $("loginView").hidden = true; $("appView").hidden = false; $("fab").hidden = false;
  renderMe(); render();
  await loadEvents();
  subscribe();
  refreshPushCard();
  await loadImport();
  syncImport(30 * 60 * 1000);
}
let started = false;
sb.auth.onAuthStateChange((evt, session) => {
  if (evt === "INITIAL_SESSION" || evt === "SIGNED_IN" || evt === "SIGNED_OUT") {
    if (evt === "SIGNED_IN" && started && me) return;
    started = true;
    startApp(session);
  }
});

async function loadEvents() {
  const slow = setTimeout(() => { if (!loaded) showNote("De agenda is nog niet bereikbaar. Even geduld, of check je internet."); }, 10000);
  const { data, error } = await sb.from("events").select("*").order("date");
  clearTimeout(slow);
  if (error) { showNote("De agenda kon niet geladen worden. Trek omlaag of open de app opnieuw."); return; }
  if ($("note").textContent.startsWith("De agenda")) showNote("");
  events = data || []; loaded = true;
  render(); processNotices();
}
let reloadTimer = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel("events-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
      clearTimeout(reloadTimer); reloadTimer = setTimeout(loadEvents, 250);
    })
    .subscribe();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && me) loadEvents(); });

/* ---------- menu ---------- */
function renderMe() {
  $("meName").textContent = "Ik ben " + me;
  $("meAv").textContent = me[0]; $("meAv").className = "avatar av-" + me;
  $("menuWho").textContent = "Ingelogd als " + me;
}
$("meBtn").onclick = (e) => { e.stopPropagation(); const open = $("menu").hidden; $("menu").hidden = !open; $("meBtn").setAttribute("aria-expanded", open); };
document.addEventListener("click", (e) => { if (!$("menu").hidden && !e.target.closest(".mewrap")) $("menu").hidden = true; });
$("mOut").onclick = async () => { $("menu").hidden = true; await unsubscribePush(); await sb.auth.signOut(); };
$("mPush").onclick = () => { $("menu").hidden = true; enablePush(); };
$("mTest").onclick = async () => {
  $("menu").hidden = true;
  const r = await sb.functions.invoke("notify", { body: { test: true } });
  if (r.error) toast("Testmelding lukte niet", "Probeer het later nog eens.");
  else if (!r.data?.sent) toast("Geen melding verstuurd", "Zet eerst meldingen aan op deze telefoon.");
};

/* ---------- tabs & nav ---------- */
let view = "cal";
function setView(v) {
  view = v;
  $("tabCal").setAttribute("aria-selected", v === "cal"); $("tabReq").setAttribute("aria-selected", v === "req"); $("tabImp").setAttribute("aria-selected", v === "imp");
  $("viewCal").hidden = v !== "cal"; $("viewReq").hidden = v !== "req"; $("viewImp").hidden = v !== "imp";
  render();
  if (v === "imp") syncImport(2 * 60 * 1000);
}
$("tabCal").onclick = () => setView("cal"); $("tabReq").onclick = () => setView("req"); $("tabImp").onclick = () => setView("imp");
$("todayBtn").onclick = () => { const t = new Date(); cur = new Date(t.getFullYear(), t.getMonth(), 1); sel = ymd(t); renderCal(); };
if (location.hash === "#verzoeken") setView("req");

/* ---------- swipe between months ---------- */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function shiftMonth(dir) {
  cur = new Date(cur.getFullYear(), cur.getMonth() + dir, 1);
  renderCal();
  if (reduceMotion) return;
  const g = $("grid");
  g.classList.remove("slide-l", "slide-r"); void g.offsetWidth;
  g.classList.add(dir > 0 ? "slide-l" : "slide-r");
}
$("prevBtn").onclick = () => shiftMonth(-1);
$("nextBtn").onclick = () => shiftMonth(1);
(() => {
  const area = document.querySelector(".cal");
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  area.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); tracking = true;
  }, { passive: true });
  area.addEventListener("touchend", (e) => {
    if (!tracking) return; tracking = false;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 800) shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* ---------- rendering ---------- */
const approved = () => events.filter((e) => e.status === "approved");
const changeForMe = () => events.filter((e) => e.change && e.change_by !== me);
function render() { if (!me) return; renderCal(); renderReq(); renderImp(); renderBadge(); }
function renderBadge() {
  const n = events.filter((e) => e.status === "pending" && e.created_by !== me).length + changeForMe().length;
  $("badge").hidden = !n; $("badge").textContent = n;
  const ni = impItems.length; $("impBadge").hidden = !ni; $("impBadge").textContent = ni > 99 ? "99+" : ni;
  document.title = (n ? "(" + n + ") " : "") + "Karel & Sofie";
  try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch {}
}
function renderCal() {
  $("monthTitle").textContent = fMonth.format(cur);
  const byDay = {}; approved().forEach((e) => daysOf(e).forEach((k) => { (byDay[k] = byDay[k] || []).push(e); }));
  const g = $("grid"); g.textContent = "";
  const off = (cur.getDay() + 6) % 7; const start = new Date(cur.getFullYear(), cur.getMonth(), 1 - off);
  const today = ymd(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); const k = ymd(d);
    const c = el("button", "cell"); c.type = "button";
    if (d.getMonth() !== cur.getMonth()) c.classList.add("out");
    if (k === today) c.classList.add("today"); if (k === sel) c.classList.add("sel");
    c.appendChild(el("span", "n", d.getDate()));
    const hol = holidays(d.getFullYear())[k];
    if (hol) { const hs = el("span", "hol", hol.short); hs.title = hol.full; c.appendChild(hs); }
    const list = (byDay[k] || []).slice().sort(sortEv);
    c.setAttribute("aria-label", fDay.format(d) + (hol ? ", " + hol.full : "") + (list.length ? ", " + list.length + " afspraken" : ""));
    if (list.length) { const dots = el("span", "dots"); list.slice(0, 4).forEach((e) => dots.appendChild(el("span", "dot d-" + (e.who || "samen")))); c.appendChild(dots); }
    c.onclick = () => { sel = k; if (d.getMonth() !== cur.getMonth()) cur = new Date(d.getFullYear(), d.getMonth(), 1); confirmDel = null; renderCal(); };
    g.appendChild(c);
  }
  renderDay(byDay[sel] || []);
}
function card(e) {
  const c = el("div", "ev w-" + (e.who || "samen"));
  c.appendChild(el("div", "emo", e.emoji || "💛"));
  const b = el("div", "body");
  b.appendChild(el("div", "t", e.title));
  const m = el("div", "meta", timeText(e)); m.appendChild(el("span", "chip c-" + (e.who || "samen"), WHO_LABEL[e.who] || "Samen")); b.appendChild(m);
  if (e.note) b.appendChild(el("div", "txt", e.note));
  c.appendChild(b); return c;
}
const canEdit = (e) => e.status !== "declined" && !e.change && (e.created_by === me || (e.who === "samen" && e.status === "approved"));
function renderDay(list) {
  const d = parse(sel); const t = ymd(new Date());
  $("dayTitle").textContent = sel === t ? "Vandaag, " + fDay.format(d).replace(/^\S+ /, "") : fDay.format(d);
  const hol = holidays(d.getFullYear())[sel]; $("dayHol").hidden = !hol; $("dayHol").textContent = hol ? hol.full : "";
  list = list.slice().sort((a, b) => (spans(b) - spans(a)) || sortEv(a, b));
  $("dayCount").textContent = list.length ? (list.length === 1 ? "1 afspraak" : list.length + " afspraken") : "";
  const L = $("dayList"); L.textContent = "";
  if (!loaded) { L.appendChild(el("div", "empty", "De agenda wordt geladen…")); return; }
  if (!list.length) { L.appendChild(el("div", "empty", "Nog niks gepland. Tik op + om iets toe te voegen.")); return; }
  list.forEach((e) => {
    const c = card(e); const body = c.querySelector(".body");
    if (spans(e)) {
      const all = daysOf(e); const idx = all.indexOf(sel) + 1;
      body.querySelector(".meta").insertBefore(document.createTextNode("Dag " + idx + " van " + all.length + " · "), body.querySelector(".meta").firstChild);
    }
    if (e.change) {
      const p = el("div", "pendingchg", e.change_by === me ? "✏️ Je wijziging wacht op " + OTHER[me] : "✏️ " + e.change_by + " wil dit aanpassen");
      if (e.change_by !== me) { p.classList.add("tap"); p.onclick = () => setView("req"); }
      body.appendChild(p);
    }
    const box = el("div", "evbtns");
    if (confirmDel === e.id) {
      const y = el("button", "mini danger", "Ja, weg"); y.type = "button"; y.onclick = () => remove(e.id);
      const n = el("button", "mini", "Nee"); n.type = "button"; n.onclick = () => { confirmDel = null; renderCal(); };
      box.append(y, n);
    } else {
      if (canEdit(e)) { const ed = el("button", "mini", "Aanpassen"); ed.type = "button"; ed.onclick = () => openEdit(e); box.appendChild(ed); }
      const x = el("button", "mini", "Verwijder"); x.type = "button"; x.onclick = () => { confirmDel = e.id; renderCal(); }; box.appendChild(x);
    }
    c.appendChild(box); L.appendChild(c);
  });
}
function renderReq() {
  const V = $("viewReq"); V.textContent = "";
  const other = OTHER[me];
  const forMe = events.filter((e) => e.status === "pending" && e.created_by !== me).sort(sortEv);
  const chgForMe = changeForMe().sort(sortEv);
  const mine = events.filter((e) => e.status === "pending" && e.created_by === me).sort(sortEv);
  const chgMine = events.filter((e) => e.change && e.change_by === me).sort(sortEv);
  const decl = events.filter((e) => e.status === "declined" && e.created_by === me).sort(sortEv);
  const btn = (cls, txt, fn) => { const b = el("button", "btn " + cls, txt); b.type = "button"; b.onclick = fn; return b; };
  const item = (L, e, actions, label) => {
    const shown = e.change ? { ...e, ...e.change } : e;
    const c = card(shown); const body = c.querySelector(".body");
    body.querySelector(".meta").firstChild.textContent = whenText(shown);
    if (label) body.insertBefore(el("div", "reqlabel", label), body.firstChild);
    if (e.change) body.appendChild(el("div", "was", "Was: " + e.title + " · " + whenText(e) + (e.who !== shown.who ? " · " + WHO_LABEL[e.who] : "")));
    const a = el("div", "actions"); actions(e).forEach((x) => a.appendChild(x)); body.appendChild(a);
    L.appendChild(c);
  };
  const section = (title, rows, emptyText) => {
    V.appendChild(el("h4", null, title));
    const L = el("div", "list");
    if (!rows.length && emptyText) L.appendChild(el("div", "empty", emptyText));
    rows.forEach(([e, actions, label]) => item(L, e, actions, label));
    V.appendChild(L);
  };
  section("Wacht op jou", [
    ...forMe.map((e) => [e, (x) => [btn("yes", "Goedkeuren", () => decide(x.id, "approved")), btn("nope", "Afwijzen", () => decide(x.id, "declined"))], "Nieuw voorstel"]),
    ...chgForMe.map((e) => [e, (x) => [btn("yes", "Goedkeuren", () => resolveChange(x.id, true)), btn("nope", "Afwijzen", () => resolveChange(x.id, false))], "Wijziging"]),
  ], "Niks te keuren. Lekker rustig.");
  section("Wacht op " + other, [
    ...mine.map((e) => [e, (x) => [btn("primary", "Aanpassen", () => openEdit(x)), btn("nope", "Intrekken", () => remove(x.id))], "Nieuw voorstel"]),
    ...chgMine.map((e) => [e, (x) => [btn("nope", "Wijziging intrekken", () => resolveChange(x.id, false))], "Wijziging"]),
  ], "Je hebt niks openstaan.");
  if (decl.length) section("Afgewezen door " + other, decl.map((e) => [e, (x) => [btn("primary", "Opnieuw voorstellen", () => openAdd(x)), btn("nope", "Weghalen", () => remove(x.id))]]), "");
}

/* ---------- in-app popups ---------- */
function toast(title, sub, actions, ms) {
  const t = el("div", "toast"); t.appendChild(el("div", "tt", title)); if (sub) t.appendChild(el("div", "ts", sub));
  if (actions && actions.length) { const a = el("div", "actions"); actions.forEach(([cls, txt, fn]) => { const b = el("button", "btn " + cls, txt); b.type = "button"; b.onclick = () => { fn(); t.remove(); }; a.appendChild(b); }); t.appendChild(a); }
  else t.onclick = () => t.remove();
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), ms || (actions ? 12000 : 4500));
}
function goTo(e) { sel = e.date; const d = parse(e.date); cur = new Date(d.getFullYear(), d.getMonth(), 1); setView("cal"); }
const seenVal = (e) => e.status + (e.change ? "|c:" + e.change_by : "");
function processNotices() {
  if (!me || !loaded) return;
  const key = "ks-seen-" + me; const raw = ls.get(key); let seen = {}; try { seen = JSON.parse(raw || "{}"); } catch {}
  const other = OTHER[me];
  const newReq = [], decided = [], added = [], chgReq = [], chgDone = [];
  events.forEach((e) => {
    const prev = seen[e.id]; const base = prev === undefined ? undefined : prev.split("|")[0];
    if (prev === undefined && e.status === "pending" && e.created_by !== me) newReq.push(e);
    if (prev === undefined && raw && e.status === "approved" && e.created_by !== me && !e.decided_by) added.push(e);
    if (base === "pending" && e.created_by === me && (e.status === "approved" || e.status === "declined")) decided.push(e);
    if (raw && e.change && e.change_by !== me && !(prev || "").includes("|c:")) chgReq.push(e);
    if (prev && prev.includes("|c:" + me) && !e.change) chgDone.push(e);
  });
  const next = {}; events.forEach((e) => (next[e.id] = seenVal(e))); ls.set(key, JSON.stringify(next));
  const line = (e) => (e.emoji || "") + " " + e.title + " · " + whenText(e);
  if (newReq.length > 2) toast(other + " heeft " + newReq.length + " nieuwe voorstellen", "Bekijk ze en keur goed of af.", [["primary", "Bekijken", () => setView("req")]]);
  else newReq.forEach((e) => toast(other + " wil iets in de agenda zetten", line(e), [["yes", "Goedkeuren", () => decide(e.id, "approved")], ["nope", "Afwijzen", () => decide(e.id, "declined")]]));
  if (added.length > 2) toast(other + " heeft " + added.length + " dingen toegevoegd", "Kijk in de agenda.");
  else added.forEach((e) => toast(other + " heeft iets toegevoegd", line(e) + " · voor " + WHO_LABEL[e.who], [["primary", "Bekijken", () => goTo(e)]]));
  decided.forEach((e) => toast(e.status === "approved" ? other + " zegt ja! 🎉" : other + " heeft afgewezen", e.title + " · " + whenText(e), null, 6000));
  chgReq.forEach((e) => toast(other + " wil iets aanpassen", line({ ...e, ...e.change }), [["yes", "Goedkeuren", () => resolveChange(e.id, true)], ["nope", "Bekijken", () => setView("req")]]));
  chgDone.forEach((e) => {
    const ok = e.decided_by === other && e.decided_at && Date.now() - Date.parse(e.decided_at) < 15 * 60 * 1000;
    toast(ok ? other + " is akkoord met je wijziging 🎉" : other + " heeft je wijziging niet overgenomen", e.title + " · " + whenText(e), null, 6000);
  });
}

/* ---------- writes ---------- */
function notify(event_id, kind, extra) { sb.functions.invoke("notify", { body: { event_id, kind, ...(extra || {}) } }).catch(() => {}); }
async function decide(id, status) {
  const { error } = await sb.from("events").update({ status }).eq("id", id);
  if (error) return toast("Dat lukte niet", /beslist/.test(error.message) ? "Dit verzoek is al beslist." : "Controleer je internet en probeer het opnieuw.");
  notify(id, "decided");
  toast(status === "approved" ? "Staat in de agenda" : "Afgewezen", OTHER[me] + " krijgt een seintje.");
  loadEvents();
}
async function resolveChange(id, accept) {
  const { data, error } = await sb.rpc("resolve_change", { p_id: id, p_accept: accept });
  if (error) return toast("Dat lukte niet", error.message || "Controleer je internet en probeer het opnieuw.");
  if (data === "accepted" || data === "declined") notify(id, "change_resolved", { result: data });
  toast(data === "accepted" ? "Wijziging staat erin" : data === "withdrawn" ? "Wijziging ingetrokken" : "Wijziging afgewezen", data === "withdrawn" ? "" : OTHER[me] + " krijgt een seintje.");
  loadEvents();
}
async function remove(id) {
  confirmDel = null;
  const { error } = await sb.from("events").delete().eq("id", id);
  if (error) return toast("Verwijderen lukte niet", "Controleer je internet en probeer het opnieuw.");
  loadEvents();
}

/* ---------- add / edit sheet ---------- */
const emoBox = $("fEmo");
EMOJI.forEach((x) => { const b = el("button", null, x); b.type = "button"; b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", "Plaatje " + x); b.onclick = () => { form.emoji = x; syncForm(); }; emoBox.appendChild(b); });
$("fWho").querySelectorAll("button").forEach((b) => (b.onclick = () => { form.who = b.dataset.v; syncForm(); }));
$("fAllDay").onchange = syncForm;
$("fDate").onchange = () => { if (!$("fEndDate").value || $("fEndDate").value < $("fDate").value) $("fEndDate").value = $("fDate").value; syncForm(); };
$("fEndDate").onchange = syncForm;
const editNeedsApproval = () => form.editEv && form.editEv.status === "approved" && (form.editEv.who === "samen" || form.who === "samen");
function syncForm() {
  $("fWho").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === form.who));
  emoBox.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.textContent === form.emoji));
  $("timeRow").hidden = $("fAllDay").checked;
  if ($("fAllDay").checked) closePicker();
  syncTimes();
  const multi = $("fEndDate").value && $("fEndDate").value > $("fDate").value;
  $("lStart").textContent = multi ? "Begint om (eerste dag)" : "Van";
  $("lEnd").textContent = multi ? "Eindigt om (laatste dag)" : "Tot";
  if (form.editEv) {
    $("addH").textContent = "Afspraak aanpassen";
    const needs = editNeedsApproval();
    $("addHint").textContent = needs ? "Dit is iets voor jullie samen. De wijziging gaat eerst naar " + OTHER[me] + ". Tot dan blijft het zoals het was." : "";
    $("addHint").hidden = !needs;
    $("sendBtn").textContent = needs ? "Wijziging voorstellen" : "Opslaan";
    return;
  }
  $("addH").textContent = "Nieuwe afspraak"; $("addHint").hidden = false;
  const needs = form.who === "samen";
  $("addHint").textContent = needs ? "Iets voor jullie samen: komt in de agenda zodra " + OTHER[me] + " hem goedkeurt." : "Alleen voor " + WHO_LABEL[form.who] + ": komt meteen in de agenda.";
  $("sendBtn").textContent = needs ? "Voorstellen" : "Toevoegen";
}
function fillForm(from) {
  $("addForm").reset(); $("formErr").hidden = true;
  $("fDate").value = from ? from.date : sel;
  $("fEndDate").value = from && from.end_date ? from.end_date : $("fDate").value;
  if (from) { $("fTitle").value = from.title; $("fNote").value = from.note || ""; $("fAllDay").checked = !!from.all_day; }
  $("fStart").value = from && from.start_time ? from.start_time : "19:00";
  $("fEnd").value = from ? from.end_time || "" : "21:00";
  closePicker();
}
function openAdd(from) {
  fillForm(from);
  form = { who: from ? from.who : "samen", emoji: from ? from.emoji : EMOJI[0], reofferId: from ? from.id : null, editEv: null };
  syncForm(); $("addScrim").hidden = false; setTimeout(() => { try { $("fTitle").focus(); } catch {} }, 60);
}
function openEdit(e) {
  confirmDel = null;
  fillForm(e);
  form = { who: e.who, emoji: e.emoji || EMOJI[0], reofferId: null, editEv: e };
  syncForm(); $("addScrim").hidden = false;
}
/* ---------- eigen tijdkiezer ---------- */
let tpField = null; // "fStart" | "fEnd"
const pad2 = (n) => String(n).padStart(2, "0");
function syncTimes() {
  $("bStart").textContent = $("fStart").value || "Kies";
  $("bEnd").textContent = $("fEnd").value || "Geen";
  $("bStart").setAttribute("aria-expanded", tpField === "fStart");
  $("bEnd").setAttribute("aria-expanded", tpField === "fEnd");
}
function closePicker() { tpField = null; $("tpick").hidden = true; syncTimes(); }
function setTime(field, v) {
  $(field).value = v;
  if (field === "fStart" && $("fEnd").value && $("fEnd").value <= v && !($("fEndDate").value > $("fDate").value)) {
    const h = Number(v.slice(0, 2)) + 1;
    $("fEnd").value = h <= 23 ? pad2(h) + v.slice(2) : "";
  }
  renderPicker(); syncTimes();
}
function renderPicker() {
  if (!tpField) return;
  const v = $(tpField).value || (tpField === "fEnd" ? $("fStart").value : "") || "19:00";
  const [hh, mm] = v.split(":");
  const H = $("tpHours"), M = $("tpMins"); H.textContent = ""; M.textContent = "";
  for (let h = 0; h < 24; h++) {
    const b = el("button", null, pad2(h)); b.type = "button";
    b.setAttribute("aria-pressed", !!$(tpField).value && pad2(h) === hh);
    b.setAttribute("aria-label", h + " uur");
    b.onclick = () => setTime(tpField, pad2(h) + ":" + (mm && Number(mm) % 5 === 0 ? mm : "00"));
    H.appendChild(b);
  }
  for (let m = 0; m < 60; m += 5) {
    const b = el("button", null, ":" + pad2(m)); b.type = "button";
    b.setAttribute("aria-pressed", !!$(tpField).value && pad2(m) === mm);
    b.setAttribute("aria-label", m + " minuten");
    b.onclick = () => setTime(tpField, hh + ":" + pad2(m));
    M.appendChild(b);
  }
  $("tpTitle").textContent = tpField === "fStart" ? "Begintijd" : "Eindtijd";
  $("tpNone").hidden = tpField !== "fEnd";
}
function openPicker(field) {
  if (tpField === field) return closePicker();
  tpField = field; $("tpick").hidden = false; renderPicker(); syncTimes();
  setTimeout(() => { try { $("tpick").scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch {} }, 30);
}
$("bStart").onclick = () => openPicker("fStart");
$("bEnd").onclick = () => openPicker("fEnd");
$("tpDone").onclick = closePicker;
$("tpNone").onclick = () => { $("fEnd").value = ""; closePicker(); };

const closeAdd = () => { $("addScrim").hidden = true; };
$("fab").onclick = () => openAdd();
$("cancelAdd").onclick = closeAdd;
$("addScrim").onclick = (e) => { if (e.target === $("addScrim")) closeAdd(); };
$("addForm").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("fTitle").value.trim(), date = $("fDate").value, allDay = $("fAllDay").checked, start = $("fStart").value, end = $("fEnd").value;
  const endDateRaw = $("fEndDate").value;
  const err = (m) => { $("formErr").textContent = m; $("formErr").hidden = false; };
  if (!title) return err("Geef de afspraak een naam.");
  if (!date) return err("Kies een datum.");
  if (endDateRaw && endDateRaw < date) return err("De einddatum ligt voor de begindatum.");
  const endDate = endDateRaw && endDateRaw > date ? endDateRaw : null;
  if (endDate && endDate > addDays(date, 62)) return err("Een afspraak mag hooguit 2 maanden duren.");
  if (!allDay && !start) return err("Vul een begintijd in, of kies Hele dag.");
  if (!allDay && !endDate && end && end < start) return err("De eindtijd ligt voor de begintijd.");
  const fields = { title, date, end_date: endDate, all_day: allDay, start_time: allDay ? "" : start, end_time: allDay ? "" : end || "", who: form.who, emoji: form.emoji, note: $("fNote").value.trim() };
  $("sendBtn").disabled = true;
  try {
    if (form.editEv) {
      const id = form.editEv.id;
      const { data, error } = await sb.rpc("edit_event", { p_id: id, p_fields: fields });
      if (error) return err(error.message || "Opslaan lukte niet. Controleer je internet.");
      notify(id, data === "requested" ? "change_request" : "changed");
      closeAdd();
      toast(data === "requested" ? "Wijziging verstuurd naar " + OTHER[me] : "Aangepast", data === "requested" ? "Tot " + OTHER[me] + " ja zegt, blijft het zoals het was." : OTHER[me] + " krijgt een seintje.");
    } else {
      const needs = form.who === "samen";
      const { data, error } = await sb.from("events").insert({ ...fields, created_by: me, status: needs ? "pending" : "approved" }).select("id").single();
      if (error) return err("Opslaan lukte niet. Controleer je internet en probeer het opnieuw.");
      if (form.reofferId) await sb.from("events").delete().eq("id", form.reofferId);
      notify(data.id, "new");
      closeAdd();
      if (needs) toast("Verstuurd naar " + OTHER[me], "Het staat in de agenda zodra " + OTHER[me] + " ja zegt.");
      else toast("Staat in de agenda", OTHER[me] + " krijgt een seintje.");
    }
    sel = date; const d = parse(date); cur = new Date(d.getFullYear(), d.getMonth(), 1);
    await loadEvents();
  } finally { $("sendBtn").disabled = false; }
};

/* ---------- overnemen uit een andere agenda ---------- */
const fTime = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
const fWhen = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function loadImport() {
  if (!me) return;
  const [s, i] = await Promise.all([
    sb.from("import_sources").select("last_synced,last_error").maybeSingle(),
    sb.from("import_items").select("*").eq("state", "new").order("date").order("start_time").limit(300),
  ]);
  if (!s.error) impSource = s.data || null;
  if (!i.error) impItems = i.data || [];
  impLoaded = true;
  renderImp(); renderBadge();
}
async function syncImport(maxAgeMs) {
  if (!me || impBusy) return;
  const last = Number(ls.get("ks-imp-sync-" + me) || 0);
  if (Date.now() - last < maxAgeMs) return;
  ls.set("ks-imp-sync-" + me, String(Date.now()));
  impBusy = true; renderImp();
  const { data } = await sb.functions.invoke("import", { body: { action: "sync" } });
  impBusy = false;
  await loadImport();
  if (data?.added && view !== "imp") toast(data.added === 1 ? "1 nieuwe afspraak om over te nemen" : data.added + " nieuwe afspraken om over te nemen", "Uit je andere agenda.", [["primary", "Bekijken", () => setView("imp")]]);
}
async function importCall(body, okText) {
  impBusy = true; renderImp();
  const { data, error } = await sb.functions.invoke("import", { body });
  impBusy = false;
  let msg = data?.error;
  if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = "Dat lukte niet. Controleer je internet."; } }
  await loadImport();
  if (msg) return { error: msg };
  if (okText) toast(okText(data), data.found ? "Kies per afspraak of hij erin moet." : "");
  ls.set("ks-imp-sync-" + me, String(Date.now()));
  return data;
}
$("impForm").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("impUrl").value.trim();
  $("impErr").hidden = true;
  if (!url) { $("impErr").textContent = "Plak eerst het agenda-adres."; $("impErr").hidden = false; return; }
  const r = await importCall({ action: "link", url }, (d) => "Gekoppeld! " + (d.found === 1 ? "1 afspraak" : d.found + " afspraken") + " gevonden");
  if (r?.error) { $("impErr").textContent = r.error; $("impErr").hidden = false; } else $("impUrl").value = "";
};
$("impFile").onchange = async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (f.size > 5_000_000) return toast("Dit bestand is te groot", "Kies een kleiner agenda-bestand.");
  const ics = await f.text();
  const r = await importCall({ action: "file", ics }, (d) => (d.added === 1 ? "1 afspraak" : d.added + " afspraken") + " ingelezen");
  if (r?.error) toast("Inlezen lukte niet", r.error);
};

function asEvent(it, who) {
  return { title: it.title, date: it.date, end_date: it.end_date || null, all_day: it.all_day, start_time: it.start_time, end_time: it.end_time, note: it.note, who, emoji: "📅" };
}
async function takeOver(it, who) {
  const needs = who === "samen";
  const { data, error } = await sb.from("events").insert({ ...asEvent(it, who), created_by: me, status: needs ? "pending" : "approved" }).select("id").single();
  if (error) return toast("Overnemen lukte niet", "Controleer je internet en probeer het opnieuw.");
  await sb.from("import_items").update({ state: "added" }).eq("id", it.id);
  notify(data.id, "new");
  impItems = impItems.filter((x) => x.id !== it.id);
  toast(needs ? "Verstuurd naar " + OTHER[me] : "Staat in de agenda", needs ? "Het staat erin zodra " + OTHER[me] + " ja zegt." : it.title);
  renderImp(); renderBadge(); loadEvents();
}
async function skipItem(it) {
  impItems = impItems.filter((x) => x.id !== it.id); renderImp(); renderBadge();
  await sb.from("import_items").update({ state: "skipped" }).eq("id", it.id);
}

function renderImp() {
  if (!me) return;
  const linked = !!impSource;
  $("impSetup").hidden = linked || !impLoaded;
  $("impStatus").hidden = !linked;
  $("impLinkBtn").disabled = impBusy; $("impLinkBtn").textContent = impBusy && !linked ? "Bezig met koppelen…" : "Koppelen";
  if (linked) {
    const T = $("impStatusTxt"); T.textContent = "Je andere agenda is gekoppeld";
    const sub = el("span");
    if (impBusy) sub.textContent = "Bezig met bijwerken…";
    else if (impSource.last_error) { sub.textContent = impSource.last_error; sub.className = "bad"; }
    else if (impSource.last_synced) { const d = new Date(impSource.last_synced); sub.textContent = "Bijgewerkt " + (ymd(d) === ymd(new Date()) ? "om " + fTime.format(d) : fWhen.format(d)); }
    T.appendChild(sub);
    const B = $("impStatusBtns"); B.textContent = "";
    const mk = (cls, txt, fn) => { const b = el("button", "btn " + cls, txt); b.type = "button"; b.disabled = impBusy; b.onclick = fn; return b; };
    if (confirmUnlink) {
      B.append(mk("nope", "Ja, ontkoppelen", async () => { confirmUnlink = false; await importCall({ action: "unlink" }, () => "Ontkoppeld"); }), mk("nope", "Nee", () => { confirmUnlink = false; renderImp(); }));
    } else {
      B.append(mk("primary", "Vernieuwen", () => importCall({ action: "sync" }, (d) => d.added ? (d.added === 1 ? "1 nieuwe afspraak" : d.added + " nieuwe afspraken") : "Alles is bijgewerkt")), mk("nope", "Ontkoppelen", () => { confirmUnlink = true; renderImp(); }));
    }
  }
  const L = $("impList"); L.textContent = "";
  $("impListH").hidden = !linked && !impItems.length;
  if (!impLoaded) { L.appendChild(el("div", "empty", "Laden…")); return; }
  if (!impItems.length) { if (linked) L.appendChild(el("div", "empty", "Niks nieuws. Nieuwe afspraken uit je andere agenda verschijnen hier vanzelf.")); return; }
  const mineCls = "as-" + me.toLowerCase();
  impItems.forEach((it) => {
    const c = card({ ...it, who: "samen", emoji: "📅" });
    c.className = "ev w-imp";
    const body = c.querySelector(".body"); const meta = body.querySelector(".meta");
    meta.textContent = whenText(it);
    const a = el("div", "actions");
    const b = (cls, txt, fn) => { const x = el("button", "btn " + cls, txt); x.type = "button"; x.onclick = fn; return x; };
    a.append(b(mineCls, "Alleen ik", () => takeOver(it, me.toLowerCase())), b("as-samen", "Samen", () => takeOver(it, "samen")), b("nope", "Niet", () => skipItem(it)));
    body.appendChild(a);
    L.appendChild(c);
  });
}

/* ---------- push notifications ---------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let swReg = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; refreshPushCard(); }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data === "open-requests") setView("req"); });
}
function b64ToUint8(b64) { const p = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
async function currentSub() { try { const r = swReg || (await navigator.serviceWorker.ready); return await r.pushManager.getSubscription(); } catch { return null; } }
async function refreshPushCard() {
  if (!me) return;
  const card = $("pushCard");
  if (isIOS && !standalone) {
    card.hidden = false; $("pushBtn").hidden = true;
    $("pushTxt").innerHTML = "Zet de app op je beginscherm<span>Tik in Safari op het deel-icoon en kies <b>Zet op beginscherm</b>. Open de app daarna vanaf het icoon, dan kun je meldingen aanzetten.</span>";
    return;
  }
  if (!pushSupported) { card.hidden = true; return; }
  $("pushBtn").hidden = false;
  if (Notification.permission === "denied") {
    card.hidden = false; $("pushBtn").hidden = true;
    $("pushTxt").innerHTML = "Meldingen zijn geblokkeerd<span>Zet ze aan in de instellingen van je telefoon, bij deze app of je browser.</span>";
    return;
  }
  const sub = Notification.permission === "granted" ? await currentSub() : null;
  if (sub) { card.hidden = true; saveSub(sub); return; }
  card.hidden = false;
  $("pushTxt").innerHTML = "Meldingen staan uit<span>Zet ze aan, dan hoor je het als er iets nieuws in de agenda komt.</span>";
}
async function saveSub(sub) {
  const j = sub.toJSON();
  await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, member: me, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
}
async function enablePush() {
  if (!pushSupported) return toast("Meldingen werken hier niet", isIOS ? "Open de app vanaf je beginscherm." : "Gebruik Chrome of Samsung Internet.");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { refreshPushCard(); return toast("Meldingen staan uit", "Je kunt ze later aanzetten via je naam rechtsboven."); }
    const r = swReg || (await navigator.serviceWorker.ready);
    const { data, error } = await sb.functions.invoke("notify", { method: "GET" });
    if (error || !data?.publicKey) throw new Error("no key");
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.publicKey) });
    await saveSub(sub);
    $("pushCard").hidden = true;
    await sb.functions.invoke("notify", { body: { test: true } });
    toast("Meldingen staan aan", "Je krijgt nu een testmelding.");
  } catch {
    toast("Meldingen aanzetten lukte niet", "Probeer het nog eens, of open de app opnieuw.");
  }
}
$("pushBtn").onclick = enablePush;
async function unsubscribePush() {
  const sub = await currentSub();
  if (sub) { try { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } catch {} }
}
