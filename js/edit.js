// Bewerkmodus voor de eigenaar (rol: admin). Wordt alleen geladen na inloggen.
import { $, $$, esc, fmt, clone, uid, sanitize, compressImage, toast, errText, DAY_NAMES } from "./core.js";
import { api } from "./api.js";

const KEY_LABEL = { texts: "teksten", images: "foto's", services: "prijzen", gallery: "galerij", hours: "openingsuren", settings: "instellingen", locations: "vestigingen" };

export function startEditor({ getContent, setContent }) {
  const draft = clone(getContent());
  const dirty = new Set();

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
    if (dirty.size && !confirm("Je hebt nog niet-opgeslagen wijzigingen. Toch uitloggen?")) return;
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
      return await api.uploadImage(blob);
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
    $("h3", panel).textContent = { services: "Prijzen & behandelingen", gallery: "Galerij", hours: "Openingsuren", settings: "Instellingen", help: "Zo werkt de bewerkmodus" }[name];
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
    const list = path ? getPath(draft, path) : null;
    const i = +extra;
    if (act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (act === "del") {
      const what = path === "services" ? `de categorie "${list[i].label}" met al haar behandelingen` : "dit item";
      if (!confirm(`Ben je zeker dat je ${what} wil verwijderen?`)) return;
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
            <label>Hoeveel dagen vooruit boeken<select data-k="settings.max_days" data-t="int">
              ${[7, 14, 21, 30, 60].map(m => `<option value="${m}" ${+draft.settings.max_days === m ? "selected" : ""}>${m} dagen</option>`).join("")}</select></label>
          </div></section>
        <section class="ed-card"><h4>Klanten tegelijk per vestiging</h4>
          <p class="ed-hint">Aantal stoelen/kappers dat tegelijk kan knippen. Bij 1 is elk tijdslot weg zodra iemand boekt.</p>
          <div class="ed-grid">${draft.locations.map((l, i) => `<label>${esc(l.name)}<select data-k="locations.${i}.chairs" data-t="int">
              ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${+(l.chairs || 1) === n ? "selected" : ""}>${n} tegelijk</option>`).join("")}</select></label>`).join("")}</div>
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
    if (focusIndex != null) $(".is-focus", pBody)?.scrollIntoView({ block: "center" });
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
