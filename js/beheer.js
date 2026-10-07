// Agenda en afsprakenbeheer per vestiging (rol = vestiging-id, bv. "haacht")
import {
  $, $$, esc, fmt, euro, pad, toast, errText, DAY_SHORT, MONTHS, brusselsNow, brusselsToDate, inBrussels,
  addDays, dowOf, dayLabel, hoursFor,
} from "./core.js?v=202610071416";
import { api, loadContent } from "./api.js?v=202610071416";

const STATUS = {
  bevestigd: { label: "Bevestigd", cls: "s-ok" },
  voltooid: { label: "Voltooid", cls: "s-done" },
  niet_gekomen: { label: "Niet gekomen", cls: "s-no" },
  geannuleerd: { label: "Geannuleerd", cls: "s-x" },
  geblokkeerd: { label: "Geblokkeerd", cls: "s-block" },
};
const ACTIVE = ["bevestigd", "voltooid", "niet_gekomen"];

let me, C, loc, LOC;
const S = { day: brusselsNow().iso, tab: "agenda", week: [], weekKey: "", upcoming: [], clients: [], showCancelled: false };

// ---------- helpers ----------
const startOf = b => inBrussels(new Date(b.starts_at));
const timeRange = b => `${fmt(startOf(b).minutes)}–${fmt(inBrussels(new Date(b.ends_at)).minutes)}`;
const durMin = b => Math.round((+new Date(b.ends_at) - +new Date(b.starts_at)) / 60000);
const mondayOf = iso => addDays(iso, -((dowOf(iso) + 6) % 7));
const prettyPhone = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("32") && d.length === 11) return `0${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  if (d.startsWith("0") && d.length === 10) return `${d.slice(0, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  return p || "";
};
const waNumber = p => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "32" + d.slice(1);
  return d;
};
const clientKey = b => {
  const d = String(b.phone || "").replace(/\D/g, "");
  if (d.length >= 9) return "t" + d.slice(-9);
  if (b.email) return "e" + b.email.toLowerCase();
  return "n" + (b.name || "").trim().toLowerCase();
};
const statusChip = s => `<span class="chip ${STATUS[s]?.cls || ""}">${STATUS[s]?.label || esc(s)}</span>`;

// =====================================================================
//  Opstarten
// =====================================================================
(async function init() {
  me = await api.session().catch(() => null);
  if (!me) return location.replace("login.html");
  if (me.role === "admin") return location.replace("index.html");
  C = await loadContent();
  loc = me.role;
  LOC = C.locations.find(l => l.id === loc) || { id: loc, name: loc, chairs: 1 };
  $("#locName").textContent = LOC.name;
  document.title = `Agenda ${LOC.name} — Classic Barbershop`;

  wireUi();
  await refresh();

  // live-updates + elke minuut een controle als vangnet
  api.subscribe(loc, (type, row) => {
    if (type === "INSERT" && row && row.source === "website" && row.status === "bevestigd") announce(row);
    refresh();
  });
  setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { document.title = `Agenda ${LOC.name} — Classic Barbershop`; refresh(); } });
  setInterval(() => { if (S.tab === "agenda") renderAgenda(); }, 60_000); // nu-lijn verschuiven
})();

// =====================================================================
//  Data
// =====================================================================
async function refresh() {
  try {
    const mon = mondayOf(S.day);
    const [week, upcoming] = await Promise.all([
      api.listBookings(loc, brusselsToDate(mon, 0), brusselsToDate(addDays(mon, 7), 0)),
      api.listBookings(loc, new Date(Date.now() - 30 * 60000), brusselsToDate(addDays(brusselsNow().iso, 90), 0)),
    ]);
    S.week = week; S.weekKey = mon; S.upcoming = upcoming;
    $("#live").classList.remove("is-off");
    renderAll();
    if (S.tab === "clients") loadClients();
  } catch (e) {
    $("#live").classList.add("is-off");
    if (/geen_toegang|JWT|session/i.test(e.message)) return location.replace("login.html");
    toast(`Kon de agenda niet laden: ${errText(e)}`, "bad");
  }
}

async function loadClients() {
  if (!S.clients.length) $("#clList").innerHTML = `<div class="bload"><span class="spinner"></span>Klanten laden…</div>`;
  try {
    const rows = await api.listBookings(loc, brusselsToDate(addDays(brusselsNow().iso, -730), 0), brusselsToDate(addDays(brusselsNow().iso, 180), 0));
    const map = new Map();
    const now = Date.now();
    for (const b of rows) {
      if (b.status === "geblokkeerd") continue;
      const k = clientKey(b);
      const c = map.get(k) || { key: k, name: b.name, phone: b.phone, email: b.email, visits: 0, noShow: 0, cancelled: 0, spent: 0, last: null, next: null, rows: [] };
      c.rows.push(b);
      c.name = b.name || c.name; c.phone = b.phone || c.phone; c.email = b.email || c.email;
      const t = +new Date(b.starts_at);
      if (b.status === "voltooid" || (b.status === "bevestigd" && t < now)) { c.visits++; c.spent += Number(b.price) || 0; if (!c.last || t > +new Date(c.last.starts_at)) c.last = b; }
      if (b.status === "niet_gekomen") c.noShow++;
      if (b.status === "geannuleerd") c.cancelled++;
      if (b.status === "bevestigd" && t >= now && (!c.next || t < +new Date(c.next.starts_at))) c.next = b;
      map.set(k, c);
    }
    S.clients = [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "nl"));
    renderClients();
  } catch (e) { toast(`Klanten laden mislukt: ${errText(e)}`, "bad"); }
}

// =====================================================================
//  Weergave
// =====================================================================
function renderAll() { renderAgenda(); renderUpcoming(); }

function renderAgenda() {
  const day = S.day, today = brusselsNow().iso;
  const [y, m, d] = day.split("-").map(Number);
  $("#dayTitle").innerHTML = `<b>${day === today ? "Vandaag" : day === addDays(today, 1) ? "Morgen" : day === addDays(today, -1) ? "Gisteren" : dayLabel(day).split(" ")[0].replace(/^./, c => c.toUpperCase())}</b> ${d} ${MONTHS[m - 1]} ${y !== +today.slice(0, 4) ? y : ""}`;
  $("#dayPick").value = day;

  // weekstrip
  const mon = mondayOf(day);
  $("#week").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i);
    const n = S.week.filter(b => startOf(b).iso === iso && ACTIVE.includes(b.status)).length;
    const closed = !hoursFor(C.hours, loc, dowOf(iso));
    return `<button type="button" class="bh-wd${iso === day ? " is-on" : ""}${iso === today ? " is-today" : ""}${closed ? " is-closed" : ""}" data-day="${iso}">
      <small>${DAY_SHORT[dowOf(iso)]}</small><b>${+iso.slice(8)}</b><em>${n ? `${n}` : "·"}</em></button>`;
  }).join("");

  const rows = S.week.filter(b => startOf(b).iso === day);
  const active = rows.filter(b => ACTIVE.includes(b.status));
  const revenue = active.filter(b => b.status !== "niet_gekomen").reduce((s, b) => s + (Number(b.price) || 0), 0);
  const next = active.filter(b => b.status === "bevestigd" && +new Date(b.ends_at) > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  $("#stats").innerHTML = `
    <div><small>Afspraken</small><b>${active.length}</b></div>
    <div><small>Omzet</small><b>${euro(revenue)}</b></div>
    <div class="bh-stats__next"><small>Volgende</small><b>${next ? `${fmt(startOf(next).minutes)} · ${esc(next.name.split(" ")[0])}` : "—"}</b></div>`;

  // tijdlijn
  const h = hoursFor(C.hours, loc, dowOf(day));
  const slot = Number(C.settings.slot_min) || 30;
  const visible = rows.filter(b => S.showCancelled || b.status !== "geannuleerd");
  let from = h ? h[0] : 9 * 60, to = h ? h[1] : 18 * 60;
  for (const b of visible) {
    const s = startOf(b).minutes, e = s + durMin(b);
    from = Math.min(from, Math.floor(s / slot) * slot);
    to = Math.max(to, Math.min(24 * 60, Math.ceil(e / slot) * slot));
  }
  const nowB = brusselsNow();
  const nowMin = nowB.iso === day ? nowB.minutes : day < nowB.iso ? 24 * 60 : -1;
  let html = h ? "" : `<p class="bh-closed">Volgens de openingsuren gesloten op deze dag.</p>`;
  for (let t = from; t < to; t += slot) {
    const starting = visible.filter(b => { const s = startOf(b).minutes; return s >= t && s < t + slot; });
    const covering = visible.filter(b => ACTIVE.concat("geblokkeerd").includes(b.status) && startOf(b).minutes < t && startOf(b).minutes + durMin(b) > t);
    const isNow = nowMin >= t && nowMin < t + slot;
    const past = t + slot <= nowMin;
    const open = h && t >= h[0] && t < h[1];
    html += `<div class="bh-row${past ? " is-past" : ""}${isNow ? " is-now" : ""}${open ? "" : " is-outside"}">
      <span class="bh-row__time">${fmt(t)}</span>
      <div class="bh-row__body">
        ${starting.map(cardHtml).join("")}
        ${!starting.length && covering.length ? `<div class="bh-cont">${covering.map(b => b.status === "geblokkeerd" ? "geblokkeerd" : esc(b.name.split(" ")[0])).join(" · ")}</div>` : ""}
        ${!starting.length && !covering.length && !past ? `<button type="button" class="bh-free" data-new="${t}">+ vrij</button>` : ""}
      </div>
    </div>`;
  }
  $("#timeline").innerHTML = html || `<p class="bh-empty">Geen afspraken.</p>`;
}

function cardHtml(b) {
  if (b.status === "geblokkeerd") {
    return `<button type="button" class="bk bk--block" data-id="${b.id}">
      <span class="bk__time">${timeRange(b)}</span><span class="bk__name">${esc(b.name || "Geblokkeerd")}</span>${statusChip(b.status)}</button>`;
  }
  return `<button type="button" class="bk ${STATUS[b.status]?.cls || ""}" data-id="${b.id}">
    <span class="bk__time">${timeRange(b)}</span>
    <span class="bk__name">${esc(b.name)}${b.note ? ' <i class="bk__note" title="Heeft een opmerking">✎</i>' : ""}</span>
    <span class="bk__svc">${esc(b.service)}${b.price != null ? ` · ${euro(b.price)}` : ""}</span>
    <span class="bk__meta">${statusChip(b.status)}${b.source === "website" ? '<span class="chip s-web">Online</span>' : ""}</span>
  </button>`;
}

function renderUpcoming() {
  const q = $("#upSearch").value.trim().toLowerCase();
  const list = S.upcoming
    .filter(b => b.status === "bevestigd" && +new Date(b.ends_at) > Date.now())
    .filter(b => !q || `${b.name} ${b.phone} ${b.email} ${b.service}`.toLowerCase().includes(q));
  const count = S.upcoming.filter(b => b.status === "bevestigd" && +new Date(b.ends_at) > Date.now()).length;
  $("#upCount").textContent = count || "";
  if (!list.length) { $("#upList").innerHTML = `<p class="bh-empty">${q ? "Niets gevonden." : "Geen komende afspraken."}</p>`; return; }
  const groups = {};
  for (const b of list) (groups[startOf(b).iso] ||= []).push(b);
  const today = brusselsNow().iso;
  $("#upList").innerHTML = Object.entries(groups).map(([iso, bs]) => `
    <h3 class="bh-group">${iso === today ? "Vandaag" : iso === addDays(today, 1) ? "Morgen" : dayLabel(iso, true)} <small>${bs.length}</small></h3>
    <div class="bh-cards">${bs.map(cardHtml).join("")}</div>`).join("");
}

function renderClients() {
  const q = $("#clSearch").value.trim().toLowerCase();
  const list = S.clients.filter(c => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  $("#clList").innerHTML = list.length ? `<p class="bh-count">${list.length} klant${list.length === 1 ? "" : "en"}</p><div class="bh-cards">${list.map(c => `
    <button type="button" class="cl" data-client="${esc(c.key)}">
      <span class="cl__av">${esc((c.name || "?").trim()[0] || "?").toUpperCase()}</span>
      <span class="cl__main"><b>${esc(c.name)}</b><small>${esc(prettyPhone(c.phone))}${c.email ? ` · ${esc(c.email)}` : ""}</small></span>
      <span class="cl__stats"><b>${c.visits}×</b><small>${c.next ? `volgende ${dayLabel(startOf(c.next).iso)}` : c.last ? `laatst ${dayLabel(startOf(c.last).iso)}` : "nog geen bezoek"}</small></span>
    </button>`).join("")}</div>` : `<p class="bh-empty">${q ? "Geen klant gevonden." : "Nog geen klanten."}</p>`;
}

// =====================================================================
//  Modals
// =====================================================================
const modal = $("#modal");
let lastFocus = null;
function openModal(title, html) {
  lastFocus = document.activeElement;
  $("#mTitle").textContent = title;
  $("#mBody").innerHTML = html;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#mBody input:not([type=hidden]), #mBody button")?.focus({ preventScroll: true }), 50);
}
function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  lastFocus?.focus?.();
}
$$("[data-mclose]", modal).forEach(b => b.addEventListener("click", closeModal));
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

const findBooking = id => [...S.week, ...S.upcoming, ...S.clients.flatMap(c => c.rows)].find(b => b.id === id);

function showBooking(id) {
  const b = findBooking(id);
  if (!b) return;
  const st = startOf(b);
  if (b.status === "geblokkeerd") {
    openModal("Geblokkeerde tijd", `
      <ul class="bh-dl"><li><span>Wanneer</span><b>${dayLabel(st.iso, true)} · ${timeRange(b)}</b></li>
      <li><span>Reden</span><b>${esc(b.name || "—")}</b></li></ul>
      <div class="bh-actions"><button type="button" class="ed-btn ed-btn--ghost" data-edit-b="${b.id}">Wijzigen</button>
      <button type="button" class="ed-btn ed-btn--danger" data-unblock="${b.id}">Blokkering opheffen</button></div>`);
    return;
  }
  const wa = waNumber(b.phone);
  const created = b.created_at ? new Date(b.created_at) : null;
  openModal(b.name, `
    <div class="bh-mstatus">${statusChip(b.status)}${b.source === "website" ? '<span class="chip s-web">Online geboekt</span>' : '<span class="chip">In de zaak ingepland</span>'}</div>
    <ul class="bh-dl">
      <li><span>Wanneer</span><b>${dayLabel(st.iso, true)} · ${timeRange(b)}</b></li>
      <li><span>Dienst</span><b>${esc(b.service)}${b.category ? ` <small class="muted">(${esc(b.category)})</small>` : ""}</b></li>
      <li><span>Prijs</span><b>${b.price != null ? euro(b.price) : "—"}</b></li>
      <li><span>Telefoon</span><b>${b.phone ? `<a href="tel:${esc(b.phone)}">${esc(prettyPhone(b.phone))}</a>` : "—"}</b></li>
      <li><span>E-mail</span><b>${b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : "—"}</b></li>
      ${b.note ? `<li><span>Opmerking</span><b>${esc(b.note)}</b></li>` : ""}
      ${created ? `<li><span>Geboekt op</span><b>${dayLabel(inBrussels(created).iso)} ${fmt(inBrussels(created).minutes)}</b></li>` : ""}
    </ul>
    <div class="bh-contact">
      ${b.phone ? `<a class="ed-btn ed-btn--ghost" href="tel:${esc(b.phone)}">Bellen</a>` : ""}
      ${wa.length >= 10 ? `<a class="ed-btn ed-btn--ghost" target="_blank" rel="noopener" href="https://wa.me/${wa}">WhatsApp</a>` : ""}
      ${b.email ? `<a class="ed-btn ed-btn--ghost" href="mailto:${esc(b.email)}">Mail</a>` : ""}
    </div>
    <div class="bh-actions">
      ${b.status !== "voltooid" && b.status !== "geannuleerd" ? `<button type="button" class="ed-btn ed-btn--ok" data-status="voltooid|${b.id}">✓ Voltooid</button>` : ""}
      ${b.status === "bevestigd" ? `<button type="button" class="ed-btn ed-btn--ghost" data-status="niet_gekomen|${b.id}">Niet gekomen</button>` : ""}
      ${b.status !== "bevestigd" ? `<button type="button" class="ed-btn ed-btn--ghost" data-restore="${b.id}">Terugzetten naar bevestigd</button>` : ""}
      <button type="button" class="ed-btn ed-btn--ghost" data-edit-b="${b.id}">Wijzigen / verplaatsen</button>
      ${b.status !== "geannuleerd" ? `<button type="button" class="ed-btn ed-btn--danger" data-cancel="${b.id}">Annuleren</button>` : ""}
    </div>`);
}

function showClient(key) {
  const c = S.clients.find(x => x.key === key);
  if (!c) return;
  const wa = waNumber(c.phone);
  const rows = [...c.rows].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  openModal(c.name, `
    <ul class="bh-dl">
      <li><span>Telefoon</span><b>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(prettyPhone(c.phone))}</a>` : "—"}</b></li>
      <li><span>E-mail</span><b>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</b></li>
      <li><span>Bezoeken</span><b>${c.visits}${c.noShow ? ` · <span class="t-no">${c.noShow}× niet gekomen</span>` : ""}${c.cancelled ? ` · ${c.cancelled}× geannuleerd` : ""}</b></li>
      <li><span>Totaal besteed</span><b>${euro(c.spent)}</b></li>
    </ul>
    <div class="bh-contact">
      ${c.phone ? `<a class="ed-btn ed-btn--ghost" href="tel:${esc(c.phone)}">Bellen</a>` : ""}
      ${wa.length >= 10 ? `<a class="ed-btn ed-btn--ghost" target="_blank" rel="noopener" href="https://wa.me/${wa}">WhatsApp</a>` : ""}
      <button type="button" class="ed-btn ed-btn--gold" data-new-for="${esc(key)}">+ Nieuwe afspraak</button>
    </div>
    <h4 class="bh-sub">Geschiedenis</h4>
    <div class="bh-hist">${rows.map(b => `<button type="button" class="bh-hist__row" data-id="${b.id}">
      <span>${dayLabel(startOf(b).iso)} ${fmt(startOf(b).minutes)}</span><span>${esc(b.service)}</span>${statusChip(b.status)}</button>`).join("")}</div>`);
}

// ---------- Formulier: nieuwe afspraak / wijzigen / blokkeren ----------
function serviceOptions(selected) {
  return C.services.map(c => `<optgroup label="${esc(c.label)}">${c.items.map(it =>
    `<option value="${esc(it.id)}" ${selected === it.id ? "selected" : ""}>${esc(it.name)} · ${it.min} min · ${euro(it.price)}</option>`).join("")}</optgroup>`).join("")
    + `<option value="__other" ${selected === "__other" ? "selected" : ""}>Andere / vrij invullen</option>`;
}
const findSvc = id => { for (const c of C.services) for (const it of c.items) if (it.id === id) return { cat: c, it }; return null; };
const findSvcByName = (name, cat) => { for (const c of C.services) for (const it of c.items) if (it.name === name && (!cat || cat.startsWith(c.label))) return it.id; return "__other"; };

function bookingForm(b = null, preset = {}) {
  const blocked = (b?.status || preset.status) === "geblokkeerd";
  const slot = Number(C.settings.slot_min) || 30;
  const st = b ? startOf(b) : { iso: preset.day || S.day, minutes: preset.minutes ?? nextFreeMinute() };
  const dur = b ? durMin(b) : blocked ? 60 : 30;
  const svcId = b ? findSvcByName(b.service, b.category) : (C.services[0]?.items[0]?.id || "__other");
  const title = blocked ? (b ? "Blokkering wijzigen" : "Tijd blokkeren") : b ? "Afspraak wijzigen" : "Nieuwe afspraak";
  openModal(title, `
    <form class="bh-form" id="bForm" novalidate>
      <div class="bh-form__grid">
        <label class="field"><span>Datum</span><input type="date" name="day" value="${st.iso}" required></label>
        <label class="field"><span>${blocked ? "Van" : "Tijd"}</span><input type="time" name="time" step="${slot * 60}" value="${fmt(st.minutes)}" required></label>
        ${blocked ? `
          <label class="field"><span>Tot</span><input type="time" name="until" value="${fmt(Math.min(24 * 60 - 1, st.minutes + dur))}" required></label>
          <label class="ed-check bh-span2"><input type="checkbox" name="allday"> Hele dag (bv. vakantie of vrije dag)</label>
          <label class="field bh-span2"><span>Reden <small>(optioneel)</small></span><input type="text" name="who" maxlength="80" value="${esc(b?.name && b.name !== "Geblokkeerd" ? b.name : "")}" placeholder="bv. pauze, vakantie"></label>`
        : `
          <label class="field bh-span2"><span>Dienst</span><select name="svc">${serviceOptions(svcId)}</select></label>
          <label class="field" data-other ${svcId === "__other" ? "" : "hidden"}><span>Omschrijving</span><input type="text" name="svcName" maxlength="80" value="${esc(svcId === "__other" ? b?.service || "" : "")}"></label>
          <label class="field"><span>Duur (min)</span><input type="number" name="dur" min="5" max="600" step="5" value="${dur}"></label>
          <label class="field"><span>Prijs (€)</span><input type="number" name="price" min="0" step="0.5" inputmode="decimal" value="${b?.price ?? (findSvc(svcId)?.it.price ?? "")}"></label>
          <label class="field bh-span2"><span>Naam klant</span><input type="text" name="who" maxlength="80" autocomplete="off" value="${esc(b?.name || preset.name || "")}" required></label>
          <label class="field"><span>Telefoon</span><input type="tel" name="phone" maxlength="30" value="${esc(b?.phone || preset.phone || "")}"></label>
          <label class="field"><span>E-mail</span><input type="email" name="email" maxlength="120" value="${esc(b?.email || preset.email || "")}"></label>
          <label class="field bh-span2"><span>Opmerking</span><input type="text" name="note" maxlength="300" value="${esc(b?.note || "")}"></label>`}
      </div>
      <p class="book__err" id="fErr" role="alert"></p>
      <div class="bh-actions">
        <button type="button" class="ed-btn ed-btn--ghost" data-mclose2>Annuleren</button>
        <button type="submit" class="ed-btn ed-btn--gold">${blocked ? "Blokkeren" : "Opslaan"}</button>
      </div>
    </form>`);

  const f = $("#bForm");
  $("[data-mclose2]", f).addEventListener("click", closeModal);
  if (!blocked) {
    // nieuwe afspraak: duur en prijs automatisch uit de gekozen dienst
    if (!b) { const s = findSvc(svcId); if (s) { f.dur.value = s.it.min; f.price.value = s.it.price; } }
    f.svc.addEventListener("change", () => {
      const s = findSvc(f.svc.value);
      $("[data-other]", f).hidden = !!s;
      if (s) { f.dur.value = s.it.min; f.price.value = s.it.price; }
    });
  } else {
    f.allday.addEventListener("change", () => {
      const on = f.allday.checked;
      f.time.disabled = f.until.disabled = on;
    });
  }

  f.addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#fErr");
    err.textContent = "";
    const day = f.day.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return (err.textContent = "Kies een datum.");
    const toMin = v => { const [hh, mm] = String(v || "").split(":").map(Number); return hh * 60 + mm; };
    let data;
    if (blocked) {
      const all = f.allday.checked;
      const s = all ? 0 : toMin(f.time.value), en = all ? 24 * 60 : toMin(f.until.value);
      if (!(en > s)) return (err.textContent = "De eindtijd moet na de begintijd liggen.");
      data = { id: b?.id, starts_at: brusselsToDate(day, s).toISOString(), ends_at: brusselsToDate(day, en).toISOString(),
        service: "Geblokkeerd", name: f.who.value.trim() || "Geblokkeerd", status: "geblokkeerd" };
    } else {
      const s = toMin(f.time.value), dur = Math.round(Number(f.dur.value));
      if (Number.isNaN(s)) return (err.textContent = "Kies een tijd.");
      if (!(dur >= 5)) return (err.textContent = "Vul een geldige duur in.");
      if (!f.who.value.trim()) { f.who.focus(); return (err.textContent = "Vul de naam van de klant in."); }
      const sv = findSvc(f.svc.value);
      if (!sv && !f.svcName.value.trim()) { f.svcName.focus(); return (err.textContent = "Omschrijf de behandeling."); }
      const priceV = String(f.price.value).trim();
      data = { id: b?.id, starts_at: brusselsToDate(day, s).toISOString(), ends_at: brusselsToDate(day, s + dur).toISOString(),
        category: sv ? sv.cat.label + (sv.cat.sub ? ` ${sv.cat.sub}` : "") : null, service: sv ? sv.it.name : f.svcName.value.trim(),
        price: priceV === "" ? null : Number(priceV.replace(",", ".")), name: f.who.value.trim(), phone: f.phone.value.trim(),
        email: f.email.value.trim(), note: f.note.value.trim(), status: b && b.status !== "geblokkeerd" ? b.status : "bevestigd" };
    }
    await submitBooking(data, f, err);
  });
}

async function submitBooking(data, f, err, force = false) {
  const btn = $("button[type=submit]", f);
  btn.disabled = true;
  try {
    await api.saveBooking({ ...data, force });
    closeModal();
    toast(data.status === "geblokkeerd" ? "Tijd geblokkeerd." : data.id ? "Afspraak bijgewerkt." : "Afspraak ingepland.", "ok");
    S.day = inBrussels(new Date(data.starts_at)).iso;
    await refresh();
  } catch (e) {
    btn.disabled = false;
    if (/overlap/.test(e.message)) {
      err.innerHTML = `Er staat op dat moment al iets in de agenda. <button type="button" class="bh-link" id="forceBtn">Toch opslaan (dubbel)</button>`;
      $("#forceBtn").addEventListener("click", () => submitBooking(data, f, err, true));
    } else err.textContent = errText(e);
  }
}

function nextFreeMinute() {
  const slot = Number(C.settings.slot_min) || 30;
  const n = brusselsNow();
  const h = hoursFor(C.hours, loc, dowOf(S.day));
  let m = h ? h[0] : 9 * 60;
  if (S.day === n.iso) m = Math.max(m, Math.ceil(n.minutes / slot) * slot);
  return Math.min(m, 23 * 60);
}

async function changeStatus(id, status, msg) {
  try {
    await api.setStatus(id, status);
    toast(msg, "ok");
    await refresh();
    return true;
  } catch (e) { toast(errText(e), "bad"); return false; }
}

// =====================================================================
//  Melding bij nieuwe online boeking
// =====================================================================
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.start(t); o.stop(t + 0.3);
    });
  } catch {}
}
function announce(row) {
  const st = startOf(row);
  const text = `Nieuwe afspraak: ${row.name} · ${dayLabel(st.iso)} ${fmt(st.minutes)} · ${row.service}`;
  toast(text, "ok");
  beep();
  if (document.hidden) document.title = `(●) Nieuwe afspraak — ${LOC.name}`;
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try { new Notification("Classic Barbershop " + LOC.name, { body: text, tag: row.id }); } catch {}
  }
}

// =====================================================================
//  Knoppen
// =====================================================================
function setDay(iso) {
  const weekChanged = mondayOf(iso) !== S.weekKey;
  S.day = iso;
  renderAgenda();
  if (weekChanged) refresh();
}

function wireUi() {
  $$(".bh-tabs [data-tab]").forEach(b => b.addEventListener("click", () => {
    S.tab = b.dataset.tab;
    $$(".bh-tabs [data-tab]").forEach(x => x.setAttribute("aria-selected", x === b));
    $$("[data-view]").forEach(v => (v.hidden = v.dataset.view !== S.tab));
    if (S.tab === "clients") loadClients();
    scrollTo({ top: 0 });
  }));
  $("#prevDay").addEventListener("click", () => setDay(addDays(S.day, -1)));
  $("#nextDay").addEventListener("click", () => setDay(addDays(S.day, 1)));
  $("#todayBtn").addEventListener("click", () => setDay(brusselsNow().iso));
  $("#dayPick").addEventListener("change", e => { if (e.target.value) setDay(e.target.value); });
  $("#week").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (b) setDay(b.dataset.day); });
  $("#showCancelled").addEventListener("change", e => { S.showCancelled = e.target.checked; renderAgenda(); });
  $("#upSearch").addEventListener("input", renderUpcoming);
  $("#clSearch").addEventListener("input", renderClients);
  $("#addBtn").addEventListener("click", () => bookingForm());
  $("#blockBtn").addEventListener("click", () => bookingForm(null, { status: "geblokkeerd" }));
  $("#logoutBtn").addEventListener("click", async () => { await api.signOut(); location.replace("login.html"); });
  $("#exportBtn").addEventListener("click", exportCsv);

  // agenda als app op het beginscherm
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let installEvt = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#installBtn").hidden = false; });
  if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) $("#installBtn").hidden = false;
  $("#installBtn").addEventListener("click", async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installBtn").hidden = true; return; }
    openModal("Agenda op je beginscherm", `<ol class="ed-help">
      <li>Tik onderaan in Safari op <b>Deel</b> (vierkantje met pijl omhoog).</li>
      <li>Kies <b>Zet op beginscherm</b> en tik op <b>Voeg toe</b>.</li>
      <li>Open voortaan de agenda via het Classic-icoon.</li></ol>`);
  });
  addEventListener("appinstalled", () => { $("#installBtn").hidden = true; toast("Agenda staat op je beginscherm.", "ok"); });

  const nb = $("#notifyBtn");
  const syncNotify = () => nb.classList.toggle("is-on", "Notification" in window && Notification.permission === "granted");
  syncNotify();
  nb.addEventListener("click", async () => {
    if (!("Notification" in window)) return toast("Meldingen worden niet ondersteund in deze browser.");
    if (Notification.permission === "granted") return toast("Meldingen staan aan. Je krijgt een melding bij elke nieuwe online afspraak.", "ok");
    const p = await Notification.requestPermission();
    syncNotify();
    toast(p === "granted" ? "Meldingen aan." : "Meldingen zijn geweigerd in je browser.", p === "granted" ? "ok" : "bad");
  });

  // klikken in lijsten en modal
  document.addEventListener("click", async e => {
    const card = e.target.closest("[data-id]");
    if (card && !e.target.closest("a")) return showBooking(card.dataset.id);
    const free = e.target.closest("[data-new]");
    if (free) return bookingForm(null, { minutes: +free.dataset.new });
    const cl = e.target.closest("[data-client]");
    if (cl) return showClient(cl.dataset.client);

    const t = e.target.closest("[data-status],[data-cancel],[data-restore],[data-edit-b],[data-unblock],[data-new-for]");
    if (!t) return;
    if (t.dataset.status) {
      const [status, id] = t.dataset.status.split("|");
      if (await changeStatus(id, status, status === "voltooid" ? "Gemarkeerd als voltooid." : "Gemarkeerd als niet gekomen.")) closeModal();
    }
    if (t.dataset.cancel) {
      const b = findBooking(t.dataset.cancel);
      if (!confirm(`Afspraak van ${b.name} annuleren? Het tijdslot komt weer vrij op de website.`)) return;
      if (await changeStatus(b.id, "geannuleerd", "Afspraak geannuleerd. Het tijdslot is weer vrij.")) {
        const wa = waNumber(b.phone);
        if (wa.length >= 10) {
          const st = startOf(b);
          const msg = `Hallo ${b.name.split(" ")[0]}, je afspraak bij Classic Barbershop ${LOC.name} op ${dayLabel(st.iso)} om ${fmt(st.minutes)} is helaas geannuleerd. Boek gerust een nieuw moment via onze website. Excuses voor het ongemak!`;
          openModal("Geannuleerd", `<p>De afspraak is geannuleerd en het tijdslot is weer vrij.</p>
            <p class="muted">Wil je ${esc(b.name.split(" ")[0])} een bericht sturen?</p>
            <div class="bh-actions"><button type="button" class="ed-btn ed-btn--ghost" data-mclose3>Nee, sluiten</button>
            <a class="ed-btn ed-btn--gold" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">Stuur WhatsApp</a></div>`);
          $("[data-mclose3]").addEventListener("click", closeModal);
        } else closeModal();
      }
    }
    if (t.dataset.restore) {
      const b = findBooking(t.dataset.restore);
      try {
        await api.saveBooking({ ...b, status: "bevestigd" });
        toast("Afspraak staat weer op bevestigd.", "ok"); closeModal(); await refresh();
      } catch (ex) { toast(/overlap/.test(ex.message) ? "Kan niet terugzetten: dat tijdslot is intussen bezet." : errText(ex), "bad"); }
    }
    if (t.dataset.editB) bookingForm(findBooking(t.dataset.editB));
    if (t.dataset.unblock) {
      if (await changeStatus(t.dataset.unblock, "geannuleerd", "Blokkering opgeheven.")) closeModal();
    }
    if (t.dataset.newFor) {
      const c = S.clients.find(x => x.key === t.dataset.newFor);
      bookingForm(null, { name: c.name, phone: c.phone, email: c.email, day: brusselsNow().iso });
    }
  });
}

function exportCsv() {
  if (!S.clients.length) return toast("Nog geen klanten om te exporteren.");
  // tekst die met = + - @ begint niet als Excel-formule laten uitvoeren
  const q = v => { const s = String(v ?? ""); return `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"`; };
  const lines = [["Naam", "Telefoon", "E-mail", "Bezoeken", "Niet gekomen", "Geannuleerd", "Totaal besteed", "Laatste bezoek", "Volgende afspraak"].join(";")];
  for (const c of S.clients) lines.push([c.name, c.phone, c.email, c.visits, c.noShow, c.cancelled, String(c.spent).replace(".", ","),
    c.last ? startOf(c.last).iso : "", c.next ? `${startOf(c.next).iso} ${fmt(startOf(c.next).minutes)}` : ""].map(q).join(";"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `klanten-${loc}-${brusselsNow().iso}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
