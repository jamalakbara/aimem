# 3. Fold scans in a worker

Date: 2025-06-18

## Status

Accepted

## Context

Computing state on read was too slow (see ADR 2).

## Decision

A worker folds scan events into `parcels.state` in `scanned_at` order and stores the last folded event id.

## Consequences

State can lag a few seconds behind the newest scan. Re-folding a parcel is safe because the fold is idempotent.
