# Classic Barbershop — website met afsprakensysteem

Website voor Classic Barbershop (Haacht + Wilsele) in de stijl van Sam Barbershop, met een eigen beheer achter een login.

## Onderdelen
| Pagina | Voor wie | Wat |
|---|---|---|
| `index.html` | bezoekers | site + online boeken in stappen (vestiging → categorie → dienst → gegevens → datum & tijd → overzicht) |
| `index.html` als **admin** | eigenaar | bewerkmodus: teksten aanklikken en typen, foto's vervangen, prijzen, galerij, openingsuren, instellingen |
| `beheer.html` als **haacht** / **wilsele** | vestiging | agenda per dag/week, komende afspraken, klantenlijst (+ CSV), afspraken inplannen, verplaatsen, annuleren, tijd blokkeren, live meldingen |
| `login.html` | iedereen met een account | knop **Inloggen** linksonder in de footer |

Bezette tijdsloten verdwijnen meteen van de website; de database weigert dubbele boekingen.

## Bestanden
- `config.js` — koppeling met de database (zie **SETUP.md**)
- `js/defaults.js` — standaardinhoud (prijzen, uren, galerij)
- `js/site.js` · `js/edit.js` · `js/beheer.js` · `js/login.js` · `js/api.js` · `js/core.js`
- `styles.css` (Sam-stijl) · `admin.css` (login, bewerkmodus, agenda)
- `supabase/schema.sql` · `supabase/seed.sql` · `supabase/make-seed.mjs`

## Inhoud (bron: eigen site van de eigenaar, Google Maps, Instagram)
- **Haacht**: Vekestraat 1, 3150 Haacht · 0470 51 39 16 · di–vr 9–19, za–ma 9–18 · 4,8★ (252)
- **Wilsele**: Aarschotsesteenweg 664, 3012 Wilsele · 0492 86 04 37 · ma–vr 10–19, za–zo 10–18 · 4,9★ (57)
- Prijslijst Heren / Kinderen onder 10 jaar / Dames · met én zonder afspraak welkom
- Domein: classic-barbershop.be · Instagram & TikTok @classicbarbershop.be · Facebook https://www.facebook.com/profile.php?id=61591203627605

## Foto's
Alleen foto's die aantoonbaar van Classic Barbershop zijn: posts van hun eigen Instagram (Haacht en Wilsele) of foto's met hun logo, gevel of uithangbord. De eigenaar kan ze zelf vervangen in de bewerkmodus.

## Lokaal testen
Start een server in de map erboven en open `http://localhost:…/classic barbershop v2/`. Zonder `config.js` draait een demo in je browser: log in met `admin`, `haacht` of `wilsele` en wachtwoord `demo`.
