CREATE TABLE scan_events (
  id bigserial PRIMARY KEY,
  parcel_id uuid NOT NULL REFERENCES parcels(id),
  scanned_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
