// Edge Function "vestiging": logins van vestigingen beheren.
// Alleen een ingelogde admin mag dit, en alleen voor de eigen zaak (site).
// Acties: list · create · password · delete
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const LOC_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const pwOk = (p: string) => typeof p === "string" && p.length >= 8 && p.length <= 72;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "methode" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    const sb = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // wie vraagt dit?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await sb.auth.getUser(token);
    if (whoErr || !who?.user) return json(401, { error: "niet_ingelogd" });
    const { data: me } = await sb.from("staff").select("site, role").eq("user_id", who.user.id).maybeSingle();
    if (!me || me.role !== "admin") return json(403, { error: "geen_toegang" });
    const site = me.site as string;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // alle vestigingslogins van deze zaak
    if (action === "list") {
      const { data: rows } = await sb.from("staff").select("user_id, role").eq("site", site).neq("role", "admin");
      const out = [];
      for (const r of rows ?? []) {
        const { data } = await sb.auth.admin.getUserById(r.user_id);
        out.push({ loc: r.role, username: (data?.user?.email ?? "").split("@")[0] });
      }
      return json(200, { logins: out });
    }

    const loc = String(body.loc ?? "").toLowerCase();
    if (!LOC_RE.test(loc) || loc === "admin") return json(400, { error: "ongeldige_vestiging" });
    const { data: cur } = await sb.from("staff").select("user_id").eq("site", site).eq("role", loc).maybeSingle();

    if (action === "create") {
      const username = String(body.username ?? "").trim().toLowerCase();
      const domain = String(body.domain ?? "").trim().toLowerCase();
      if (!USER_RE.test(username) || username === "admin") return json(400, { error: "ongeldige_gebruikersnaam" });
      if (!DOMAIN_RE.test(domain)) return json(400, { error: "ongeldig_domein" });
      if (!pwOk(body.password)) return json(400, { error: "wachtwoord_te_kort" });
      if (cur) return json(409, { error: "login_bestaat" });

      const { data: made, error: makeErr } = await sb.auth.admin.createUser({
        email: username + "@" + domain, password: body.password, email_confirm: true,
        user_metadata: { site, loc },
      });
      if (makeErr || !made?.user) {
        const taken = /already|registered|exists/i.test(makeErr?.message ?? "");
        return json(taken ? 409 : 400, { error: taken ? "gebruikersnaam_bezet" : "aanmaken_mislukt" });
      }
      const { error: linkErr } = await sb.from("staff").insert({ user_id: made.user.id, site, role: loc });
      if (linkErr) {
        await sb.auth.admin.deleteUser(made.user.id);
        return json(500, { error: "aanmaken_mislukt" });
      }
      return json(200, { ok: true, username });
    }

    if (action === "password") {
      if (!cur) return json(404, { error: "geen_login" });
      if (!pwOk(body.password)) return json(400, { error: "wachtwoord_te_kort" });
      const { error } = await sb.auth.admin.updateUserById(cur.user_id, { password: body.password });
      if (error) return json(400, { error: "wijzigen_mislukt" });
      return json(200, { ok: true });
    }

    if (action === "delete") {
      const { count } = await sb.from("bookings").select("id", { count: "exact", head: true })
        .eq("site", site).eq("loc", loc).eq("status", "bevestigd").gt("starts_at", new Date().toISOString());
      if ((count ?? 0) > 0 && !body.force) return json(409, { error: "heeft_afspraken", count });
      if (cur) await sb.auth.admin.deleteUser(cur.user_id); // staff-rij verdwijnt mee (cascade)
      return json(200, { ok: true });
    }

    return json(400, { error: "onbekende_actie" });
  } catch (e) {
    return json(500, { error: "serverfout", detail: String((e as Error)?.message ?? e) });
  }
});
