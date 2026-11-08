// Runs every 5 minutes (pg_cron). Sends:
//  - "Over een uur" for timed events (samen → both, personal → owner)
//  - "Vandaag" at 08:00 for all-day events
//  - Onze dagen: a week before and on the day, at 09:00
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TZ = "Europe/Amsterdam";
const pad = (n: number) => String(n).padStart(2, "0");

function localNow() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, y: +p.year, m: +p.month, d: +p.day, H: +p.hour, M: +p.minute };
}
const naive = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number); const [H, M] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, H, M) / 60000;
};
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function occurrence(orig: string, year: number) {
  let [, m, d] = orig.split("-").map(Number);
  if (m === 2 && d === 29 && !isLeap(year)) d = 28;
  return `${year}-${pad(m)}-${pad(d)}`;
}
const fmtDate = (d: string) => new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));

type Msg = { key: string; to: string[]; title: string; body: string; url?: string };

Deno.serve(async (req) => {
  const { data: sec } = await admin.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
  if (!sec || req.headers.get("x-cron-secret") !== sec.value) return new Response("forbidden", { status: 403 });

  const now = localNow();
  const nowMin = naive(now.date, `${pad(now.H)}:${pad(now.M)}`);
  const today = now.date, tomorrow = addDays(today, 1);
  const msgs: Msg[] = [];
  const BOTH = ["Karel", "Sofie"];
  const targets = (who: string) => (who === "karel" ? ["Karel"] : who === "sofie" ? ["Sofie"] : BOTH);

  const { data: evs } = await admin.from("events").select("id,title,date,all_day,start_time,who,emoji").eq("status", "approved").in("date", [today, tomorrow]);
  for (const ev of evs || []) {
    if (!ev.all_day && /^\d{2}:\d{2}$/.test(ev.start_time)) {
      const diff = naive(ev.date, ev.start_time) - nowMin;
      if (diff > 0 && diff <= 60) {
        msgs.push({
          key: `ev1h|${ev.id}|${ev.date}|${ev.start_time}`, to: targets(ev.who),
          title: diff >= 55 ? "Over een uur" : `Over ${diff} minuten`,
          body: `${ev.emoji} ${ev.title} om ${ev.start_time}${ev.who === "samen" ? " · samen" : ""}`,
        });
      }
    }
    if (ev.all_day && ev.date === today && now.H >= 8) {
      msgs.push({ key: `evday|${ev.id}|${today}`, to: targets(ev.who), title: "Vandaag", body: `${ev.emoji} ${ev.title}` });
    }
  }

  if (now.H >= 9) {
    const { data: days } = await admin.from("special_days").select("*");
    const inWeek = addDays(today, 7);
    for (const sd of days || []) {
      for (const [when, target] of [["0", today], ["7", inWeek]] as const) {
        const year = Number(target.slice(0, 4));
        if (occurrence(sd.date, year) !== target) continue;
        const years = year - Number(sd.date.slice(0, 4));
        const label = sd.show_years && years > 0 ? `${sd.title} · ${years} jaar` : sd.title;
        msgs.push(when === "0"
          ? { key: `sd0|${sd.id}|${year}`, to: BOTH, title: `Vandaag: ${label} ${sd.emoji}`, body: "Maak er een mooie dag van 💛" }
          : { key: `sd7|${sd.id}|${year}`, to: BOTH, title: `Over een week: ${label} ${sd.emoji}`, body: `Op ${fmtDate(target)}. Tijd om iets leuks te bedenken?` });
      }
    }
  }

  let sent = 0;
  if (msgs.length) {
    const { data: keys } = await admin.from("app_secrets").select("key,value").in("key", ["vapid_public", "vapid_private"]);
    const k = Object.fromEntries((keys || []).map((r) => [r.key, r.value]));
    if (k.vapid_public && k.vapid_private) {
      webpush.setVapidDetails("mailto:agenda@example.com", k.vapid_public, k.vapid_private);
      for (const m of msgs) {
        // claim the key first so a message goes out at most once
        const { data: claimed } = await admin.from("reminders_sent").upsert({ key: m.key }, { onConflict: "key", ignoreDuplicates: true }).select("key");
        if (!claimed?.length) continue;
        const { data: subs } = await admin.from("push_subscriptions").select("*").in("member", m.to);
        const payload = JSON.stringify({ title: m.title, body: m.body, tag: m.key.split("|").slice(0, 2).join("-"), url: "./" });
        for (const s of subs || []) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
            sent++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
    }
  }
  if (now.H === 3 && now.M < 5) {
    await admin.from("reminders_sent").delete().lt("sent_at", new Date(Date.now() - 30 * 86400000).toISOString());
  }
  return new Response(JSON.stringify({ ok: true, due: msgs.length, sent, at: `${today} ${pad(now.H)}:${pad(now.M)}` }), { headers: { "Content-Type": "application/json" } });
});
