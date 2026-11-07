// Turns an iCalendar (.ics) text into simple agenda items in Dutch local time.
// Shared by the `import` edge function; ICAL (ical.js) is passed in so this file has no imports.

export type Item = {
  key: string; title: string; date: string; all_day: boolean;
  start_time: string; end_time: string; note: string;
};

const TZ = "Europe/Amsterdam";
const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function localParts(js: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(js).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// deno-lint-ignore no-explicit-any
function toLocal(t: any) {
  if (t.isDate) return { date: ymdOf(t.year, t.month, t.day), time: "", allDay: true };
  const floating = !t.zone || t.zone.tzid === "floating";
  if (floating) return { date: ymdOf(t.year, t.month, t.day), time: `${pad(t.hour)}:${pad(t.minute)}`, allDay: false };
  const p = localParts(t.toJSDate());
  return { date: p.date, time: p.time, allDay: false };
}

const clean = (s: unknown, max: number) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// deno-lint-ignore no-explicit-any
export function parseIcs(ICAL: any, text: string, from: Date, to: Date, limit = 500): Item[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch { /* ignore broken zones */ }
  }
  const out: Item[] = [];
  const seen = new Set<string>();
  const vevents = comp.getAllSubcomponents("vevent");

  const overrides = new Map<string, Set<string>>();
  for (const v of vevents) {
    const rid = v.getFirstPropertyValue("recurrence-id");
    const uid = v.getFirstPropertyValue("uid") || "";
    if (rid) { if (!overrides.has(uid)) overrides.set(uid, new Set()); overrides.get(uid)!.add(rid.toString()); }
  }
  const fromT = from.getTime(), toT = to.getTime();

  // deno-lint-ignore no-explicit-any
  const push = (uid: string, title: string, note: string, start: any, end: any) => {
    const s = toLocal(start);
    const e = end ? toLocal(end) : null;
    const dayStart = new Date(s.date + "T12:00:00Z").getTime();
    if (dayStart < fromT - 86400000 || dayStart > toT) return;
    const key = (uid + "|" + s.date + (s.allDay ? "" : "|" + s.time)).slice(0, 400);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      key, title: title || "Afspraak", date: s.date, all_day: s.allDay,
      start_time: s.allDay ? "" : s.time,
      end_time: s.allDay || !e || e.date !== s.date ? "" : e.time,
      note,
    });
  };

  for (const v of vevents) {
    if (out.length >= limit) break;
    const ev = new ICAL.Event(v);
    const status = String(v.getFirstPropertyValue("status") || "").toUpperCase();
    if (status === "CANCELLED") continue;
    const uid = ev.uid || "";
    const title = clean(ev.summary, 80);
    const note = clean(ev.location, 300);
    if (!ev.startDate) continue;

    if (ev.isRecurring() && !ev.isRecurrenceException()) {
      const skip = overrides.get(uid) || new Set<string>();
      const it = ev.iterator();
      let next, guard = 0;
      while ((next = it.next()) && guard++ < 2000 && out.length < limit) {
        const js = next.toJSDate().getTime();
        if (js > toT + 86400000) break;
        if (skip.has(next.toString())) continue;
        const det = ev.getOccurrenceDetails(next);
        push(uid, title, note, det.startDate, det.endDate);
      }
    } else {
      push(uid, title, note, ev.startDate, ev.endDate);
    }
  }
  out.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  return out;
}
