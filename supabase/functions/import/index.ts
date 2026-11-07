import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import ICAL from "npm:ical.js@2.2.1";
import { parseIcs } from "./parse.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MAX_BYTES = 5_000_000;

function range() {
  const from = new Date(); from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 6);
  return { from, to };
}

function normalizeUrl(raw: string) {
  let u = String(raw || "").trim();
  if (/^webcals?:\/\//i.test(u)) u = u.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) || url.hostname.endsWith(".internal")) return null;
  return url.toString();
}

async function fetchIcs(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "KarelSofieAgenda/1.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(r.status === 404 ? "Dit agenda-adres bestaat niet (meer)." : "Je andere agenda gaf geen antwoord (" + r.status + ").");
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error("Je andere agenda is te groot om in te lezen.");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("Dit adres is geen agenda. Kopieer het adres in iCal-indeling.");
  return text;
}

async function store(member: string, source: "link" | "file", text: string) {
  const { from, to } = range();
  let items;
  try { items = parseIcs(ICAL, text, from, to); }
  catch { throw new Error("Dit agenda-bestand kon niet gelezen worden."); }
  const rows = items.map((i) => ({ ...i, member, source }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin.from("import_items")
      .upsert(rows.slice(i, i + 200), { onConflict: "member,key", ignoreDuplicates: true }).select("id");
    if (error) throw new Error("Opslaan lukte niet.");
    added += data?.length || 0;
  }
  if (source === "link") {
    // remove untouched items that disappeared or moved in the other agenda
    const keep = new Set(items.map((i) => i.key));
    const { data: open } = await admin.from("import_items").select("id,key").eq("member", member).eq("source", "link").eq("state", "new");
    const gone = (open || []).filter((r) => !keep.has(r.key)).map((r) => r.id);
    if (gone.length) await admin.from("import_items").delete().in("id", gone);
  }
  // past items that were never handled are no longer useful
  await admin.from("import_items").delete().eq("member", member).eq("state", "new").lt("date", from.toISOString().slice(0, 10));
  return { added, found: items.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Niet ingelogd" }, 401);
    const { data: m } = await admin.from("members").select("name").ilike("email", email).maybeSingle();
    if (!m) return json({ error: "Geen toegang" }, 403);
    const member = m.name as string;

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "link") {
      const url = normalizeUrl(body.url);
      if (!url) return json({ error: "Plak een geldig agenda-adres dat begint met https:// of webcal://." }, 400);
      const text = await fetchIcs(url);
      await admin.from("import_sources").upsert({ member, url, last_synced: new Date().toISOString(), last_error: null }, { onConflict: "member" });
      return json({ ok: true, ...(await store(member, "link", text)) });
    }

    if (action === "sync") {
      const { data: src } = await admin.from("import_sources").select("url").eq("member", member).maybeSingle();
      if (!src) return json({ ok: true, linked: false, added: 0 });
      try {
        const text = await fetchIcs(src.url);
        const res = await store(member, "link", text);
        await admin.from("import_sources").update({ last_synced: new Date().toISOString(), last_error: null }).eq("member", member);
        return json({ ok: true, linked: true, ...res });
      } catch (e) {
        const msg = (e as Error).message || "Bijwerken lukte niet.";
        await admin.from("import_sources").update({ last_error: msg }).eq("member", member);
        return json({ ok: false, linked: true, error: msg });
      }
    }

    if (action === "file") {
      const text = String(body.ics || "");
      if (!text || text.length > MAX_BYTES) return json({ error: "Dit bestand is leeg of te groot." }, 400);
      if (!/BEGIN:VCALENDAR/i.test(text)) return json({ error: "Dit is geen agenda-bestand (.ics)." }, 400);
      return json({ ok: true, ...(await store(member, "file", text)) });
    }

    if (action === "unlink") {
      await admin.from("import_sources").delete().eq("member", member);
      await admin.from("import_items").delete().eq("member", member).eq("source", "link").eq("state", "new");
      return json({ ok: true });
    }

    return json({ error: "Onbekende actie" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Er ging iets mis." }, 500);
  }
});
