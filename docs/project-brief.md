# Claude Code-prompt: Spire.no

Kopier alt under den stiplede linjen inn i Claude Code som ditt første prompt (i et tomt prosjekt-repo).

---

## Prosjekt: Spire.no

Jeg bygger en portefølje-nettside kalt **Spire.no** for å lære backend-utvikling i dybden. Jeg vil at du forklarer *hva* du gjør og *hvorfor* underveis — ikke bare generer kode i stillhet. Anta at jeg er nybegynner/underveis i backend-studier, så forklar arkitekturvalg, tradeoffs og fagbegreper når de dukker opp.

### Konsept

Spire.no er et redaksjonelt nettsted for foreldre, med et layout inspirert av vg.no (forsideoppsett med saksbokser, kategorier, fremhevede saker), men med egen fargeprofil. Innholdet er artikler om alt fra tips og gaveforslag til barn, til en "positiv seksjon" med erfaringer fra barnehageansatte og vanlige foreldre om hva som var uventet ved å bli forelder.

Hver artikkel er merket med en aldersgruppe, som styrer fargekoding i UI:

- 1–3 år
- 3–6 år
- Skolebarn

Nettstedet har en gratis del og en abonnementsdel (noen artikler er låst bak abonnement), samt et system for å delta i trekninger om premier (gavekort til reiser, Dyreparken, dagligvarebutikk, hoppepark osv.).

### Tech stack

- **Backend:** Node.js med Express (eller NestJS hvis du mener det passer bedre for strukturen — begrunn valget)
- **Database:** PostgreSQL
- **ORM:** Prisma eller Sequelize (foreslå og begrunn)
- **Frontend:** Fullstack-app — enkel React/Next.js-frontend som konsumerer API-et og viser layout/fargekoding. Fokuset er backend, så hold frontend funksjonell og ryddig, ikke pikselperfekt.
- **Betaling:** Stripe i **test mode** (mock/simulert — ingen ekte transaksjoner). Bygg webhook-håndtering ordentlig selv om det er test mode.
- **Containerisering:** Docker + docker-compose for lokal utvikling (app + Postgres + Redis)
- **Caching:** Redis for populære/mest-leste artikler
- **Filopplasting:** Bildeopplasting for artikkel-illustrasjoner (S3-kompatibelt, bruk MinIO lokalt i docker-compose)

### Kjernefunksjonalitet

1. **Autentisering & roller (RBAC)**
   - Roller: gjest (uinnlogget), gratis-bruker, abonnent, redaktør, admin
   - JWT-basert auth, passordhashing (bcrypt/argon2)
   - Redaktør kan opprette/redigere artikler, admin har full tilgang inkl. brukerhåndtering og trekninger

2. **Artikler**
   - CRUD for artikler (tittel, ingress, brødtekst, bilde, kategori, aldersgruppe-tag, "kun for abonnenter"-flagg, publiseringsdato)
   - Kategorier (f.eks. tips, gaveforslag, erfaringer/positiv seksjon)
   - Filtrering/søk på kategori og aldersgruppe
   - Paginering på artikkellister
   - Visningsteller per artikkel (til "mest lest")

3. **Abonnement**
   - Gratis-brukere ser låste artikler med "lås"-indikator + oppfordring til å abonnere
   - Abonnenter får full tilgang
   - Stripe test-mode checkout-flow, webhook-håndtering for: fornyelse, kansellering, feilet betaling (idempotent håndtering — forklar hvorfor dette er viktig)

4. **Trekninger (giveaways)**
   - Admin oppretter en trekning knyttet til en premie (f.eks. gavekort Dyreparken) med tidsvindu
   - Innloggede brukere kan melde seg på én gang per trekning (hindre dobbel-deltakelse)
   - Rettferdig, verifiserbar trekningsalgoritme (forklar valget, f.eks. kryptografisk tilfeldig utvelgelse)
   - Automatisk trekning av vinner ved fristens utløp (cron-jobb / scheduled task)
   - Loggføring av tidligere trekninger og vinnere (til admin-oversikt)
   - E-postvarsling til vinner (kan mockes/logges lokalt istedenfor ekte e-postutsending)

5. **Admin-panel (enkelt)**
   - Oversikt over artikler, brukere, abonnement-status, trekninger og vinnere

### Ikke-funksjonelle krav (viktig for portefølje)

- **API-dokumentasjon** med OpenAPI/Swagger
- **Automatiserte tester**: unit-tester for forretningslogikk (spesielt trekning-algoritme og abonnement-logikk) + integrasjonstester for API-endepunkter
- **CI/CD**: GitHub Actions som kjører tester ved push
- **Sikkerhet**: input-validering (f.eks. Zod/Joi), rate limiting på auth-endepunkter, riktig håndtering av secrets (.env, aldri i git)
- **GDPR/personvern**: siden dere lagrer navn/adresse for premieutsendelse — forklar og implementer prinsipper som dataminimering og sletting av data ved forespørsel
- **Logging**: strukturert logging (f.eks. Winston/Pino) på feil og viktige hendelser
- **Feilhåndtering**: konsekvent error-format på API-et, riktig bruk av HTTP-statuskoder

### Læringsmål — hvordan jeg vil at du jobber

- Før du skriver kode til en ny modul, forklar kort arkitekturvalget og alternativene du vurderte
- Bruk kommentarer i kode der logikken ikke er selvforklarende
- Foreslå én "riktig" måte, men nevn kjapt hva den vanlige nybegynnerfeilen ville vært og hvorfor den er dårligere
- Bygg stegvis: sett opp prosjektstruktur og database-skjema først, deretter auth, deretter artikler, deretter abonnement, deretter trekninger, til slutt admin-panel og polish
- Foreslå git-commits med gode meldinger underveis, som om dette var et ekte arbeidsprosjekt (bra for CV/GitHub-historikk)

### Foreslått datamodell (utgangspunkt — juster gjerne)

- `users` (id, navn, e-post, passordhash, rolle, abonnement_status, opprettet_dato)
- `articles` (id, tittel, ingress, innhold, bilde_url, kategori_id, aldersgruppe, kun_abonnenter, forfatter_id, publisert_dato, visninger)
- `categories` (id, navn, slug)
- `subscriptions` (id, bruker_id, stripe_subscription_id, status, periode_start, periode_slutt)
- `giveaways` (id, tittel, premie_beskrivelse, frist, status, vinner_bruker_id)
- `giveaway_entries` (id, giveaway_id, bruker_id, opprettet_dato) — unik constraint på (giveaway_id, bruker_id)

### Startoppgave til deg (Claude Code)

1. Foreslå prosjektstruktur (mappe-oppsett for backend + frontend, evt. monorepo vs. separate repos — begrunn)
2. Sett opp docker-compose (app, Postgres, Redis, MinIO)
3. Sett opp database-skjema/migrasjoner basert på datamodellen over
4. Implementer auth (registrering, innlogging, JWT, roller) med tester
5. Vent på min bekreftelse før du går videre til neste modul, slik at jeg rekker å forstå og stille spørsmål underveis

---
