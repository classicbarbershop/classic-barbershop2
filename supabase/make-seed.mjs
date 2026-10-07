// Maakt seed.sql uit js/defaults.js, zodat de database met dezelfde inhoud start als de site.
// Gebruik:  node supabase/make-seed.mjs classic > supabase/seed.sql
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = process.argv[2] || "classic";
const src = readFileSync(fileURLToPath(new URL("../js/defaults.js", import.meta.url)), "utf8");
const { DEFAULTS } = await import("data:text/javascript," + encodeURIComponent(src));

const lit = v => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const keys = ["locations", "hours", "settings", "services", "gallery", "texts", "images"];
console.log(`-- Startinhoud voor site '${site}' (gegenereerd uit js/defaults.js). Overschrijft niets dat al bestaat.`);
console.log("insert into public.site_content (site, key, value) values");
console.log(keys.map(k => `  ('${site}', '${k}', ${lit(DEFAULTS[k])})`).join(",\n"));
console.log("on conflict (site, key) do nothing;");
