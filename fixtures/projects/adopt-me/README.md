# Parcel Hub

Parcel Hub tracks parcels from warehouse intake to doorstep delivery. It exposes a REST API for couriers and a nightly export for the finance team.

## Getting started

1. Install Node 22 and pnpm.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL`.
4. Start the API with `pnpm dev`.

## Running tests

Run `pnpm test`. Integration tests need a local Postgres; start one with `docker compose up db`.

## Deployment

Merges to `main` deploy to staging automatically. Production deploys run from a tagged release with `make deploy ENV=prod`.

## License

MIT
