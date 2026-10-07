// Bewerkmodus voor de eigenaar (rol: admin). Wordt alleen geladen na inloggen.
import { $, $$, esc, fmt, clone, uid, sanitize, compressImage, toast, errText, ask, DAY_NAMES } from "./core.js?v=202610071654";
import { api } from "./api.js?v=202610071654";

const KEY_LABEL = { texts: "teksten", images: "foto's", services: "prijzen", gallery: "galerij", hours: "openingsuren", settings: "instellingen", locations: "vestigingen" };

export function startEditor({ getContent, setContent }) {
  const draft = clone(getContent());
  const dirty = new Set();

  // geüploade foto's in de opslag bijhouden, zodat vervangen foto's opgeruimd worden
  const storedUrls = c => new Set([...Object.values(c.images || {}), ...(c.gallery || []).map(g => g.src)]
    .filter(u => typeof u === "string" && u.includes("/storage/v1/object/public/site/")));
  let savedUrls = storedUrls(draft);
  const uploaded = new Set();

  document.body.classList.add("is-editing");

  // ---------- Werkbalk ----------
  const bar = document.createElement("div");
  bar.className = "ed-bar";
  bar.innerHTML = `
    <span class="ed-bar__tag"><span class="ed-dot"></span>Bewerkmodus</span>
    <div class="ed-bar__tools">
      <button type="button" data-panel="services">Prijzen</button>
      <button type="button" data-panel="gallery">Galerij</button>
      <button type="button" data-panel="hours">Openingsuren</button>
      <button type="button" data-panel="locations">Vestigingen</button>
      <button type="button" data-panel="settings">Instellingen</button>
      <button type="button" data-help>Hulp</button>
    </div>
    <div class="ed-bar__main">
      <button type="button" class="ed-btn ed-btn--ghost" data-preview>Bekijken</button>
      <button type="button" class="ed-btn ed-btn--gold" data-save disabled>Opgeslagen</button>
      <button type="button" class="ed-btn ed-btn--ghost" data-logout title="Uitloggen">Uitloggen</button>
    </div>`;
  document.body.append(bar);

  const saveBtn = $("[data-save]", bar);
  const markDirty = key => {
    dirty.add(key);
    saveBtn.disabled = false;
    saveBtn.textContent = `Opslaan (${dirty.size})`;
    saveBtn.title = `Niet opgeslagen: ${[...dirty].map(k => KEY_LABEL[k] || k).join(", ")}`;
  };
  let previewTimer;
  const preview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => { setContent(clone(draft)); makeEditable(); }, 120); };

  async function save() {
    if (!dirty.size) return;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner"></span>Opslaan…`;
    try {
      for (const key of [...dirty]) {
        await api.saveContent(key, draft[key]);
        dirty.delete(key);
      }
      // foto's die nergens meer gebruikt worden uit de opslag verwijderen
      const now = storedUrls(draft);
      for (const u of new Set([...savedUrls, ...uploaded])) if (!now.has(u)) api.deleteImage(u).catch(() => {});
      savedUrls = now;
      uploaded.clear();
      saveBtn.textContent = "Opgeslagen ✓";
      saveBtn.title = "";
      toast("Wijzigingen opgeslagen en live op de website.", "ok");
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = `Opslaan (${dirty.size})`;
      toast(`Opslaan mislukt: ${errText(e)}`, "bad");
    }
  }
  saveBtn.addEventListener("click", save);
  addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } });
  addEventListener("beforeunload", e => { if (dirty.size) { e.preventDefault(); e.returnValue = ""; } });

  $("[data-logout]", bar).addEventListener("click", async () => {
    if (dirty.size && !(await ask("Je hebt nog niet-opgeslagen wijzigingen. Toch uitloggen?", { ok: "Uitloggen" }))) return;
    dirty.clear();
    await api.signOut();
    location.href = location.pathname;
  });

  $("[data-preview]", bar).addEventListener("click", e => {
    const on = document.body.classList.toggle("is-previewing");
    e.currentTarget.textContent = on ? "Verder bewerken" : "Bekijken";
    makeEditable();
  });

  // ---------- Teksten ----------
  const plainOnly = (() => { const d = document.createElement("div"); d.contentEditable = "plaintext-only"; return d.contentEditable === "plaintext-only"; })();
  function makeEditable() {
    const on = !document.body.classList.contains("is-previewing");
    $$("[data-edit]").forEach(el => {
      if (!on) { el.removeAttribute("contenteditable"); return; }
      el.contentEditable = plainOnly ? "plaintext-only" : "true";
      el.spellcheck = true;
      if (el.dataset.edWired) return;
      el.dataset.edWired = "1";
      // enters/inspringing uit de HTML-broncode niet als lege regels tonen tijdens het bewerken
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      for (const t of texts) {
        if (!t.textContent.trim() && /\n/.test(t.textContent)) t.remove();
        else t.textContent = t.textContent.replace(/\s*\n\s*/g, " ");
      }
      el.addEventListener("input", () => {
        draft.texts[el.dataset.edit] = sanitize(el.innerHTML);
        markDirty("texts");
      });
      el.addEventListener("paste", e => {
        e.preventDefault();
        document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
      });
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey && /^H\d|SMALL|STRONG$/.test(el.tagName)) e.preventDefault();
        if (e.key === "Escape") el.blur();
      });
      // links/knoppen rond een tekst niet laten openen tijdens het typen
      el.addEventListener("click", e => { if (!document.body.classList.contains("is-previewing")) e.preventDefault(); });
    });
  }
  makeEditable();

  // ---------- Foto's op de pagina ----------
  const picker = document.createElement("input");
  picker.type = "file"; picker.accept = "image/*"; picker.hidden = true;
  document.body.append(picker);
  const pickImage = () => new Promise(ok => {
    picker.value = "";
    picker.onchange = () => ok(picker.files[0] || null);
    picker.click();
  });
  async function uploadPicked() {
    const file = await pickImage();
    if (!file) return null;
    if (!file.type.startsWith("image/")) { toast("Kies een afbeelding (jpg, png, …).", "bad"); return null; }
    toast("Foto uploaden…");
    try {
      const blob = await compressImage(file);
      const url = await api.uploadImage(blob);
      uploaded.add(url);
      return url;
    } catch (e) { toast(`Upload mislukt: ${errText(e)}`, "bad"); return null; }
  }

  const photoBtn = document.createElement("button");
  photoBtn.type = "button"; photoBtn.className = "ed-photo";
  photoBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Foto wijzigen`;
  document.body.append(photoBtn);
  let photoTarget = null;
  const placePhotoBtn = img => {
    photoTarget = img;
    const r = img.getBoundingClientRect();
    photoBtn.style.top = `${Math.max(70, r.top + 14)}px`;
    photoBtn.style.left = `${Math.max(10, r.left + 14)}px`;
    photoBtn.classList.add("show");
  };
  let raf = 0;
  addEventListener("pointermove", e => {
    if (document.body.classList.contains("is-previewing") || $(".ed-panel.open")) return photoBtn.classList.remove("show");
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const img = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.matches?.("[data-img]"));
      if (img) placePhotoBtn(img);
      else if (!document.elementsFromPoint(e.clientX, e.clientY).includes(photoBtn)) photoBtn.classList.remove("show");
    });
  }, { passive: true });
  addEventListener("scroll", () => photoBtn.classList.remove("show"), { passive: true });
  photoBtn.addEventListener("click", async () => {
    const img = photoTarget;
    if (!img) return;
    const url = await uploadPicked();
    if (!url) return;
    draft.images[img.dataset.img] = url;
    img.src = url;
    markDirty("images");
    toast("Foto vervangen. Vergeet niet op te slaan.", "ok");
  });

  // galerij-foto's openen het galerijpaneel
  $("#gallery").addEventListener("click", e => {
    const it = e.target.closest(".gallery__item");
    if (it && !document.body.classList.contains("is-previewing")) openPanel("gallery", +it.dataset.i);
  });
  // prijslijst openen bij klik op de prijslijst
  $("#menu").addEventListener("click", () => { if (!document.body.classList.contains("is-previewing")) openPanel("services"); });

  // ---------- Paneel ----------
  const panel = document.createElement("aside");
  panel.className = "ed-panel";
  panel.setAttribute("role", "dialog");
  panel.innerHTML = `<div class="ed-panel__head"><h3></h3><button type="button" class="ed-x" data-close aria-label="Sluiten">✕</button></div>
    <div class="ed-panel__body"></div>
    <div class="ed-panel__foot"><button type="button" class="ed-btn ed-btn--ghost" data-close>Sluiten</button><button type="button" class="ed-btn ed-btn--gold" data-panel-save>Opslaan</button></div>`;
  document.body.append(panel);
  const pBody = $(".ed-panel__body", panel);
  let current = null;
  $$("[data-close]", panel).forEach(b => b.addEventListener("click", () => closePanel()));
  $("[data-panel-save]", panel).addEventListener("click", async () => { await save(); closePanel(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && panel.classList.contains("open")) closePanel(); });
  $$("[data-panel]", bar).forEach(b => b.addEventListener("click", () => openPanel(b.dataset.panel)));
  $("[data-help]", bar).addEventListener("click", () => openPanel("help"));

  function closePanel() { panel.classList.remove("open"); current = null; }
  function openPanel(name, focusIndex) {
    current = name;
    $("h3", panel).textContent = { services: "Prijzen & behandelingen", gallery: "Galerij", hours: "Openingsuren", locations: "Vestigingen", settings: "Instellingen", help: "Zo werkt de bewerkmodus" }[name];
    if (name === "locations") loadLogins();
    renderPanel(focusIndex);
    panel.classList.add("open");
    $("[data-panel-save]", panel).hidden = name === "help";
  }

  // waarde op pad zetten, bv. "services.0.items.2.price"
  const setPath = (obj, path, val) => {
    const ks = path.split(".");
    let o = obj;
    for (const k of ks.slice(0, -1)) o = o[k];
    o[ks.at(-1)] = val;
  };
  const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

  pBody.addEventListener("input", e => {
    const el = e.target.closest("[data-k]");
    if (!el) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.t === "num") v = Math.max(0, Number(String(v).replace(",", ".")) || 0);
    if (el.dataset.t === "int") v = Math.max(+el.min || 0, Math.round(Number(v) || 0));
    if (el.dataset.t === "time") { const [h, m] = String(v || "0:0").split(":").map(Number); v = h * 60 + m; }
    setPath(draft, el.dataset.k, v);
    markDirty(el.dataset.k.split(".")[0]);
    if (el.dataset.k.startsWith("hours.")) validateHours(el);
    preview();
  });

  pBody.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const [act, path, extra] = b.dataset.act.split("|");
    if (act === "addloc") return addLocation(b);
    if (act === "pw") return changePassword(+extra, b);
    if (act === "delloc") return deleteLocation(+extra, b);
    if (act === "adminpw") return changeAdminPassword(b);
    const list = path ? getPath(draft, path) : null;
    const i = +extra;
    if (act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (act === "del") {
      const what = path === "services" ? `de categorie "${list[i].label}" met al haar behandelingen` : "dit item";
      if (!(await ask(`Ben je zeker dat je ${what} wil verwijderen?`, { ok: "Verwijderen", danger: true }))) return;
      list.splice(i, 1);
    }
    if (act === "add-item") list.push({ id: uid("d-"), name: "Nieuwe behandeling", min: 30, price: 20, desc: "" });
    if (act === "add-cat") draft.services.push({ id: uid("c-"), label: "Nieuwe categorie", sub: "", icon: "✂️", items: [{ id: uid("d-"), name: "Nieuwe behandeling", min: 30, price: 20, desc: "" }] });
    if (act === "photo" || act === "add-photo") {
      const url = await uploadPicked();
      if (!url) return;
      if (act === "photo") draft.gallery[i].src = url;
      else draft.gallery.push({ src: url, label: "", cap: "", alt: "", size: "" });
    }
    if (act === "closed") {
      const [loc, d] = [path, extra];
      draft.hours[loc][d] = b.checked ? null : [9 * 60, 18 * 60];
    }
    markDirty(act === "closed" ? "hours" : act.includes("photo") ? "gallery" : path.split(".")[0]);
    renderPanel();
    preview();
  });

  function validateHours(el) {
    const [, loc, d] = el.dataset.k.split(".");
    const h = draft.hours[loc][d];
    const row = el.closest(".ed-hrow");
    row?.classList.toggle("is-bad", !!h && h[1] <= h[0]);
  }

  const numIn = (k, v, attrs = "") => `<input data-k="${k}" data-t="${attrs.includes("step=\"5\"") ? "int" : "num"}" type="number" inputmode="decimal" value="${v}" ${attrs}>`;
  const txtIn = (k, v, ph = "", max = 120) => `<input data-k="${k}" type="text" value="${esc(v || "")}" placeholder="${esc(ph)}" maxlength="${max}">`;
  const tools = (path, i, n) => `<div class="ed-tools">
      <button type="button" data-act="up|${path}|${i}" ${i === 0 ? "disabled" : ""} aria-label="Omhoog">↑</button>
      <button type="button" data-act="down|${path}|${i}" ${i === n - 1 ? "disabled" : ""} aria-label="Omlaag">↓</button>
      <button type="button" data-act="del|${path}|${i}" class="ed-del" aria-label="Verwijderen">🗑</button></div>`;

  function renderPanel(focusIndex) {
    let h = "";
    if (current === "services") {
      h = `<p class="ed-hint">Pas namen, duur en prijzen aan. De prijslijst op de site en de keuzes bij het boeken veranderen mee. De online toeslag stel je in bij <b>Instellingen</b>.</p>` +
        draft.services.map((c, ci) => `
        <section class="ed-card">
          <div class="ed-card__head">
            <div class="ed-grid ed-grid--cat">
              <label>Categorie${txtIn(`services.${ci}.label`, c.label, "bv. Heren", 40)}</label>
              <label>Extra info${txtIn(`services.${ci}.sub`, c.sub, "bv. onder 10 jaar", 40)}</label>
              <label>Icoon${txtIn(`services.${ci}.icon`, c.icon, "✂️", 4)}</label>
            </div>
            ${tools("services", ci, draft.services.length)}
          </div>
          ${c.items.map((it, ii) => `
          <div class="ed-item">
            <div class="ed-grid ed-grid--item">
              <label class="ed-span2">Behandeling${txtIn(`services.${ci}.items.${ii}.name`, it.name, "Naam", 60)}</label>
              <label>Minuten${numIn(`services.${ci}.items.${ii}.min`, it.min, 'min="5" max="480" step="5"')}</label>
              <label>Prijs (€)${numIn(`services.${ci}.items.${ii}.price`, it.price, 'min="0" max="9999" step="0.5"')}</label>
              <label class="ed-span3">Omschrijving${txtIn(`services.${ci}.items.${ii}.desc`, it.desc, "Korte uitleg (optioneel)", 160)}</label>
              <label class="ed-check"><input data-k="services.${ci}.items.${ii}.featured" type="checkbox" ${it.featured ? "checked" : ""}> Populair</label>
            </div>
            ${tools(`services.${ci}.items`, ii, c.items.length)}
          </div>`).join("")}
          <button type="button" class="ed-add" data-act="add-item|services.${ci}.items">+ Behandeling toevoegen</button>
        </section>`).join("") +
        `<button type="button" class="ed-add ed-add--big" data-act="add-cat|services">+ Categorie toevoegen</button>`;
    }
    if (current === "gallery") {
      h = `<p class="ed-hint">Klik op een foto om ze te vervangen. "Hoog" en "breed" bepalen hoe groot ze in de galerij staan.</p>` +
        draft.gallery.map((g, i) => `
        <div class="ed-gal${i === focusIndex ? " is-focus" : ""}">
          <button type="button" class="ed-thumb" data-act="photo||${i}" title="Foto vervangen"><img src="${esc(g.src)}" alt=""><span>Vervang</span></button>
          <div class="ed-grid">
            <label>Titel op de foto${txtIn(`gallery.${i}.label`, g.label, "bv. Skin fade", 40)}</label>
            <label>Onderschrift (groot)${txtIn(`gallery.${i}.cap`, g.cap, "bv. Skin fade met lijn", 80)}</label>
            <label>Formaat<select data-k="gallery.${i}.size">
              <option value="" ${!g.size ? "selected" : ""}>Normaal</option>
              <option value="tall" ${g.size === "tall" ? "selected" : ""}>Hoog</option>
              <option value="wide" ${g.size === "wide" ? "selected" : ""}>Breed</option></select></label>
          </div>
          ${tools("gallery", i, draft.gallery.length)}
        </div>`).join("") +
        `<button type="button" class="ed-add ed-add--big" data-act="add-photo|gallery">+ Foto toevoegen</button>`;
    }
    if (current === "hours") {
      h = `<p class="ed-hint">Deze uren gelden voor de website én voor de tijdsloten bij het boeken. Een vrije dag of vakantie blokkeer je in de agenda van de vestiging.</p>` +
        draft.locations.map(l => `
        <section class="ed-card"><h4>${esc(l.name)}</h4>
          ${[1, 2, 3, 4, 5, 6, 0].map(d => {
            const hr = draft.hours[l.id]?.[d] ?? null;
            return `<div class="ed-hrow${hr && hr[1] <= hr[0] ? " is-bad" : ""}">
              <span>${DAY_NAMES[d]}</span>
              <label class="ed-check"><input type="checkbox" data-act="closed|${l.id}|${d}" ${hr ? "" : "checked"}> Gesloten</label>
              ${hr ? `<input type="time" step="900" data-k="hours.${l.id}.${d}.0" data-t="time" value="${fmt(hr[0])}"><span>tot</span><input type="time" step="900" data-k="hours.${l.id}.${d}.1" data-t="time" value="${fmt(hr[1])}">` : ""}
            </div>`;
          }).join("")}
        </section>`).join("");
    }
    if (current === "settings") {
      h = `<section class="ed-card"><h4>Online boeken</h4>
          <div class="ed-grid">
            <label>Online toeslag (€)${numIn("settings.online_fee", draft.settings.online_fee ?? 0, 'min="0" max="50" step="0.5"')}</label>
            <label>Tijdsloten om de<select data-k="settings.slot_min" data-t="int">
              ${[15, 20, 30, 45, 60].map(m => `<option value="${m}" ${+draft.settings.slot_min === m ? "selected" : ""}>${m} minuten</option>`).join("")}</select></label>
            <label>Minstens vooraf boeken<select data-k="settings.min_notice" data-t="int">
              ${[0, 15, 30, 60, 120, 240, 720, 1440].map(m => `<option value="${m}" ${+(draft.settings.min_notice ?? 30) === m ? "selected" : ""}>${m === 0 ? "geen minimum" : m < 60 ? `${m} minuten` : m < 1440 ? `${m / 60} uur` : "1 dag"}</option>`).join("")}</select></label>
            <label>Hoeveel dagen vooruit boeken<select data-k="settings.max_days" data-t="int">
              ${[7, 14, 21, 30, 60].map(m => `<option value="${m}" ${+draft.settings.max_days === m ? "selected" : ""}>${m} dagen</option>`).join("")}</select></label>
          </div></section>
        <section class="ed-card"><h4>Jouw admin-wachtwoord</h4>
          <p class="ed-hint">Het wachtwoord waarmee je inlogt als <b>admin</b>. Minstens 8 tekens.</p>
          <div class="ed-grid">
            <label>Nieuw wachtwoord<input type="password" id="apw1" maxlength="72" autocomplete="new-password"></label>
            <label>Herhaal wachtwoord<input type="password" id="apw2" maxlength="72" autocomplete="new-password"></label>
          </div>
          <button type="button" class="ed-btn ed-btn--ghost ed-wide" data-act="adminpw">Wachtwoord wijzigen</button>
          <p class="book__err" id="apwErr" role="alert"></p>
        </section>
`;
    }
    if (current === "locations") {
      const first = draft.locations[0];
      h = `<p class="ed-hint">Elke vestiging verschijnt op de website, kan online geboekt worden en heeft een <b>eigen agenda met een eigen login</b>. Openingsuren stel je in bij <b>Openingsuren</b>.</p>` +
        draft.locations.map((l, i) => `
        <section class="ed-card">
          <h4>${esc(l.name)}</h4>
          <div class="ed-grid">
            <label>Naam${txtIn(`locations.${i}.name`, l.name, "bv. Leuven", 40)}</label>
            <label>Telefoon${txtIn(`locations.${i}.phone`, l.phone, "04xx xx xx xx", 20)}</label>
            <label class="ed-full">Adres${txtIn(`locations.${i}.address`, l.address, "Straat 1, 3000 Gemeente", 120)}</label>
            <label class="ed-full">Google Maps-link <small>(optioneel)</small>${txtIn(`locations.${i}.maps`, l.maps, "https://maps.app.goo.gl/…", 300)}</label>
            <label>Klanten tegelijk<select data-k="locations.${i}.chairs" data-t="int">
              ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${+(l.chairs || 1) === n ? "selected" : ""}>${n} tegelijk</option>`).join("")}</select></label>
          </div>
          <div class="ed-login">
            <p>Agenda-login: ${loginName(l) ? `<b>${esc(loginName(l))}</b>` : logins ? `<span class="t-no">geen login</span>` : "…"}</p>
            ${loginName(l) ? `<div class="ed-inline">
              <input type="password" data-pw="${i}" placeholder="Nieuw wachtwoord (min. 8 tekens)" autocomplete="new-password">
              <button type="button" class="ed-btn ed-btn--ghost" data-act="pw||${i}">Wachtwoord wijzigen</button></div>` : ""}
          </div>
          ${draft.locations.length > 1 ? `<button type="button" class="ed-add ed-add--danger" data-act="delloc||${i}">Vestiging verwijderen</button>` : ""}
        </section>`).join("") + `
        <section class="ed-card ed-card--new">
          <h4>+ Nieuwe vestiging</h4>
          <div class="ed-grid">
            <label>Naam<input type="text" id="nlName" maxlength="40" placeholder="bv. Leuven"></label>
            <label>Telefoon<input type="text" id="nlPhone" maxlength="20" placeholder="04xx xx xx xx"></label>
            <label class="ed-full">Adres<input type="text" id="nlAddress" maxlength="120" placeholder="Straat 1, 3000 Gemeente"></label>
            <label class="ed-full">Google Maps-link <small>(optioneel)</small><input type="text" id="nlMaps" maxlength="300" placeholder="https://maps.app.goo.gl/…"></label>
            <label>Gebruikersnaam agenda<input type="text" id="nlUser" maxlength="30" autocapitalize="none" spellcheck="false" placeholder="bv. leuven"></label>
            <label>Wachtwoord<input type="password" id="nlPw" maxlength="72" autocomplete="new-password" placeholder="min. 8 tekens"></label>
            <label>Herhaal wachtwoord<input type="password" id="nlPw2" maxlength="72" autocomplete="new-password"></label>
          </div>
          <p class="ed-hint" style="margin:12px 0 0">Start met dezelfde openingsuren als ${esc(first?.name || "de eerste vestiging")}. Daarna aan te passen bij <b>Openingsuren</b>.</p>
          <button type="button" class="ed-btn ed-btn--gold ed-wide" data-act="addloc">Vestiging aanmaken</button>
          <p class="book__err" id="nlErr" role="alert"></p>
        </section>`;
    }
    if (current === "help") {
      h = `<ol class="ed-help">
        <li><b>Tekst aanpassen:</b> klik op een tekst op de pagina en typ. Shift + Enter = nieuwe regel.</li>
        <li><b>Foto vervangen:</b> ga met je muis over een foto en klik op <em>Foto wijzigen</em>. Op je gsm: tik op de foto.</li>
        <li><b>Prijzen:</b> knop <em>Prijzen</em>, of klik op de prijslijst.</li>
        <li><b>Galerij:</b> knop <em>Galerij</em> of klik op een foto in de galerij. Foto's toevoegen, verwijderen en verschuiven kan daar.</li>
        <li><b>Openingsuren:</b> gelden meteen ook voor de tijdsloten bij het boeken.</li>
        <li><b>Opslaan:</b> niets is live tot je op <em>Opslaan</em> klikt (of Ctrl + S).</li>
        <li><b>Afspraken</b> beheer je niet hier, maar met de login van de vestiging (Haacht of Wilsele).</li></ol>`;
    }
    pBody.innerHTML = h;
    // gebruikersnaam automatisch invullen op basis van de naam
    const nn = $("#nlName", pBody), nu = $("#nlUser", pBody);
    if (nn && nu) {
      nn.addEventListener("input", () => { if (!nu.dataset.touched) nu.value = slug(nn.value); });
      nu.addEventListener("input", () => { nu.dataset.touched = "1"; });
    }
    if (focusIndex != null) $(".is-focus", pBody)?.scrollIntoView({ block: "center" });
  }

  // ---------- Vestigingen ----------
  let logins = null; // { vestiging-id: gebruikersnaam }
  const loginName = l => logins ? logins[l.id] : (l.login || null);
  const slug = v => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  const normPhone = v => {
    const d = String(v || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("0") && d.length === 10) return `+32${d.slice(1)}`;
    if (d.startsWith("32")) return `+${d}`;
    return String(v).trim();
  };
  async function loadLogins() {
    try {
      const { logins: list } = await api.manageLocation("list");
      logins = Object.fromEntries((list || []).map(x => [x.loc, x.username]));
    } catch { logins = null; }
    if (current === "locations") renderPanel();
  }
  const busy = (b, on, label) => {
    b.disabled = on;
    if (on) { b.dataset.label = b.textContent; b.innerHTML = `<span class="spinner"></span>${label}`; } else b.textContent = b.dataset.label;
  };

  async function addLocation(btn) {
    const err = $("#nlErr", pBody);
    const name = $("#nlName", pBody).value.trim(), address = $("#nlAddress", pBody).value.trim();
    const phone = normPhone($("#nlPhone", pBody).value), maps = $("#nlMaps", pBody).value.trim();
    const username = $("#nlUser", pBody).value.trim().toLowerCase();
    const pw = $("#nlPw", pBody).value, pw2 = $("#nlPw2", pBody).value;
    err.textContent = "";
    if (name.length < 2) return (err.textContent = "Vul de naam van de vestiging in.");
    if (address.length < 5) return (err.textContent = "Vul het adres in (straat en gemeente).");
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || username === "admin") return (err.textContent = errText("ongeldige_gebruikersnaam"));
    if (pw.length < 8) return (err.textContent = errText("wachtwoord_te_kort"));
    if (pw !== pw2) return (err.textContent = "De wachtwoorden zijn niet gelijk.");
    let id = slug(name) || "vestiging";
    if (id === "admin") id = "vestiging-admin";
    for (let n = 2; draft.locations.some(l => l.id === id); n++) id = `${slug(name)}-${n}`;

    busy(btn, true, "Aanmaken…");
    try {
      await api.manageLocation("create", { loc: id, username, password: pw });
    } catch (e) { busy(btn, false); return (err.textContent = errText(e)); }
    const first = draft.locations[0];
    draft.locations.push({ id, name, address, phone, maps, chairs: 1, login: username });
    draft.hours[id] = clone(draft.hours[first?.id] || { 0: null, 1: [540, 1080], 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080], 6: [540, 1080] });
    if (logins) logins[id] = username;
    markDirty("locations"); markDirty("hours");
    await save();
    preview();
    renderPanel();
    toast(`Vestiging ${name} staat online. Agenda-login: ${username}`, "ok");
  }

  async function changePassword(i, btn) {
    const l = draft.locations[i], input = $(`[data-pw="${i}"]`, pBody);
    if ((input.value || "").length < 8) return toast(errText("wachtwoord_te_kort"), "bad");
    busy(btn, true, "Wijzigen…");
    try {
      await api.manageLocation("password", { loc: l.id, password: input.value });
      input.value = "";
      toast(`Wachtwoord van ${l.name} gewijzigd.`, "ok");
    } catch (e) { toast(errText(e), "bad"); }
    busy(btn, false);
  }

  async function changeAdminPassword(btn) {
    const a = $("#apw1", pBody), b2 = $("#apw2", pBody), err = $("#apwErr", pBody);
    err.textContent = "";
    if (a.value.length < 8) return (err.textContent = errText("wachtwoord_te_kort"));
    if (a.value !== b2.value) return (err.textContent = "De wachtwoorden zijn niet gelijk.");
    busy(btn, true, "Wijzigen…");
    try {
      await api.changeOwnPassword(a.value);
      a.value = b2.value = "";
      toast("Je admin-wachtwoord is gewijzigd.", "ok");
    } catch (e) { err.textContent = errText(e); }
    busy(btn, false);
  }

  async function deleteLocation(i, btn) {
    const l = draft.locations[i];
    if (!(await ask(`Vestiging ${l.name} verwijderen? Ze verdwijnt van de website en de agenda-login wordt verwijderd.`, { ok: "Verwijderen", danger: true }))) return;
    busy(btn, true, "Verwijderen…");
    try {
      try { await api.manageLocation("delete", { loc: l.id }); }
      catch (e) {
        if (e.message !== "heeft_afspraken") throw e;
        if (!(await ask(`Er staan nog ${e.count} komende afspraken bij ${l.name}. Toch verwijderen? Bel die klanten dan zelf even op.`, { ok: "Toch verwijderen", danger: true }))) { busy(btn, false); return; }
        await api.manageLocation("delete", { loc: l.id, force: true });
      }
    } catch (e) { busy(btn, false); return toast(errText(e), "bad"); }
    draft.locations.splice(i, 1);
    delete draft.hours[l.id];
    if (logins) delete logins[l.id];
    markDirty("locations"); markDirty("hours");
    await save();
    preview();
    renderPanel();
    toast(`Vestiging ${l.name} verwijderd.`, "ok");
  }

  // gsm: tik op foto → knop tonen
  addEventListener("click", e => {
    if (document.body.classList.contains("is-previewing")) return;
    const img = e.target.closest?.("[data-img]");
    if (img) placePhotoBtn(img);
  }, true);

  // kleine uitleg bij de eerste keer
  try {
    if (!localStorage.getItem("ed-help-seen")) { openPanel("help"); localStorage.setItem("ed-help-seen", "1"); }
  } catch {}
}
