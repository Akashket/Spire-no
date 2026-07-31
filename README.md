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
- [ ] Artikler (CRUD, kategori-/aldersgruppefiltrering, paginering, visningsteller)
- [ ] Abonnement (Stripe test mode, webhooks, idempotent håndtering)
- [ ] Trekninger (giveaways) + cron-jobb for automatisk trekning
- [ ] Admin-panel
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
