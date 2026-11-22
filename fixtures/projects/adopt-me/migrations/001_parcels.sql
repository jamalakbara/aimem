-- Parcels: one row per parcel; state is folded from scan_events by the worker.
CREATE TABLE parcels (
  id uuid PRIMARY KEY,
  tracking_code text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'created',
  last_event_id bigint
);
