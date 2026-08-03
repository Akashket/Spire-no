# Spire.no

Redaksjonelt nettsted for foreldre - portefølje-/læringsprosjekt for backend-utvikling i dybden.
Se [`docs/project-brief.md`](docs/project-brief.md) for hele det opprinnelige prosjektoppdraget.

## Struktur

Monorepo med npm workspaces:

```
spire/
├── apps/
│   ├── backend/     NestJS API (TypeScript, Prisma, PostgreSQL)
│   └── web/          Next.js-frontend (kommer i en senere fase)
├── docker-compose.yml  Postgres + Redis + MinIO (+ backend, valgfritt)
└── docs/
    └── project-brief.md
```

## Kom i gang (lokal utvikling)

1. **Start infrastruktur** (Postgres, Redis, MinIO) i Docker:
   ```
   npm run infra:up
   ```
2. **Installer avhengigheter** (kjøres fra rotmappen, npm workspaces installerer for begge apps):
   ```
   npm install
   ```
3. **Sett opp miljøvariabler** for backend:
   ```
   copy apps\backend\.env.example apps\backend\.env
   ```
   (Standardverdiene matcher docker-compose, så det holder å kopiere filen for lokal utvikling.)
4. **Kjør database-migrasjoner:**
   ```
   npm run prisma:migrate -- --name init
   ```
5. **Start backend i dev-modus** (hot reload):
   ```
   npm run dev:backend
   ```
   API-et kjører på `http://localhost:3001`, Swagger-dokumentasjon på `http://localhost:3001/docs`.

## Stripe (test mode)

Abonnement-modulen (`apps/backend/src/subscriptions`) krever en gratis Stripe-konto i test-mode:

1. Opprett konto på [dashboard.stripe.com/register](https://dashboard.stripe.com/register) - sjekk at "Test mode" er PÅ.
2. Developers → API keys → kopier `Secret key` (`sk_test_...`) inn i `apps/backend/.env` som `STRIPE_SECRET_KEY`.
3. Product catalog → "+ Add product" → opprett et recurring test-produkt → kopier `Price ID` (`price_...`) inn som `STRIPE_PRICE_ID`.
4. Installer [Stripe CLI](https://github.com/stripe/stripe-cli/releases/latest), kjør `stripe login`.
5. Med backend kjørende: `stripe listen --forward-to localhost:3001/subscriptions/webhook` - kopier den utskrevne `whsec_...`-signeringsnøkkelen inn som `STRIPE_WEBHOOK_SECRET`. Denne endrer seg hver gang `stripe listen` startes på nytt.

Uten ekte nøkler starter backend og alle unit-/webhook-e2e-tester fint (webhook-testene signerer
egne test-events lokalt via Stripe-SDK-ens `generateTestHeaderString`, uten nettverkskall) - kun
`POST /subscriptions/checkout` trenger en ekte `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID` for faktisk å
opprette en Checkout Session.

## Tester

```
npm run test:backend        # unit-tester (mocket, ingen database nødvendig)
npm run test:backend:e2e    # integrasjonstester (krever npm run infra:up + migrasjoner kjørt)
```

## Status / fremdriftsplan

- [x] Prosjektstruktur (monorepo, npm workspaces)
- [x] docker-compose (Postgres, Redis, MinIO)
- [x] Databaseskjema (Prisma) - users, articles, categories, subscriptions, giveaways, giveaway_entries
- [x] Auth (registrering, innlogging, JWT, roller) + tester
- [x] Artikler (CRUD, kategori-/aldersgruppefiltrering, paginering, visningsteller, paywall) + tester
- [x] Abonnement (Stripe test mode, webhooks, idempotent håndtering) + tester
- [x] Trekninger (giveaways) + cron-jobb for automatisk trekning + tester
- [x] Admin-panel (oversikt/statistikk) + tester
- [ ] Frontend (Next.js)
- [ ] CI/CD (GitHub Actions)

## Arkitekturvalg (kort oppsummert)

Se `docs/project-brief.md` for det fulle oppdraget, og commit-historikken / samtalen med Claude Code
for begrunnelsene bak hvert valg. Kort versjon:

| Område | Valg | Alternativ vurdert |
|---|---|---|
| Backend-rammeverk | NestJS | Rå Express (mer manuelt, mindre struktur for RBAC/validering/cron) |
| ORM | Prisma | Sequelize (mindre type-trygt) |
| Passordhashing | bcryptjs | argon2 (native kompilering, mer sårbart på Windows uten build-verktøy) |
| Validering | class-validator (DTO-er) | Zod (mindre naturlig Nest/Swagger-integrasjon) |
| Logging | pino (nestjs-pino) | Winston |
| Repo-struktur | Monorepo, npm workspaces | Separate repos for frontend/backend |
