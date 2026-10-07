import { $, errText } from "./core.js?v=202610071502";
import { api, MODE } from "./api.js?v=202610071502";

const go = me => { location.href = me.role === "admin" ? "index.html" : "beheer.html"; };

if (MODE === "demo") {
  const n = $("#demoNote");
  n.hidden = false;
  n.textContent = "Demo-modus (nog niet gekoppeld aan de database): log in met admin, haacht of wilsele en wachtwoord demo.";
}
if (MODE === "off") {
  $("#loginErr").textContent = "Inloggen is nog niet geactiveerd voor deze website.";
  $("#loginBtn").disabled = true;
}

api.session().then(me => { if (me) go(me); }).catch(() => {});

$("#pwToggle").addEventListener("click", e => {
  const p = $("#pass"), show = p.type === "password";
  p.type = show ? "text" : "password";
  e.currentTarget.textContent = show ? "Verberg" : "Toon";
});

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const user = $("#user").value.trim(), pass = $("#pass").value;
  const err = $("#loginErr"), btn = $("#loginBtn");
  err.textContent = "";
  if (!user || !pass) return (err.textContent = "Vul je gebruikersnaam en wachtwoord in.");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Inloggen…`;
  try {
    go(await api.signIn(user, pass));
  } catch (ex) {
    err.textContent = errText(ex);
    btn.disabled = false;
    btn.textContent = "Inloggen";
    $("#pass").select();
  }
});
