/* Classic Barbershop — interacties (opbouw gebaseerd op Sam Barbershop) */
(() => {
  "use strict";

  // ---------- Config ----------
  // Openingsuren per vestiging — 0 = zondag … 6 = zaterdag, [open, sluit] in minuten, null = gesloten
  const H = (a, b) => [a * 60, b * 60];
  const HOURS = {
    haacht:  { 0: H(9, 18), 1: H(9, 18), 2: H(9, 19), 3: H(9, 19), 4: H(9, 19), 5: H(9, 19), 6: H(9, 18) },
    wilsele: { 0: H(10, 18), 1: H(10, 19), 2: H(10, 19), 3: H(10, 19), 4: H(10, 19), 5: H(10, 19), 6: H(10, 18) },
  };
  const SLOT_MIN = 30;
  const PHONES = { haacht: "32470513916", wilsele: "32492860437" };
  const LOC_LABEL = { haacht: "Haacht (Vekestraat 1)", wilsele: "Wilsele (Aarschotsesteenweg 664)" };
  const LOC_NAME = { haacht: "Haacht", wilsele: "Wilsele" };
  const DAY_NAMES = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
  const DAY_SHORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, "0");
  const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

  // Huidige tijd in Brussel, ongeacht de tijdzone van de bezoeker
  function brusselsNow() {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date()).map(x => [x.type, x.value])
    );
    const date = new Date(+p.year, +p.month - 1, +p.day);
    return { date, minutes: (+p.hour % 24) * 60 + +p.minute };
  }

  // ---------- Jaar ----------
  $("#year").textContent = new Date().getFullYear();

  // ---------- Nav ----------
  const nav = $("#nav");
  const mbar = $("#mbar");
  const hero = $(".hero");
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 20);
    const pastHero = y > hero.offsetHeight * 0.6;
    const booking = $("#boeken").getBoundingClientRect();
    const inBooking = booking.top < innerHeight && booking.bottom > 0;
    mbar.classList.toggle("show", pastHero && !inBooking);
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const burger = $("#burger");
  const drawer = $("#drawer");
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
  $$(".reveal").forEach(el => io.observe(el));

  // ---------- Hero parallax ----------
  const cards = $$(".hero__visual .card");
  const visual = $(".hero__visual");
  const base = ["rotate(-7deg)", "rotate(1deg)", "rotate(8deg)"];
  if (matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) {
    visual.parentElement.addEventListener("mousemove", e => {
      const r = visual.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cards.forEach((c, i) => {
        const d = [14, 24, 18][i];
        c.style.transform = `translate(${x * d}px, ${y * d}px) ${base[i]}`;
      });
    });
  }

  // ---------- Openingsuren & status ----------
  function statusText(loc) {
    const { date, minutes } = brusselsNow();
    const d = date.getDay();
    const h = HOURS[loc][d];
    if (h && minutes >= h[0] && minutes < h[1]) return { open: true, text: `Nu open · tot ${fmt(h[1])}` };
    if (h && minutes < h[0]) return { open: false, text: `Gesloten · opent om ${fmt(h[0])}` };
    let n = (d + 1) % 7;
    while (!HOURS[loc][n]) n = (n + 1) % 7;
    const when = n === (d + 1) % 7 ? "morgen" : DAY_NAMES[n].toLowerCase();
    return { open: false, text: `Gesloten · opent ${when} ${fmt(HOURS[loc][n][0])}` };
  }

  function renderStatus() {
    const sh = statusText("haacht"), sw = statusText("wilsele");
    const anyOpen = sh.open || sw.open;
    const hs = $("#heroStatus");
    hs.classList.toggle("is-open", anyOpen);
    hs.classList.toggle("is-closed", !anyOpen);
    $(".badge-open__text", hs).textContent = anyOpen
      ? `Nu open · ${[sh.open && "Haacht", sw.open && "Wilsele"].filter(Boolean).join(" & ")}`
      : `Gesloten · ${sh.text.replace("Gesloten · ", "")}`;
    $$("[data-status]").forEach(el => {
      const s = statusText(el.dataset.status);
      el.className = `status ${s.open ? "is-open" : "is-closed"}`;
      el.innerHTML = `<span class="dot"></span>${s.open ? "Nu open" : "Gesloten"}`;
    });
  }

  function renderHours() {
    const today = brusselsNow().date.getDay();
    const order = [1, 2, 3, 4, 5, 6, 0];
    $$("[data-hours]").forEach(ul => {
      const hrs = HOURS[ul.dataset.hours];
      ul.innerHTML = order.map(d => {
        const h = hrs[d];
        return `<li class="${d === today ? "today" : ""}"><span>${DAY_NAMES[d]}</span><span>${h ? `${fmt(h[0])} – ${fmt(h[1])}` : "Gesloten"}</span></li>`;
      }).join("");
    });
  }

  renderHours();
  renderStatus();
  setInterval(renderStatus, 60_000);

  // ---------- Afspraak maken: stappen zoals op de site van Classic Barbershop ----------
  // Vestiging → categorie → dienst → gegevens → datum & tijd → overzicht → bevestigen
  const SERVICES = {
    heren: { label: "Heren", icon: "✂️", items: [
      { name: "Knippen", min: 30, price: 20 },
      { name: "Wassen & knippen", min: 35, price: 25 },
      { name: "Baard & haar", min: 45, price: 35 },
      { name: "Baard scheren met/of aflijnen", min: 25, price: 20 },
      { name: "Bruid VIP", min: 60, price: 50 },
    ] },
    kinderen: { label: "Kinderen onder 10 jaar", icon: "👦", items: [
      { name: "Jongens", min: 25, price: 15 },
      { name: "Fade", min: 30, price: 20 },
      { name: "Meisjes", min: 25, price: 20 },
    ] },
    dames: { label: "Dames", icon: "👩", items: [
      { name: "Knippen", min: 35, price: 25 },
      { name: "Wassen & handdoeken", min: 25, price: 15 },
      { name: "Wassen, knippen & handdoeken", min: 50, price: 30 },
    ] },
  };
  const ONLINE_FEE = 5;
  const ADDR = { haacht: "Vekestraat 1, 3150 Haacht", wilsele: "Aarschotsesteenweg 664, 3012 Wilsele" };
  const STEP_TITLES = ["Kies een vestiging", "Kies een categorie", "Kies een dienst", "Vul uw gegevens in", "Kies datum en tijd", "Overzicht"];

  const bBody = $("#bBody"), bTitle = $("#bTitle"), bCount = $("#bCount"), bBar = $("#bBar"), err = $("#bookErr");
  const st = { step: 0 };
  const euro = n => `€${n},00`;
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = iso => { const [y, mo, da] = iso.split("-").map(Number); return new Date(y, mo - 1, da); };
  const dayLabel = iso => { const d = dateOf(iso); return `${DAY_NAMES[d.getDay()].toLowerCase()} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function slotsFor(iso) {
    const { date, minutes } = brusselsNow();
    const h = HOURS[st.loc][dateOf(iso).getDay()];
    if (!h) return [];
    const out = [];
    for (let m = h[0]; m + st.svc.min <= h[1]; m += SLOT_MIN) {
      out.push({ m, past: iso === isoOf(date) && m <= minutes + 15 });
    }
    return out;
  }

  const backBtn = `<button type="button" class="bnav__back" data-back>← Terug</button>`;

  function render() {
    err.textContent = "";
    bTitle.textContent = STEP_TITLES[st.step] || "";
    bCount.textContent = `Stap ${st.step + 1} van 6`;
    bBar.style.width = `${Math.min(st.step + 1, 6) / 6 * 100}%`;
    let html = "";

    if (st.step === 0) {
      html = `<div class="choices">${["haacht", "wilsele"].map(k =>
        `<button type="button" class="choice${st.loc === k ? " is-active" : ""}" data-loc="${k}"><span class="choice__ico">📍</span>${LOC_NAME[k]}<small>${ADDR[k]}</small></button>`).join("")}</div>`;
    }
    if (st.step === 1) {
      html = `<div class="choices choices--list">${Object.entries(SERVICES).map(([k, c]) =>
        `<button type="button" class="choice${st.cat === k ? " is-active" : ""}" data-cat="${k}"><span class="choice__ico">${c.icon}</span>${c.label}<small>${c.items.length} behandelingen</small></button>`).join("")}</div>
        <div class="bnav">${backBtn}</div>`;
    }
    if (st.step === 2) {
      html = `<div class="choices choices--list">${SERVICES[st.cat].items.map((s, i) =>
        `<button type="button" class="choice choice--row${st.svc === s ? " is-active" : ""}" data-svc="${i}"><span>${s.name}<br><small>${s.min} min</small></span><b>${euro(s.price + ONLINE_FEE)}</b></button>`).join("")}</div>
        <p class="bnote" style="margin-top:14px">Online prijs, inclusief €${ONLINE_FEE} reservatietoeslag.</p>
        <div class="bnav">${backBtn}</div>`;
    }
    if (st.step === 3) {
      html = `<div class="bfields">
          <label class="field"><span>Naam</span><input type="text" id="bName" autocomplete="name" placeholder="Voor- en achternaam" value="${esc(st.name || "")}"></label>
          <label class="field"><span>Telefoonnummer</span><input type="tel" id="bPhone" autocomplete="tel" placeholder="04xx xx xx xx" value="${esc(st.phone || "")}"></label>
          <label class="field"><span>E-mail</span><input type="email" id="bEmail" autocomplete="email" placeholder="naam@voorbeeld.be" value="${esc(st.email || "")}"></label>
        </div>
        <div class="bnav">${backBtn}<button type="button" class="btn btn--gold" data-next>Volgende</button></div>`;
    }
    if (st.step === 4) {
      const { date } = brusselsNow();
      let days = "", first = null;
      for (let i = 0; i < 14; i++) {
        const d = new Date(date); d.setDate(d.getDate() + i);
        const iso = isoOf(d);
        const label = i === 0 ? "vandaag" : i === 1 ? "morgen" : DAY_SHORT[d.getDay()];
        const disabled = slotsFor(iso).every(s => s.past);
        if (!disabled && !first) first = iso;
        days += `<label><input type="radio" name="bday" value="${iso}" ${disabled ? "disabled" : ""}><span><small>${label}</small><b>${d.getDate()}</b><em>${MONTHS[d.getMonth()]}</em></span></label>`;
      }
      if (!st.day || slotsFor(st.day).every(s => s.past)) { st.day = first; st.time = null; }
      html = `<p class="bstep__sub">Datum</p><div class="days" id="bDays">${days}</div>
        <p class="bstep__sub">Tijdstip</p><div class="slots" id="bSlots"></div>
        <div class="bnav">${backBtn}<button type="button" class="btn btn--gold" data-next>Volgende</button></div>`;
    }
    if (st.step === 5) {
      html = `<ul class="bsum">
          <li><span>Vestiging</span><strong>${LOC_LABEL[st.loc]}</strong></li>
          <li><span>Categorie</span><strong>${SERVICES[st.cat].label}</strong></li>
          <li><span>Dienst</span><strong>${st.svc.name} · ${st.svc.min} min</strong></li>
          <li><span>Datum &amp; tijd</span><strong>${dayLabel(st.day)} om ${st.time}</strong></li>
          <li><span>Naam</span><strong>${esc(st.name)}</strong></li>
          <li><span>Telefoon</span><strong>${esc(st.phone)}</strong></li>
          <li><span>E-mail</span><strong>${esc(st.email)}</strong></li>
          <li class="bsum__total"><span>Totaal</span><strong>${euro(st.svc.price + ONLINE_FEE)}</strong></li>
        </ul>
        <p class="bnote">Na het bevestigen wordt je afspraak via WhatsApp naar Classic Barbershop ${LOC_NAME[st.loc]} gestuurd.</p>
        <div class="bnav">${backBtn}<button type="button" class="btn btn--gold" data-confirm>Afspraak bevestigen</button></div>`;
    }
    if (st.step === 6) {
      html = `<div class="bdone"><div class="bdone__ico">✓</div>
          <p><strong>Bedankt, ${esc(st.name.split(" ")[0])}!</strong><br><span class="muted">Je afspraak is doorgestuurd naar Classic Barbershop ${LOC_NAME[st.loc]}. Ze bevestigen zo snel mogelijk.</span></p>
          <button type="button" class="btn btn--ghost" data-restart>Nieuwe afspraak</button></div>`;
      bTitle.textContent = "Afspraak verstuurd";
      bCount.textContent = "Klaar";
    }

    bBody.innerHTML = html;
    bBody.style.animation = "none"; void bBody.offsetHeight; bBody.style.animation = "";
    wire();
  }

  function go(n) { st.step = n; render(); }

  function drawSlots() {
    const el = $("#bSlots");
    if (!el) return;
    const list = st.day ? slotsFor(st.day) : [];
    el.innerHTML = list.length
      ? list.map(s => `<label><input type="radio" name="btime" value="${fmt(s.m)}" ${s.past ? "disabled" : ""} ${st.time === fmt(s.m) ? "checked" : ""}><span>${fmt(s.m)}</span></label>`).join("")
      : `<p class="slots__empty">Kies eerst een dag.</p>`;
  }

  function wire() {
    $("[data-back]", bBody)?.addEventListener("click", () => go(st.step - 1));
    $$("[data-loc]", bBody).forEach(b => b.addEventListener("click", () => { if (st.loc !== b.dataset.loc) { st.day = null; st.time = null; } st.loc = b.dataset.loc; go(1); }));
    $$("[data-cat]", bBody).forEach(b => b.addEventListener("click", () => { if (st.cat !== b.dataset.cat) st.svc = null; st.cat = b.dataset.cat; go(2); }));
    $$("[data-svc]", bBody).forEach(b => b.addEventListener("click", () => { st.svc = SERVICES[st.cat].items[+b.dataset.svc]; st.time = null; go(3); }));

    if (st.step === 3) {
      $("[data-next]", bBody).addEventListener("click", () => {
        st.name = $("#bName").value.trim();
        st.phone = $("#bPhone").value.trim();
        st.email = $("#bEmail").value.trim();
        if (!st.name) { $("#bName").focus(); return (err.textContent = "Vul je naam in."); }
        if (st.phone.replace(/\D/g, "").length < 9) { $("#bPhone").focus(); return (err.textContent = "Vul een geldig telefoonnummer in."); }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(st.email)) { $("#bEmail").focus(); return (err.textContent = "Vul een geldig e-mailadres in."); }
        go(4);
      });
    }
    if (st.step === 4) {
      const pick = st.day && $(`input[name=bday][value="${st.day}"]`, bBody);
      if (pick) pick.checked = true;
      drawSlots();
      $("#bDays").addEventListener("change", e => { st.day = e.target.value; st.time = null; err.textContent = ""; drawSlots(); });
      $("#bSlots").addEventListener("change", e => { st.time = e.target.value; err.textContent = ""; });
      $("[data-next]", bBody).addEventListener("click", () => {
        if (!st.day) return (err.textContent = "Kies een datum.");
        if (!st.time) return (err.textContent = "Kies een tijdstip.");
        go(5);
      });
    }
    if (st.step === 5) {
      $("[data-confirm]", bBody).addEventListener("click", () => {
        const msg = [
          `Hallo Classic Barbershop ${LOC_NAME[st.loc]}! 💈 Ik wil graag een afspraak maken.`,
          ``,
          `• Dienst: ${st.svc.name} (${SERVICES[st.cat].label}) — ${euro(st.svc.price + ONLINE_FEE)}`,
          `• Wanneer: ${dayLabel(st.day)} om ${st.time}`,
          `• Naam: ${st.name}`,
          `• Telefoon: ${st.phone}`,
          `• E-mail: ${st.email}`,
          ``,
          `Graag een bevestiging. Bedankt!`,
        ].join("\n");
        window.open(`https://wa.me/${PHONES[st.loc]}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
        go(6);
      });
    }
    $("[data-restart]", bBody)?.addEventListener("click", () => { Object.assign(st, { step: 0, loc: null, cat: null, svc: null, day: null, time: null }); render(); });
  }

  render();

  // ---------- Lightbox ----------
  const items = $$(".gallery__item");
  const lb = $("#lightbox");
  const lbImg = $("#lbImg");
  const lbCap = $("#lbCap");
  let idx = 0;
  let lastFocus = null;

  const show = i => {
    idx = (i + items.length) % items.length;
    const it = items[idx];
    lbImg.src = it.dataset.src;
    lbImg.alt = $("img", it).alt;
    lbCap.textContent = it.dataset.cap;
  };
  const openLb = i => {
    lastFocus = document.activeElement;
    show(i);
    lb.classList.add("open");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("#lbClose").focus();
  };
  const closeLb = () => {
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    lastFocus?.focus();
  };

  items.forEach((it, i) => it.addEventListener("click", () => openLb(i)));
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

  // swipe op mobiel
  let sx = 0;
  lb.addEventListener("touchstart", e => (sx = e.touches[0].clientX), { passive: true });
  lb.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });
})();
