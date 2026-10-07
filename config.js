// Koppeling met de database (Supabase). Zie SETUP.md.
// Zolang supabaseUrl leeg is:
//   - op localhost → demo-modus (alles wordt in je eigen browser bewaard, om te testen)
//   - online       → boekingen gaan via WhatsApp en inloggen is uitgeschakeld
window.SITE_CONFIG = {
  site: "classic",                 // code van deze zaak in de database
  supabaseUrl: "",                 // bv. "https://abcdefgh.supabase.co"
  supabaseKey: "",                 // de "anon public" / "publishable" key (mag openbaar zijn)
  loginDomain: "classicbarbershop.be", // gebruikersnaam "haacht" → haacht@classicbarbershop.be
};
