# Architecture

The API is a single Node service in front of Postgres. Couriers post scan events; a worker folds them into parcel state.

## Data flow

Scan events land in `scan_events`, and the worker updates `parcels.state` in order of `scanned_at`.

## Local development

Run the worker next to the API with `pnpm worker`. It polls every two seconds in development.
