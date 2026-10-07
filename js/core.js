// Gedeelde hulpjes voor de site, de bewerkmodus en het beheer.
export const TZ = "Europe/Brussels";
export const DAY_NAMES = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
export const DAY_SHORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];
export const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export const MONTHS_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const pad = n => String(n).padStart(2, "0");
export const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const euro = n => `€${Number(n).toLocaleString("nl-BE", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clone = v => JSON.parse(JSON.stringify(v));
export const uid = (p = "") => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

// ---------- Tijd in Brussel ----------
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
function zoneParts(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
// minuten dat Brussel voor ligt op UTC op dat moment
function offsetAt(ms) {
  const p = zoneParts(ms);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms) / 60000);
}

/** "2026-10-08" + 840 min (14:00 in Brussel) → Date (juist ogenblik, ook rond zomeruur) */
export function brusselsToDate(iso, minutes = 0) {
  const [y, mo, d] = iso.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  let ms = guess - offsetAt(guess) * 60000;
  const off2 = offsetAt(ms);
  ms = guess - off2 * 60000;
  return new Date(ms);
}

/** Date → { iso: "YYYY-MM-DD", minutes, dow } in Brussel */
export function inBrussels(date) {
  const p = zoneParts(+new Date(date));
  const iso = `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  return { iso, minutes: p.h * 60 + p.mi, dow: new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() };
}

export const todayISO = () => inBrussels(new Date()).iso;
export function brusselsNow() {
  const b = inBrussels(new Date());
  return { ...b, date: isoToLocalDate(b.iso) };
}
export const isoToLocalDate = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const dowOf = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export function dayLabel(iso, long = false) {
  const [, m, d] = iso.split("-").map(Number);
  return `${DAY_NAMES[dowOf(iso)].toLowerCase()} ${d} ${(long ? MONTHS_LONG : MONTHS)[m - 1]}`;
}

// ---------- Openingsuren ----------
export const hoursFor = (hours, loc, dow) => {
  const h = hours?.[loc]?.[dow] ?? hours?.[loc]?.[String(dow)];
  return Array.isArray(h) ? h : null;
};

/** Is [start, end) vrij gegeven bezette blokken en het aantal stoelen? (zelfde regel als de database) */
export function isFree(busy, startMs, endMs, chairs = 1) {
  let n = 0;
  for (const b of busy) {
    const s = +new Date(b.starts_at), e = +new Date(b.ends_at);
    if (s < endMs && e > startMs) {
      if (b.blocked) return false;
      n++;
    }
  }
  return n < Math.max(1, chairs || 1);
}

// ---------- Veilige HTML voor bewerkbare teksten ----------
const ALLOWED = new Set(["EM", "STRONG", "B", "I", "BR", "SPAN"]);
const ALLOWED_CLASSES = new Set(["gold-text", "script"]);
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = node => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) continue;
      if (ch.nodeType !== 1) { ch.remove(); continue; }
      walk(ch);
      if (ch.tagName === "DIV" || ch.tagName === "P") {
        // nieuwe regel uit contenteditable → <br>
        const frag = document.createDocumentFragment();
        if (ch.previousSibling) frag.append(document.createElement("br"));
        frag.append(...ch.childNodes);
        ch.replaceWith(frag);
        continue;
      }
      if (!ALLOWED.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); continue; }
      const cls = [...ch.classList].filter(c => ALLOWED_CLASSES.has(c)).join(" ");
      for (const a of [...ch.attributes]) ch.removeAttribute(a.name);
      if (cls) ch.className = cls;
    }
  };
  const root = doc.body.firstChild;
  walk(root);
  return root.innerHTML.replace(/(<br>)+$/, "").trim();
}

// ---------- Foto verkleinen voor upload ----------
export async function compressImage(file, max = 1800, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(ok => c.toBlob(ok, "image/jpeg", quality));
  } finally { URL.revokeObjectURL(url); }
}

// ---------- Melding onderaan ----------
export function toast(msg, kind = "") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.append(box); }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.classList.add("out"), 3800);
  setTimeout(() => t.remove(), 4300);
}

// Foutcodes uit de database → nette tekst
export const ERRORS = {
  bezet: "Dit tijdstip is net door iemand anders geboekt. Kies een ander moment.",
  overlap: "Er staat op dit moment al een afspraak of blokkering.",
  tijd_voorbij: "Dit tijdstip is al voorbij. Kies een later moment.",
  te_ver_vooruit: "Zo ver vooruit kan je nog niet boeken.",
  gesloten: "De zaak is op die dag gesloten.",
  ongeldig_tijdslot: "Dit tijdstip valt buiten de openingsuren.",
  ongeldige_naam: "Vul een geldige naam in.",
  ongeldig_telefoonnummer: "Vul een geldig telefoonnummer in.",
  ongeldig_email: "Vul een geldig e-mailadres in.",
  notitie_te_lang: "Je opmerking is te lang (max. 300 tekens).",
  onbekende_dienst: "Deze dienst bestaat niet meer. Kies opnieuw.",
  ongeldige_vestiging: "Onbekende vestiging.",
  te_veel_afspraken: "Je hebt al 3 openstaande afspraken. Bel de zaak om nog een afspraak te maken.",
  geen_toegang: "Je hebt geen toegang tot deze actie.",
  login: "Gebruikersnaam of wachtwoord klopt niet.",
  offline: "Geen verbinding. Probeer het opnieuw.",
  ongeldige_gebruikersnaam: "Gebruikersnaam: minstens 3 tekens, alleen kleine letters, cijfers, punt of streepje.",
  gebruikersnaam_bezet: "Deze gebruikersnaam bestaat al. Kies een andere.",
  wachtwoord_te_kort: "Het wachtwoord moet minstens 8 tekens hebben.",
  login_bestaat: "Deze vestiging heeft al een login.",
  geen_login: "Deze vestiging heeft nog geen login.",
  heeft_afspraken: "Deze vestiging heeft nog komende afspraken.",
  niet_ingelogd: "Je sessie is verlopen. Log opnieuw in.",
};
export const errText = e => {
  const msg = String(e?.message || e).trim();
  if (ERRORS[msg]) return ERRORS[msg];
  const code = Object.keys(ERRORS).sort((a, b) => b.length - a.length).find(k => msg.includes(k));
  return code ? ERRORS[code] : "Er ging iets mis. Probeer het opnieuw of bel de zaak.";
};
