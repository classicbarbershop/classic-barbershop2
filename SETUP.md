# Backend koppelen (Supabase): eenmalig ±10 minuten

De site werkt op GitHub Pages; de database, logins en foto-opslag draaien op **Supabase** (gratis plan).
Eén Supabase-project kan meerdere zaken bedienen: elke zaak heeft een eigen `site`-code (hier `classic`).

## 1. Project aanmaken
1. Maak een account op https://supabase.com (gratis).
2. **New project** → naam bv. `salons`, regio **Frankfurt (eu-central-1)** (EU, voor de GDPR), kies een sterk databasewachtwoord en bewaar het.

## 2. Database klaarzetten
1. Open **SQL Editor** → **New query** → plak de inhoud van `supabase/schema.sql` → **Run**.
2. Nieuwe query → plak `supabase/seed.sql` → **Run** (startinhoud: prijzen, uren, galerij).

## 3. Inloggen beveiligen
1. **Authentication → Sign In / Providers → Email**: zet **"Allow new users to sign up" UIT**. Alleen jij maakt accounts aan.
2. **Authentication → Users → Add user → Create new user**, telkens met **Auto Confirm User** aangevinkt:

   | Gebruikersnaam op de site | E-mail in Supabase | Rechten |
   |---|---|---|
   | `admin` | `admin@classicbarbershop.be` | website bewerken |
   | `haacht` | `haacht@classicbarbershop.be` | agenda Haacht |
   | `wilsele` | `wilsele@classicbarbershop.be` | agenda Wilsele |

   Kies sterke wachtwoorden (min. 12 tekens) en geef ze persoonlijk aan de eigenaar.
   Er wordt geen mail verstuurd; het e-mailadres is alleen de inlognaam.
3. SQL Editor → koppel de rollen:

   ```sql
   insert into public.staff (user_id, site, role)
   select id, 'classic', split_part(email, '@', 1) from auth.users
   where email in ('admin@classicbarbershop.be', 'haacht@classicbarbershop.be', 'wilsele@classicbarbershop.be')
   on conflict (user_id) do update set site = excluded.site, role = excluded.role;
   ```

## 4. Site koppelen
1. **Project Settings → API**: kopieer de **Project URL** en de **anon / publishable key**.
2. Zet ze in `config.js` (`supabaseUrl`, `supabaseKey`). Deze key mag openbaar zijn; de beveiliging zit in de database.
3. Push naar GitHub. Klaar.

## Wat is beveiligd (getest)
- Bezoekers kunnen alleen vrije/bezette **tijden** zien, nooit namen of nummers.
- Boeken gaat via één databasefunctie die prijs, duur, openingsuren en vrije plaats zelf controleert, met een slot zodat twee mensen nooit hetzelfde tijdslot krijgen.
- Max. 3 openstaande afspraken per telefoonnummer (tegen spam).
- `haacht` ziet alleen Haacht, `wilsele` alleen Wilsele; `admin` bewerkt alleen de website.
- Foto's uploaden kan alleen `admin`, en alleen in de eigen map.

## Nog een zaak toevoegen (latere klanten)
Zelfde project gebruiken: nieuwe `site`-code in `config.js` van die site, `node supabase/make-seed.mjs <code> > seed.sql`, uitvoeren, gebruikers aanmaken en in `staff` koppelen met die code.

## Goed om te weten
- Het gratis plan pauzeert een project na 7 dagen **zonder enig gebruik**. Bij een site met bezoekers gebeurt dat niet.
- Zonder koppeling (lege `config.js`) gaat boeken online via WhatsApp en is inloggen uit. Op `localhost` draait dan een demo (wachtwoord `demo`).
