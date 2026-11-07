# Karel & Sofie agenda

De gedeelde agenda van Karel en Sofie, als web-app met eigen icoon en pushmeldingen.

- **Samen** (oranje): moet eerst door de ander worden goedgekeurd.
- **Karel** (blauw) en **Sofie** (roze): komen meteen in de agenda.
- Feestdagen staan er klein bij.

## Hoe het werkt
- `index.html`, `styles.css`, `app.js`: de app, gehost op GitHub Pages.
- `sw.js`: service worker voor pushmeldingen en offline openen.
- Supabase-project `karel-sofie-agenda`: login, opslag en de functies `account` (wachtwoord aanmaken) en `notify` (pushmeldingen).

Alleen de e-mailadressen in de tabel `members` kunnen inloggen.
