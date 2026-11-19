# Café Ranker / Café Index

A personal worldwide coffee-shop ranking built through pairwise comparisons. Each branch is separate. Choose an overall winner, remove places you haven't visited, and explore the ranking through country/city filters and a map.

Live site: https://coreys-cafe-index.coreygalli.chatgpt.site

## This public repository

This is the application source, assets, tests and database schema. It is based on the deployed source commit `8a305376fcfc8ff5f87d6643978eb2531f92a5ff`, with personal seed data excluded and the owner's email moved to runtime configuration.

Personal Google Maps activity, the private candidate dataset, live comparisons, saved exclusions, database contents and credentials are not included. The public copy uses two fictional example cafés. The existing live site and its database are separate from this repository and are not changed by this upload. GitHub commits do not automatically deploy it.

For the original candidate list, put the private dataset in `data/cafes.private.json` locally. Keep the original branch IDs so existing saved comparisons still match. That file is ignored by Git. The dev/build command prepares the ignored `data/cafes.json` input from the private file when present, otherwise from `data/cafes.example.json`. Never commit the generated input or personal backups.

## Behaviour

- Elo ranking, starting at 1500 with K=32; only compared cafés receive ranks.
- Continuous pair selection introduces new cafés and periodically refines existing positions.
- Removing a café also removes its comparisons' influence; restoring it replays those comparisons.
- D1 stores the collection centrally. Every device reads the same saved choices.
- A revision check prevents stale devices from overwriting newer saves.
- The owner signs in with ChatGPT. Server checks use the verified email and pin the stable Site-specific user ID on the first save.
- Public visitors see only ranked branch metadata and scores. They cannot edit or retrieve the candidate list.
- Browser storage is used only to transfer choices from the original local-only draft. New choices are confirmed saved only after a successful server response.
- JSON backup export/restore and conservative manual Maps activity import remain available to the owner.
- Live shared views refresh every 30 seconds or when the tab regains focus.

## Runtime and local development

The app uses Vinext, Cloudflare Workers and a D1 binding named `DB`. Hosted ChatGPT authentication is supplied by Sites. GitHub Pages alone cannot run the server or database.

Requirements: Node.js >=22.13 and the pnpm version declared in `package.json`.

```sh
pnpm install
pnpm dev
pnpm build
node --test tests/*.test.mjs
node --check public/app.js
```

Set `CAFE_OWNER_EMAIL` in the runtime environment to the actual owner's sign-in email. When this value is missing, editing is disabled. Use an untracked local `.dev.vars` file for Wrangler development values and the hosting platform's environment settings for production. Treat identity headers as trusted only behind the Sites authentication boundary; another host needs an equivalent trusted identity integration.

Schema: `db/schema.ts`. Generated, append-only migrations: `drizzle/`. After building, apply the initial migration to the local preview database:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_thankful_wraith.sql
```

Apply pending migrations once, in order. Local and hosted databases are separate. Sites applies hosted migrations during deployment. The existing `.openai/hosting.json` identifies the original Site; reuse it only when intentionally updating that Site.

## Layout

- `page.html`, `public/app.js`, `public/style.css`: existing interface.
- `public/model.js`: ranking, pairing, imports and backup validation.
- `public/cloud.js`: central persistence and conflict handling.
- `server/state.js`, `app/api/state/route.ts`: protected storage API and public ranking projection.
- `app/cafes.json/route.ts`: owner-only candidate endpoint.
- `data/cafes.example.json`: fictional public seed.
- `tests/`: ranking, import, multi-session, conflict, privacy and authorisation checks.

Automatic iPhone/Timeline visit detection and general automatic photo discovery are not connected. Bundled branch photographs retain source credits in `public/assets/photos/photos.json`. Missing photos are labelled; approximate map points are identified. The map uses Leaflet and OpenStreetMap and requires internet access.
