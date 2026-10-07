// Eén aanspreekpunt voor alle data: Supabase in productie, een lokale demo om te testen.
import { DEFAULTS } from "./defaults.js?v=202610071424";
import { clone, uid, inBrussels, todayISO, addDays, hoursFor, isFree } from "./core.js?v=202610071424";

const CFG = window.SITE_CONFIG || {};
const SITE = CFG.site || "site";
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.hostname.endsWith(".localhost");

export const MODE = CFG.supabaseUrl && CFG.supabaseKey ? "supabase" : isLocal ? "demo" : "off";
export const SITE_ID = SITE;

const toEmail = u => (u.includes("@") ? u : `${u.trim().toLowerCase()}@${CFG.loginDomain || "salon.local"}`);
const fail = code => { throw new Error(code); };

// =====================================================================
//  Supabase
// =====================================================================
let sbPromise = null;
function sb() {
  // vaste versie, in de site zelf (geen afhankelijkheid van een externe CDN)
  sbPromise ??= new Promise((ok, ko) => {
    if (window.supabase?.createClient) return ok(window.supabase);
    const s = document.createElement("script");
    s.src = new URL("./vendor/supabase-2.117.2.js", import.meta.url).href;
    s.onload = () => ok(window.supabase);
    s.onerror = () => ko(new Error("offline"));
    document.head.append(s);
  }).then(m => m.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: `salon-auth-${SITE}` },
      // nooit uit de browsercache: altijd verse gegevens en geen verwarring tussen domeinen
      global: { fetch: (url, opts = {}) => fetch(url, { ...opts, cache: "no-store" }) },
    }));
  return sbPromise;
}
const check = ({ data, error }) => { if (error) throw new Error(error.message || "fout"); return data; };

const supabaseApi = {
  async getContent() {
    const c = await sb();
    const rows = check(await c.from("site_content").select("key,value").eq("site", SITE));
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },
  async saveContent(key, value) {
    const c = await sb();
    check(await c.from("site_content").upsert({ site: SITE, key, value, updated_at: new Date().toISOString() }, { onConflict: "site,key" }));
  },
  async uploadImage(blob) {
    const c = await sb();
    const path = `${SITE}/${uid()}.jpg`;
    check(await c.storage.from("site").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false }));
    return c.storage.from("site").getPublicUrl(path).data.publicUrl;
  },
  async deleteImage(url) {
    const c = await sb();
    const marker = "/storage/v1/object/public/site/";
    const i = url.indexOf(marker);
    if (i < 0) return;
    const path = decodeURIComponent(url.slice(i + marker.length));
    if (!path.startsWith(`${SITE}/`)) return;
    await c.storage.from("site").remove([path]);
  },
  // logins van vestigingen (via de Edge Function "vestiging", alleen voor admin)
  async manageLocation(action, data = {}) {
    const c = await sb();
    const { data: res, error } = await c.functions.invoke("vestiging", {
      body: { action, domain: CFG.loginDomain, ...data },
    });
    if (error) {
      let body = {};
      try { body = await error.context.json(); } catch {}
      const e = new Error(body.error || "serverfout");
      e.count = body.count;
      throw e;
    }
    return res;
  },
  async getBusy(loc, from, to) {
    const c = await sb();
    return check(await c.rpc("get_busy", { p_site: SITE, p_loc: loc, p_from: from.toISOString(), p_to: to.toISOString() }));
  },
  async createBooking(b) {
    const c = await sb();
    return check(await c.rpc("create_booking", {
      p_site: SITE, p_loc: b.loc, p_service_id: b.serviceId, p_start: b.start.toISOString(),
      p_name: b.name, p_phone: b.phone, p_email: b.email, p_note: b.note || null,
    }));
  },
  async signIn(user, password) {
    const c = await sb();
    const { error } = await c.auth.signInWithPassword({ email: toEmail(user), password });
    if (error) fail("login");
    const me = await this.session();
    if (!me) { await c.auth.signOut(); fail("geen_toegang"); }
    return me;
  },
  async signOut() { const c = await sb(); await c.auth.signOut(); },
  async session() {
    const c = await sb();
    const { data } = await c.auth.getSession();
    if (!data.session) return null;
    const { data: row } = await c.from("staff").select("site,role").eq("user_id", data.session.user.id).maybeSingle();
    if (!row || row.site !== SITE) return null;
    return { role: row.role, site: row.site, email: data.session.user.email };
  },
  async listBookings(loc, from, to) {
    const c = await sb();
    return check(await c.from("bookings").select("*").eq("site", SITE).eq("loc", loc)
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at").limit(5000));
  },
  async saveBooking(b) {
    const c = await sb();
    return check(await c.rpc("staff_save_booking", {
      p_id: b.id || null, p_start: b.starts_at, p_end: b.ends_at, p_category: b.category || null,
      p_service: b.service, p_price: b.price ?? null, p_name: b.name, p_phone: b.phone || null,
      p_email: b.email || null, p_note: b.note || null, p_status: b.status || "bevestigd", p_force: !!b.force,
    }));
  },
  async setStatus(id, status) {
    const c = await sb();
    check(await c.from("bookings").update({ status }).eq("id", id));
  },
  subscribe(loc, cb) {
    let ch = null;
    sb().then(c => {
      ch = c.channel(`agenda-${SITE}-${loc}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `site=eq.${SITE}` }, p => {
          const row = p.new && Object.keys(p.new).length ? p.new : p.old;
          if (!row?.loc || row.loc === loc) cb(p.eventType, p.new);
        })
        .subscribe();
    });
    return () => ch && sb().then(c => c.removeChannel(ch));
  },
};

// =====================================================================
//  Demo (alleen op localhost): alles in localStorage, zelfde regels als de database
// =====================================================================
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(`demo:${SITE}:${k}`)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(`demo:${SITE}:${k}`, JSON.stringify(v)); window.dispatchEvent(new CustomEvent("demo-change", { detail: k })); },
};
const DEMO_USERS = { admin: "admin", haacht: "haacht", wilsele: "wilsele" }; // wachtwoord: demo
const delay = (ms = 250) => new Promise(r => setTimeout(r, ms));
const ACTIVE = ["bevestigd", "voltooid", "niet_gekomen"];

function demoContent() { return { ...clone(DEFAULTS), ...LS.get("content", {}) }; }
function demoBusy(loc, from, to, skip) {
  return LS.get("bookings", [])
    .filter(b => b.loc === loc && b.id !== skip && (ACTIVE.includes(b.status) || b.status === "geblokkeerd"))
    .filter(b => +new Date(b.starts_at) < +to && +new Date(b.ends_at) > +from)
    .map(b => ({ starts_at: b.starts_at, ends_at: b.ends_at, blocked: b.status === "geblokkeerd" }));
}
const chairsOf = (c, loc) => c.locations.find(l => l.id === loc)?.chairs || 1;

const demoApi = {
  async getContent() { await delay(120); return LS.get("content", {}); },
  async saveContent(key, value) {
    if ((await this.session())?.role !== "admin") fail("geen_toegang");
    await delay(); LS.set("content", { ...LS.get("content", {}), [key]: value });
  },
  async uploadImage(blob) {
    await delay();
    return await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  },
  async deleteImage() {},
  async manageLocation(action, data = {}) {
    if ((await this.session())?.role !== "admin") fail("geen_toegang");
    await delay(400);
    const users = LS.get("users", {}); // extra demo-logins: { gebruikersnaam: vestiging }
    const logins = [...Object.entries(DEMO_USERS).filter(([, r]) => r !== "admin").map(([u, r]) => ({ loc: r, username: u })),
      ...Object.entries(users).map(([u, r]) => ({ loc: r, username: u }))];
    if (action === "list") return { logins };
    const cur = logins.find(l => l.loc === data.loc);
    if (action === "create") {
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(data.username || "") || data.username === "admin") fail("ongeldige_gebruikersnaam");
      if ((data.password || "").length < 8) fail("wachtwoord_te_kort");
      if (cur) fail("login_bestaat");
      if (logins.some(l => l.username === data.username)) fail("gebruikersnaam_bezet");
      LS.set("users", { ...users, [data.username]: data.loc });
      LS.set("passwords", { ...LS.get("passwords", {}), [data.username]: data.password });
      return { ok: true, username: data.username };
    }
    if (action === "password") {
      if (!cur) fail("geen_login");
      if ((data.password || "").length < 8) fail("wachtwoord_te_kort");
      LS.set("passwords", { ...LS.get("passwords", {}), [cur.username]: data.password });
      return { ok: true };
    }
    if (action === "delete") {
      const n = LS.get("bookings", []).filter(b => b.loc === data.loc && b.status === "bevestigd" && +new Date(b.starts_at) > Date.now()).length;
      if (n && !data.force) { const e = new Error("heeft_afspraken"); e.count = n; throw e; }
      if (cur && users[cur.username]) { delete users[cur.username]; LS.set("users", users); }
      return { ok: true };
    }
    fail("onbekende_actie");
  },
  async getBusy(loc, from, to) { await delay(200); return demoBusy(loc, from, to); },
  async createBooking(b) {
    await delay(400);
    const c = demoContent();
    if (!c.locations.some(l => l.id === b.loc)) fail("ongeldige_vestiging");
    const name = (b.name || "").trim(), digits = (b.phone || "").replace(/\D/g, "");
    if (name.length < 2) fail("ongeldige_naam");
    if (digits.length < 9 || digits.length > 15) fail("ongeldig_telefoonnummer");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email || "")) fail("ongeldig_email");
    let cat, item;
    for (const ct of c.services) for (const it of ct.items) if (it.id === b.serviceId) { cat = ct; item = it; }
    if (!item) fail("onbekende_dienst");
    const start = new Date(b.start), end = new Date(+start + item.min * 60000);
    if (+start < Date.now() + (c.settings.min_notice ?? 30) * 60000) fail("tijd_voorbij");
    const local = inBrussels(start);
    if (local.iso > addDays(todayISO(), c.settings.max_days ?? 14)) fail("te_ver_vooruit");
    const h = hoursFor(c.hours, b.loc, local.dow);
    if (!h) fail("gesloten");
    const slot = c.settings.slot_min || 30;
    if (local.minutes < h[0] || local.minutes + item.min > h[1] || (local.minutes - h[0]) % slot) fail("ongeldig_tijdslot");
    if (!isFree(demoBusy(b.loc, start, end), +start, +end, chairsOf(c, b.loc))) fail("bezet");
    const all = LS.get("bookings", []);
    if (all.filter(x => x.status === "bevestigd" && +new Date(x.starts_at) > Date.now() && (x.phone || "").replace(/\D/g, "").slice(-9) === digits.slice(-9)).length >= 3) fail("te_veel_afspraken");
    const price = item.price + (c.settings.online_fee || 0);
    const row = {
      id: uid("b"), site: SITE, loc: b.loc, starts_at: start.toISOString(), ends_at: end.toISOString(),
      category: cat.label + (cat.sub ? ` ${cat.sub}` : ""), service: item.name, price, name, phone: b.phone.trim(),
      email: b.email.trim().toLowerCase(), note: b.note || null, status: "bevestigd", source: "website", created_at: new Date().toISOString(),
    };
    LS.set("bookings", [...all, row]);
    return { id: row.id, starts_at: row.starts_at, ends_at: row.ends_at, service: item.name, price };
  },
  async signIn(user, password) {
    await delay(400);
    const u = user.trim().toLowerCase();
    const extra = LS.get("users", {}), pws = LS.get("passwords", {});
    const role = DEMO_USERS[u] || extra[u];
    const okPw = pws[u] ? password === pws[u] : password === "demo";
    if (!role || !okPw) fail("login");
    LS.set("session", { role, site: SITE, email: toEmail(u) });
    return this.session();
  },
  async signOut() { localStorage.removeItem(`demo:${SITE}:session`); },
  async session() { return LS.get("session", null); },
  async listBookings(loc, from, to) {
    const me = await this.session();
    if (me?.role !== loc) fail("geen_toegang");
    await delay(150);
    return LS.get("bookings", []).filter(b => b.loc === loc && +new Date(b.starts_at) >= +from && +new Date(b.starts_at) < +to)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  },
  async saveBooking(b) {
    const me = await this.session();
    if (!me || me.role === "admin") fail("geen_toegang");
    await delay();
    const all = LS.get("bookings", []);
    const start = new Date(b.starts_at), end = new Date(b.ends_at);
    if (+end <= +start) fail("ongeldige_tijd");
    if (!b.force && b.status !== "geannuleerd") {
      const busy = demoBusy(me.role, start, end, b.id);
      const ok = b.status === "geblokkeerd" ? busy.length === 0 : isFree(busy, +start, +end, chairsOf(demoContent(), me.role));
      if (!ok) fail("overlap");
    }
    const row = {
      ...(all.find(x => x.id === b.id) || { id: uid("b"), site: SITE, loc: me.role, source: "zaak", created_at: new Date().toISOString() }),
      starts_at: start.toISOString(), ends_at: end.toISOString(), category: b.category || null, service: b.service || "Afspraak",
      price: b.price ?? null, name: b.name, phone: b.phone || null, email: b.email || null, note: b.note || null, status: b.status || "bevestigd",
    };
    LS.set("bookings", [...all.filter(x => x.id !== row.id), row]);
    return row.id;
  },
  async setStatus(id, status) {
    const me = await this.session();
    const all = LS.get("bookings", []);
    const row = all.find(x => x.id === id);
    if (!row || row.loc !== me?.role) fail("geen_toegang");
    row.status = status;
    LS.set("bookings", all);
  },
  subscribe(loc, cb) {
    const before = () => new Set(LS.get("bookings", []).map(b => b.id));
    let known = before();
    const handler = e => {
      const key = e.type === "storage" ? e.key : `demo:${SITE}:${e.detail}`;
      if (key !== `demo:${SITE}:bookings`) return;
      const now = LS.get("bookings", []);
      const added = now.find(b => !known.has(b.id) && b.loc === loc);
      known = new Set(now.map(b => b.id));
      cb(added ? "INSERT" : "UPDATE", added || null);
    };
    addEventListener("storage", handler);
    addEventListener("demo-change", handler);
    return () => { removeEventListener("storage", handler); removeEventListener("demo-change", handler); };
  },
};

// Zonder koppeling online: niets opslaan, boeken valt terug op WhatsApp
const offApi = {
  async getContent() { return {}; },
  async session() { return null; },
  async signIn() { fail("niet_gekoppeld"); },
  async signOut() {},
};

export const api = MODE === "supabase" ? supabaseApi : MODE === "demo" ? demoApi : offApi;

/** Inhoud ophalen en combineren met de standaardwaarden; valt terug op standaard bij een fout/time-out */
export async function loadContent(timeout = 5000) {
  let stored = {};
  try {
    stored = await Promise.race([api.getContent(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), timeout))]);
  } catch (e) { console.warn("Inhoud niet geladen, standaard gebruikt:", e.message); }
  const c = clone(DEFAULTS);
  for (const [k, v] of Object.entries(stored || {})) {
    if (v == null) continue;
    c[k] = (k === "texts" || k === "images" || k === "settings") ? { ...c[k], ...v } : v;
  }
  return c;
}
