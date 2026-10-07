// Koppeling met de database (Supabase). Zie SETUP.md.
// Zolang supabaseUrl leeg is:
//   - op localhost → demo-modus (alles wordt in je eigen browser bewaard, om te testen)
//   - online       → boekingen gaan via WhatsApp en inloggen is uitgeschakeld
window.SITE_CONFIG = {
  site: "classic",                 // code van deze zaak in de database
  supabaseUrl: "https://ftdtddikpzawryplqpbc.supabase.co",
  supabaseKey: "sb_publishable_sdnSjRm4yaKogQ0EHs_x6A_-HmZ-_39", // publishable key: mag openbaar zijn
  loginDomain: "classicbarbershop.be", // gebruikersnaam "haacht" → haacht@classicbarbershop.be
};
