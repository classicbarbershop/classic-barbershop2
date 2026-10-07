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

  // ---------- Boekingsformulier ----------
  const form = $("#bookForm");
  const daysEl = $("#days");
  const slotsEl = $("#slots");
  const summary = $("#summary");
  const err = $("#bookErr");

  function buildDays() {
    const { date } = brusselsNow();
    let html = "";
    let firstSelectable = null;
    for (let i = 0; i < 14; i++) {
      const d = new Date(date);
      d.setDate(d.getDate() + i);
      const closed = !HOURS[currentLoc()][d.getDay()];
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const label = i === 0 ? "vandaag" : i === 1 ? "morgen" : DAY_SHORT[d.getDay()];
      const disabled = closed || (i === 0 && slotsFor(iso).every(s => s.past));
      if (!disabled && firstSelectable === null) firstSelectable = iso;
      html += `<label><input type="radio" name="day" value="${iso}" ${disabled ? "disabled" : ""}>
        <span><small>${label}</small><b>${d.getDate()}</b><em>${MONTHS[d.getMonth()]}</em></span></label>`;
    }
    daysEl.innerHTML = html;
    if (firstSelectable) $(`input[value="${firstSelectable}"]`, daysEl).checked = true;
  }

  function currentLoc() { return $("input[name=loc]:checked", form).value; }
  function serviceMinutes() { return +($("#service").selectedOptions[0]?.dataset.min || SLOT_MIN); }

  function slotsFor(iso) {
    const { date, minutes } = brusselsNow();
    const todayIso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const [y, mo, da] = iso.split("-").map(Number);
    const h = HOURS[currentLoc()][new Date(y, mo - 1, da).getDay()];
    const out = [];
    if (!h) return out;
    const dur = serviceMinutes();
    for (let m = h[0]; m + dur <= h[1]; m += SLOT_MIN) {
      out.push({ m, past: iso === todayIso && m <= minutes + 15 });
    }
    return out;
  }

  function buildSlots() {
    const day = form.day && $("input[name=day]:checked", form);
    if (!day) { slotsEl.innerHTML = `<p class="slots__empty">Kies eerst een dag.</p>`; return; }
    slotsEl.innerHTML = slotsFor(day.value).map(s =>
      `<label><input type="radio" name="time" value="${fmt(s.m)}" ${s.past ? "disabled" : ""}><span>${fmt(s.m)}</span></label>`
    ).join("");
  }

  function selection() {
    const loc = $("input[name=loc]:checked", form).value;
    const service = $("#service").value;
    const dayIn = $("input[name=day]:checked", form);
    const timeIn = $("input[name=time]:checked", form);
    const name = $("#name").value.trim();
    const note = $("#note").value.trim();
    let dayLabel = "";
    if (dayIn) {
      const [y, mo, da] = dayIn.value.split("-").map(Number);
      const d = new Date(y, mo - 1, da);
      dayLabel = `${DAY_NAMES[d.getDay()].toLowerCase()} ${da} ${MONTHS[mo - 1]}`;
    }
    return { loc, service, day: dayIn?.value, dayLabel, time: timeIn?.value, name, note };
  }

  function updateSummary() {
    const s = selection();
    err.textContent = "";
    if (!s.day || !s.time) { summary.textContent = "Kies een dag en tijdstip."; return; }
    summary.innerHTML = `<strong>${s.service}</strong> · ${s.dayLabel} om <strong>${s.time}</strong> · ${LOC_NAME[s.loc]}`;
  }

  buildDays();
  buildSlots();
  updateSummary();

  form.addEventListener("change", e => {
    if (e.target.name === "loc" || e.target.name === "service") {
      const keep = $("input[name=day]:checked", form)?.value;
      buildDays();
      const again = keep && $(`input[value="${keep}"]:not(:disabled)`, daysEl);
      if (again) again.checked = true;
      buildSlots();
    }
    if (e.target.name === "day") buildSlots();
    updateSummary();
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const s = selection();
    if (!s.day) return (err.textContent = "Kies een dag.");
    if (!s.time) return (err.textContent = "Kies een tijdstip.");
    if (!s.name) { $("#name").focus(); return (err.textContent = "Vul je naam in."); }

    const msg = [
      `Hallo Classic Barbershop ${LOC_NAME[s.loc]}! 💈 Ik wil graag een afspraak maken.`,
      ``,
      `• Naam: ${s.name}`,
      `• Dienst: ${s.service}`,
      `• Wanneer: ${s.dayLabel} om ${s.time}`,
      `• Locatie: ${LOC_LABEL[s.loc]}`,
      s.note ? `• Opmerking: ${s.note}` : null,
      ``,
      `Past dat?`,
    ].filter(l => l !== null).join("\n");

    window.open(`https://wa.me/${PHONES[s.loc]}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  });

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
