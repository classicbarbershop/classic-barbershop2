/* Classic Barbershop — publieke site (opbouw gebaseerd op Sam Barbershop) */
import {
  $, $$, fmt, esc, euro, sanitize, DAY_NAMES, DAY_SHORT, MONTHS, brusselsNow, brusselsToDate,
  inBrussels, addDays, dowOf, dayLabel, hoursFor, isFree, errText,
} from "./core.js?v=202610071502";
import { DEFAULTS } from "./defaults.js?v=202610071502";
import { api, MODE, loadContent } from "./api.js?v=202610071502";

let C = structuredClone(DEFAULTS); // huidige inhoud (standaard → database)
const locById = id => C.locations.find(l => l.id === id);
const fee = () => Number(C.settings.online_fee) || 0;
const slotMin = () => Number(C.settings.slot_min) || 30;

// ---------- Jaar ----------
$("#year").textContent = new Date().getFullYear();

// ---------- Nav ----------
const nav = $("#nav"), mbar = $("#mbar"), hero = $(".hero");
const onScroll = () => {
  const y = window.scrollY;
  nav.classList.toggle("scrolled", y > 20);
  const booking = $("#boeken").getBoundingClientRect();
  mbar.classList.toggle("show", y > hero.offsetHeight * 0.6 && !(booking.top < innerHeight && booking.bottom > 0));
};
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const burger = $("#burger"), drawer = $("#drawer");
const setDrawer = open => {
  burger.setAttribute("aria-expanded", open);
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", !open);
  document.body.style.overflow = open ? "hidden" : "";
};
burger.addEventListener("click", () => setDrawer(burger.getAttribute("aria-expanded") !== "true"));
$$("a", drawer).forEach(a => a.addEventListener("click", () => setDrawer(false)));

// ---------- Reveal ----------
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const sibs = $$(".reveal", e.target.parentElement);
    e.target.style.transitionDelay = `${Math.min(sibs.indexOf(e.target), 6) * 70}ms`;
    e.target.classList.add("in");
    io.unobserve(e.target);
  });
}, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
const observe = (root = document) => $$(".reveal:not(.in)", root).forEach(el => io.observe(el));
observe();

// ---------- Hero parallax ----------
const cards = $$(".hero__visual .card"), visual = $(".hero__visual");
const base = ["rotate(-7deg)", "rotate(1deg)", "rotate(8deg)"];
if (matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) {
  visual.parentElement.addEventListener("mousemove", e => {
    const r = visual.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    cards.forEach((c, i) => { const d = [14, 24, 18][i]; c.style.transform = `translate(${x * d}px, ${y * d}px) ${base[i]}`; });
  });
}

// =====================================================================
//  Inhoud tonen (teksten, foto's, prijzen, galerij, uren)
// =====================================================================
function applyTexts() {
  $$("[data-edit]").forEach(el => {
    const v = C.texts[el.dataset.edit];
    if (v != null && v !== "") el.innerHTML = sanitize(v);
  });
  $$("[data-img]").forEach(img => {
    const v = C.images[img.dataset.img];
    if (v) img.src = v;
  });
}

function renderMenu() {
  const cols = [[], []], count = [0, 0];
  for (const cat of C.services) {
    if (!cat.items.length) continue;
    const i = count[0] <= count[1] ? 0 : 1;
    cols[i].push(cat); count[i] += cat.items.length + 1;
  }
  $("#menu").innerHTML = cols.filter(c => c.length).map(col => `<div class="menu__col reveal">${col.map(cat => `
      <h3 class="menu__cat">${esc(cat.label)}${cat.sub ? ` <small>(${esc(cat.sub)})</small>` : ""}</h3>
      <ul>${cat.items.map(it => `
        <li${it.featured ? ' class="menu__featured"' : ""}><div class="menu__row"><span>${esc(it.name)} <small>${it.min} min</small></span><i></i><b>${euro(it.price)}</b></div>${it.desc ? `<p>${esc(it.desc)}</p>` : ""}${it.featured ? '<span class="tag">Populair</span>' : ""}</li>`).join("")}
      </ul>`).join("")}</div>`).join("");
  $("#menuNote").textContent = fee() ? `* Bij online reserveringen wordt een toeslag van ${euro(fee())} aangerekend.` : "";
  observe($("#menu"));
}

function renderGallery() {
  $("#gallery").innerHTML = C.gallery.map((g, i) => `
    <button class="gallery__item${g.size === "tall" ? " g-tall" : g.size === "wide" ? " g-wide" : ""} reveal" data-i="${i}">
      <img src="${esc(g.src)}" alt="${esc(g.alt || g.cap || "")}" loading="lazy"><span>${esc(g.label || "")}</span>
    </button>`).join("");
  observe($("#gallery"));
}

// openingsuren compact schrijven, bv. "di–vr 09:00–19:00 · za–ma 09:00–18:00"
function hoursSummary(loc) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const key = d => JSON.stringify(hoursFor(C.hours, loc, d));
  let start = order.findIndex((d, i) => key(d) !== key(order[(i + 6) % 7]));
  if (start < 0) { const h = hoursFor(C.hours, loc, 1); return h ? `elke dag ${fmt(h[0])}–${fmt(h[1])}` : "gesloten"; }
  const seq = [...order.slice(start), ...order.slice(0, start)], groups = [];
  for (const d of seq) {
    const g = groups.at(-1);
    if (g && g.k === key(d)) g.days.push(d); else groups.push({ k: key(d), days: [d] });
  }
  return groups.map(g => {
    const h = hoursFor(C.hours, loc, g.days[0]);
    const days = g.days.length === 1 ? DAY_SHORT[g.days[0]] : `${DAY_SHORT[g.days[0]]}–${DAY_SHORT[g.days.at(-1)]}`;
    return `${days} ${h ? `${fmt(h[0])}–${fmt(h[1])}` : "gesloten"}`;
  });
}

function statusText(loc) {
  const { dow: d, minutes } = brusselsNow();
  const h = hoursFor(C.hours, loc, d);
  if (h && minutes >= h[0] && minutes < h[1]) return { open: true, text: `Nu open · tot ${fmt(h[1])}` };
  if (h && minutes < h[0]) return { open: false, text: `Gesloten · opent om ${fmt(h[0])}` };
  for (let i = 1; i <= 7; i++) {
    const n = (d + i) % 7, hn = hoursFor(C.hours, loc, n);
    if (hn) return { open: false, text: `Gesloten · opent ${i === 1 ? "morgen" : DAY_NAMES[n].toLowerCase()} ${fmt(hn[0])}` };
  }
  return { open: false, text: "Gesloten" };
}

function renderStatus() {
  const st = C.locations.map(l => ({ l, s: statusText(l.id) }));
  const open = st.filter(x => x.s.open);
  const hs = $("#heroStatus");
  hs.classList.toggle("is-open", !!open.length);
  hs.classList.toggle("is-closed", !open.length);
  $(".badge-open__text", hs).textContent = open.length
    ? `Nu open · ${open.map(x => x.l.name).join(" & ")}`
    : `Gesloten · ${st[0].s.text.replace("Gesloten · ", "")}`;
  $$("[data-status]").forEach(el => {
    const s = statusText(el.dataset.status);
    el.className = `status ${s.open ? "is-open" : "is-closed"}`;
    el.innerHTML = `<span class="dot"></span>${s.open ? "Nu open" : "Gesloten"}`;
  });
}

function renderHours() {
  const today = brusselsNow().dow;
  $$("[data-hours]").forEach(ul => {
    ul.innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => {
      const h = hoursFor(C.hours, ul.dataset.hours, d);
      return `<li class="${d === today ? "today" : ""}"><span>${DAY_NAMES[d]}</span><span>${h ? `${fmt(h[0])} – ${fmt(h[1])}` : "Gesloten"}</span></li>`;
    }).join("");
  });
  $("#footerHours").innerHTML = C.locations.map(l => {
    const parts = [].concat(hoursSummary(l.id));
    return `${esc(l.name)} — ${parts.map(esc).join("<br>")}`;
  }).join("<br>");
}

// telefoonnummer leesbaar: +32470513916 → 0470 51 39 16
const telPretty = p => {
  const d = String(p || "").replace(/\D/g, ""), n = d.startsWith("32") ? `0${d.slice(2)}` : d;
  return n.length === 10 ? `${n.slice(0, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : p;
};

// vestigingen uit de data: kaarten, belregel en footer (kaarten alleen opnieuw als er iets veranderd is)
let locSig = "";
function renderLocations() {
  const sig = JSON.stringify(C.locations.map(l => [l.id, l.name, l.address, l.phone, l.maps]));
  if (sig !== locSig) {
    locSig = sig;
    $("#locGrid").innerHTML = C.locations.map(l => {
      const [street, ...rest] = String(l.address || "").split(/,\s*/);
      const q = encodeURIComponent(`Classic Barbershop, ${l.address}`);
      const route = l.maps || `https://www.google.com/maps/search/?api=1&query=${q}`;
      return `<article class="loc reveal">
        <div class="loc__map"><iframe title="Kaart Classic Barbershop ${esc(l.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${q}&z=16&output=embed"></iframe></div>
        <div class="loc__body">
          <div class="loc__top"><h3>${esc(l.name)}</h3><span class="status" data-status="${esc(l.id)}"></span></div>
          <p class="loc__addr">${esc(street)}${rest.length ? `<br>${esc(rest.join(", "))}` : ""}</p>
          <ul class="hours" data-hours="${esc(l.id)}"></ul>
          <div class="loc__actions">
            <a href="${esc(route)}" target="_blank" rel="noopener" class="btn btn--ghost btn--sm">Route</a>
            ${l.phone ? `<a href="tel:${esc(l.phone)}" class="btn btn--gold btn--sm">${esc(telPretty(l.phone))}</a>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
    observe($("#locGrid"));
  }
  const withTel = C.locations.filter(l => l.phone);
  $("#callLine").innerHTML = `Liever bellen? ${withTel.map(l => `${esc(l.name)}&nbsp;<a href="tel:${esc(l.phone)}">${esc(telPretty(l.phone)).replace(/ /g, "&nbsp;")}</a>`).join(" · ")}`;
  $("#footerContact").innerHTML = withTel.map(l => `${esc(l.name)} · <a href="tel:${esc(l.phone)}">${esc(telPretty(l.phone))}</a>`).join("<br>");
}

export function renderAll() {
  applyTexts();
  renderLocations();
  renderMenu();
  renderGallery();
  renderHours();
  renderStatus();
  if (book.step <= 2) renderBook();
}

// =====================================================================
//  Afspraak maken: vestiging → categorie → dienst → gegevens → datum & tijd → overzicht
// =====================================================================
const STEP_TITLES = ["Kies een vestiging", "Kies een categorie", "Kies een dienst", "Vul je gegevens in", "Kies datum en tijd", "Overzicht"];
const bBody = $("#bBody"), bTitle = $("#bTitle"), bCount = $("#bCount"), bBar = $("#bBar"), err = $("#bookErr");
const book = { step: 0, busy: null, sending: false };
const catOf = () => C.services.find(c => c.id === book.cat);
const catLabel = c => c.label + (c.sub ? ` ${c.sub}` : "");
const online = MODE !== "off";

if (!online) $("#checkConfirm").textContent = "Bevestiging via WhatsApp";

async function loadBusy(force = false) {
  const loc = book.loc;
  if (!force && book.busy?.loc === loc && Date.now() - book.busy.at < 60_000) return;
  book.busy = { loc, at: Date.now(), list: [], loading: true };
  if (!online) { book.busy.loading = false; return; }
  const from = brusselsToDate(brusselsNow().iso, 0);
  const to = brusselsToDate(addDays(brusselsNow().iso, (C.settings.max_days || 14) + 1), 0);
  try {
    const list = await api.getBusy(loc, from, to);
    if (book.busy.loc === loc) book.busy = { loc, at: Date.now(), list, loading: false };
  } catch (e) {
    book.busy = { loc, at: 0, list: [], loading: false, error: true };
  }
}

function slotsFor(iso) {
  const h = hoursFor(C.hours, book.loc, dowOf(iso));
  if (!h || !book.svc) return [];
  const now = Date.now(), chairs = locById(book.loc)?.chairs || 1, busy = book.busy?.list || [];
  const out = [];
  for (let m = h[0]; m + book.svc.min <= h[1]; m += slotMin()) {
    const s = +brusselsToDate(iso, m), e = s + book.svc.min * 60000;
    const past = s < now + (Number(C.settings.min_notice) || 0) * 60000;
    const taken = !past && !isFree(busy, s, e, chairs);
    out.push({ m, past, taken, ok: !past && !taken });
  }
  return out;
}

const backBtn = `<button type="button" class="bnav__back" data-back>← Terug</button>`;

function renderBook() {
  err.textContent = "";
  bTitle.textContent = STEP_TITLES[book.step] || "";
  bCount.textContent = `Stap ${book.step + 1} van 6`;
  bBar.style.width = `${Math.min(book.step + 1, 6) / 6 * 100}%`;
  let html = "";

  if (book.step === 0) {
    html = `<div class="choices">${C.locations.map(l =>
      `<button type="button" class="choice${book.loc === l.id ? " is-active" : ""}" data-loc="${esc(l.id)}"><span class="choice__ico">📍</span>${esc(l.name)}<small>${esc(l.address)}</small></button>`).join("")}</div>`;
  }
  if (book.step === 1) {
    html = `<div class="choices choices--list">${C.services.filter(c => c.items.length).map(c =>
      `<button type="button" class="choice${book.cat === c.id ? " is-active" : ""}" data-cat="${esc(c.id)}"><span class="choice__ico">${esc(c.icon || "✂️")}</span>${esc(catLabel(c))}<small>${c.items.length} behandeling${c.items.length === 1 ? "" : "en"}</small></button>`).join("")}</div>
      <div class="bnav">${backBtn}</div>`;
  }
  if (book.step === 2) {
    const cat = catOf();
    html = `<div class="choices choices--list">${(cat?.items || []).map(s =>
      `<button type="button" class="choice choice--row${book.svc?.id === s.id ? " is-active" : ""}" data-svc="${esc(s.id)}"><span>${esc(s.name)}<br><small>${s.min} min</small></span><b>${euro(s.price + fee())}</b></button>`).join("")}</div>
      ${fee() ? `<p class="bnote" style="margin-top:14px">Online prijs, inclusief ${euro(fee())} reservatietoeslag.</p>` : ""}
      <div class="bnav">${backBtn}</div>`;
  }
  if (book.step === 3) {
    html = `<div class="bfields">
        <label class="field"><span>Naam</span><input type="text" id="bName" autocomplete="name" maxlength="80" placeholder="Voor- en achternaam" value="${esc(book.name || "")}"></label>
        <label class="field"><span>Telefoonnummer</span><input type="tel" id="bPhone" autocomplete="tel" maxlength="30" placeholder="04xx xx xx xx" value="${esc(book.phone || "")}"></label>
        <label class="field"><span>E-mail</span><input type="email" id="bEmail" autocomplete="email" maxlength="120" placeholder="naam@voorbeeld.be" value="${esc(book.email || "")}"></label>
        <label class="field"><span>Opmerking <small>(optioneel)</small></span><input type="text" id="bNote" maxlength="300" placeholder="bv. graag bij een bepaalde kapper" value="${esc(book.note || "")}"></label>
      </div>
      <p class="bnote" style="margin-top:14px">Je gegevens worden enkel gebruikt voor je afspraak. <a href="privacy.html" target="_blank" style="color:var(--gold)">Privacy</a></p>
      <div class="bnav">${backBtn}<button type="button" class="btn btn--gold" data-next>Volgende</button></div>`;
  }
  if (book.step === 4) {
    if (book.busy?.loading) {
      html = `<div class="bload"><span class="spinner"></span>Vrije tijden laden…</div>`;
    } else {
      const today = brusselsNow().iso, max = C.settings.max_days || 14;
      let days = "", first = null;
      for (let i = 0; i < max; i++) {
        const iso = addDays(today, i);
        const [, mo, d] = iso.split("-").map(Number);
        const label = i === 0 ? "vandaag" : i === 1 ? "morgen" : DAY_SHORT[dowOf(iso)];
        const disabled = !slotsFor(iso).some(s => s.ok);
        if (!disabled && !first) first = iso;
        days += `<label><input type="radio" name="bday" value="${iso}" ${disabled ? "disabled" : ""}><span><small>${label}</small><b>${d}</b><em>${MONTHS[mo - 1]}</em></span></label>`;
      }
      if (!book.day || !slotsFor(book.day).some(s => s.ok)) { book.day = first; book.time = null; }
      html = `${book.busy?.error ? `<p class="bnote bnote--warn">Kon de agenda niet laden. Probeer opnieuw of bel de zaak.</p>` : ""}
        <p class="bstep__sub">Datum</p><div class="days" id="bDays">${days}</div>
        <p class="bstep__sub">Tijdstip</p><div class="slots" id="bSlots"></div>
        <div class="bnav">${backBtn}<button type="button" class="btn btn--gold" data-next>Volgende</button></div>`;
    }
  }
  if (book.step === 5) {
    const loc = locById(book.loc), cat = catOf();
    html = `<ul class="bsum">
        <li><span>Vestiging</span><strong>${esc(loc.name)} · ${esc(loc.address.split(",")[0])}</strong></li>
        <li><span>Categorie</span><strong>${esc(catLabel(cat))}</strong></li>
        <li><span>Dienst</span><strong>${esc(book.svc.name)} · ${book.svc.min} min</strong></li>
        <li><span>Datum &amp; tijd</span><strong>${dayLabel(book.day)} om ${fmt(book.time)}</strong></li>
        <li><span>Naam</span><strong>${esc(book.name)}</strong></li>
        <li><span>Telefoon</span><strong>${esc(book.phone)}</strong></li>
        <li><span>E-mail</span><strong>${esc(book.email)}</strong></li>
        ${book.note ? `<li><span>Opmerking</span><strong>${esc(book.note)}</strong></li>` : ""}
        <li class="bsum__total"><span>Totaal</span><strong>${euro(book.svc.price + fee())}</strong></li>
      </ul>
      <p class="bnote">${online ? "Je afspraak wordt meteen vastgelegd. Betalen doe je in de zaak." : `Na het bevestigen wordt je afspraak via WhatsApp naar Classic Barbershop ${esc(loc.name)} gestuurd.`}</p>
      <div class="bnav">${backBtn}<button type="button" class="btn btn--gold" data-confirm>Afspraak bevestigen</button></div>`;
  }
  if (book.step === 6) {
    const loc = locById(book.loc);
    const tel = loc.phone.replace(/^\+32/, "0").replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4");
    html = online
      ? `<div class="bdone"><div class="bdone__ico">✓</div>
          <p><strong>Tot dan, ${esc(book.name.split(" ")[0])}!</strong><br><span class="muted">Je afspraak staat vast.</span></p>
          <ul class="bsum bsum--done">
            <li><span>Wanneer</span><strong>${dayLabel(book.day, true)} · ${fmt(book.time)}</strong></li>
            <li><span>Waar</span><strong>Classic Barbershop ${esc(loc.name)}<br><small class="muted">${esc(loc.address)}</small></strong></li>
            <li><span>Dienst</span><strong>${esc(book.svc.name)} · ${euro(book.result?.price ?? book.svc.price + fee())}</strong></li>
            <li><span>Referentie</span><strong>${esc(String(book.result?.id || "").replace(/-/g, "").slice(0, 6).toUpperCase())}</strong></li>
          </ul>
          <div class="bdone__actions">
            <button type="button" class="btn btn--gold btn--sm" data-ics>Zet in je agenda</button>
            <button type="button" class="btn btn--ghost btn--sm" data-restart>Nieuwe afspraak</button>
          </div>
          <p class="bnote">Verhinderd? Bel of WhatsApp de zaak op <a href="tel:${esc(loc.phone)}">${esc(tel)}</a>.</p></div>`
      : `<div class="bdone"><div class="bdone__ico">✓</div>
          <p><strong>Bedankt, ${esc(book.name.split(" ")[0])}!</strong><br><span class="muted">Je aanvraag is doorgestuurd naar Classic Barbershop ${esc(loc.name)}. Ze bevestigen zo snel mogelijk.</span></p>
          <button type="button" class="btn btn--ghost" data-restart>Nieuwe afspraak</button></div>`;
    bTitle.textContent = online ? "Afspraak bevestigd" : "Afspraak verstuurd";
    bCount.textContent = "Klaar";
  }

  bBody.innerHTML = html;
  bBody.style.animation = "none"; void bBody.offsetHeight; bBody.style.animation = "";
  wireBook();
}

function go(n) {
  book.step = n;
  if (n === 4) {
    loadBusy().then(() => { if (book.step === 4) renderBook(); });
  }
  renderBook();
  const top = $("#book").getBoundingClientRect().top;
  if (top < 0) $("#book").scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawSlots() {
  const el = $("#bSlots");
  if (!el) return;
  const list = book.day ? slotsFor(book.day) : [];
  el.innerHTML = list.length
    ? list.map(s => `<label${s.taken ? ' class="is-taken"' : ""}><input type="radio" name="btime" value="${s.m}" ${s.ok ? "" : "disabled"} ${book.time === s.m ? "checked" : ""}><span>${fmt(s.m)}</span></label>`).join("")
    : `<p class="slots__empty">Kies eerst een dag.</p>`;
}

function icsFile() {
  const loc = locById(book.loc);
  const s = brusselsToDate(book.day, book.time), e = new Date(+s + book.svc.min * 60000);
  const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const txt = s2 => s2.replace(/([,;\\])/g, "\\$1");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Classic Barbershop//NL", "BEGIN:VEVENT",
    `UID:${book.result?.id || Date.now()}@classicbarbershop`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(s)}`, `DTEND:${z(e)}`,
    `SUMMARY:${txt(`${book.svc.name} – Classic Barbershop ${loc.name}`)}`, `LOCATION:${txt(loc.address)}`,
    `DESCRIPTION:${txt(`Afspraak bij Classic Barbershop ${loc.name}. Tel. ${loc.phone}`)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  a.download = "afspraak-classic-barbershop.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function confirmBooking(btn) {
  if (book.sending) return;
  const loc = locById(book.loc), cat = catOf();
  if (!online) {
    const msg = [
      `Hallo Classic Barbershop ${loc.name}! 💈 Ik wil graag een afspraak maken.`, ``,
      `• Dienst: ${book.svc.name} (${catLabel(cat)}) — ${euro(book.svc.price + fee())}`,
      `• Wanneer: ${dayLabel(book.day)} om ${fmt(book.time)}`,
      `• Naam: ${book.name}`, `• Telefoon: ${book.phone}`, `• E-mail: ${book.email}`,
      ...(book.note ? [`• Opmerking: ${book.note}`] : []), ``, `Graag een bevestiging. Bedankt!`,
    ].join("\n");
    window.open(`https://wa.me/${loc.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    return go(6);
  }
  book.sending = true;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Bezig…`;
  try {
    book.result = await api.createBooking({
      loc: book.loc, serviceId: book.svc.id, start: brusselsToDate(book.day, book.time),
      name: book.name, phone: book.phone, email: book.email, note: book.note,
    });
    book.busy = null;
    go(6);
  } catch (e) {
    const msg = errText(e);
    if (/bezet|tijd_voorbij|ongeldig_tijdslot|gesloten/.test(e.message)) {
      book.time = null;
      await loadBusy(true);
      go(4);
      err.textContent = msg;
    } else if (/onbekende_dienst/.test(e.message)) {
      go(2); err.textContent = msg;
    } else {
      err.textContent = msg;
      btn.disabled = false;
      btn.textContent = "Afspraak bevestigen";
    }
  } finally { book.sending = false; }
}

function wireBook() {
  $("[data-back]", bBody)?.addEventListener("click", () => go(book.step - 1));
  $$("[data-loc]", bBody).forEach(b => b.addEventListener("click", () => {
    if (book.loc !== b.dataset.loc) { book.day = null; book.time = null; book.busy = null; }
    book.loc = b.dataset.loc; go(1);
  }));
  $$("[data-cat]", bBody).forEach(b => b.addEventListener("click", () => {
    if (book.cat !== b.dataset.cat) book.svc = null;
    book.cat = b.dataset.cat; go(2);
  }));
  $$("[data-svc]", bBody).forEach(b => b.addEventListener("click", () => {
    book.svc = catOf().items.find(s => s.id === b.dataset.svc); book.time = null; go(3);
  }));

  if (book.step === 3) {
    $("[data-next]", bBody).addEventListener("click", () => {
      book.name = $("#bName").value.trim();
      book.phone = $("#bPhone").value.trim();
      book.email = $("#bEmail").value.trim();
      book.note = $("#bNote").value.trim();
      if (book.name.length < 2) { $("#bName").focus(); return (err.textContent = "Vul je naam in."); }
      const digits = book.phone.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) { $("#bPhone").focus(); return (err.textContent = "Vul een geldig telefoonnummer in."); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(book.email)) { $("#bEmail").focus(); return (err.textContent = "Vul een geldig e-mailadres in."); }
      go(4);
    });
    $$("input", bBody).forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") $("[data-next]", bBody).click(); }));
  }
  if (book.step === 4 && $("#bDays")) {
    const pick = book.day && $(`input[name=bday][value="${book.day}"]`, bBody);
    if (pick) { pick.checked = true; pick.closest("label").scrollIntoView({ block: "nearest", inline: "nearest" }); }
    drawSlots();
    $("#bDays").addEventListener("change", e => { book.day = e.target.value; book.time = null; err.textContent = ""; drawSlots(); });
    $("#bSlots").addEventListener("change", e => { book.time = +e.target.value; err.textContent = ""; });
    $("[data-next]", bBody).addEventListener("click", () => {
      if (!book.day) return (err.textContent = "Kies een datum.");
      if (book.time == null) return (err.textContent = "Kies een tijdstip.");
      go(5);
    });
  }
  if (book.step === 5) $("[data-confirm]", bBody).addEventListener("click", e => confirmBooking(e.currentTarget));
  $("[data-ics]", bBody)?.addEventListener("click", icsFile);
  $("[data-restart]", bBody)?.addEventListener("click", () => {
    Object.assign(book, { step: 0, loc: null, cat: null, svc: null, day: null, time: null, result: null, busy: null });
    renderBook();
  });
}

// =====================================================================
//  Lightbox (werkt met de galerij uit de data)
// =====================================================================
const lb = $("#lightbox"), lbImg = $("#lbImg"), lbCap = $("#lbCap");
let idx = 0, lastFocus = null;
const show = i => {
  idx = (i + C.gallery.length) % C.gallery.length;
  const g = C.gallery[idx];
  lbImg.src = g.src; lbImg.alt = g.alt || g.cap || ""; lbCap.textContent = g.cap || g.label || "";
};
const openLb = i => {
  lastFocus = document.activeElement;
  show(i);
  lb.classList.add("open"); lb.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  $("#lbClose").focus();
};
const closeLb = () => {
  lb.classList.remove("open"); lb.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  lastFocus?.focus();
};
$("#gallery").addEventListener("click", e => {
  const it = e.target.closest(".gallery__item");
  if (!it || document.body.classList.contains("is-editing")) return;
  openLb(+it.dataset.i);
});
$("#lbClose").addEventListener("click", closeLb);
$("#lbPrev").addEventListener("click", () => show(idx - 1));
$("#lbNext").addEventListener("click", () => show(idx + 1));
lb.addEventListener("click", e => { if (e.target === lb) closeLb(); });
addEventListener("keydown", e => {
  if (!lb.classList.contains("open")) return;
  if (e.key === "Escape") closeLb();
  if (e.key === "ArrowLeft") show(idx - 1);
  if (e.key === "ArrowRight") show(idx + 1);
});
let sx = 0;
lb.addEventListener("touchstart", e => (sx = e.touches[0].clientX), { passive: true });
lb.addEventListener("touchend", e => {
  const dx = e.changedTouches[0].clientX - sx;
  if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
}, { passive: true });

// =====================================================================
//  Opstarten
// =====================================================================
renderAll();
renderBook();
setInterval(renderStatus, 60_000);

loadContent().then(async c => {
  C = c;
  renderAll();
  // directe link per vestiging, bv. index.html?vestiging=haacht (voor het Google-profiel)
  const want = new URLSearchParams(location.search).get("vestiging");
  if (want && locById(want.toLowerCase())) {
    book.loc = want.toLowerCase();
    go(1);
    setTimeout(() => $("#boeken").scrollIntoView({ behavior: "smooth" }), 300);
  }
  // ingelogd?
  const me = await api.session().catch(() => null);
  const link = $("#loginLink");
  if (me?.role === "admin") {
    link.lastChild.textContent = " Bewerkmodus";
    const { startEditor } = await import("./edit.js?v=202610071502");
    startEditor({ getContent: () => C, setContent: v => { C = v; renderAll(); }, me });
  } else if (me) {
    link.href = "beheer.html";
    link.lastChild.textContent = " Naar agenda";
  }
});
