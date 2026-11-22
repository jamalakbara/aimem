# 2. Store scans as events

Date: 2025-04-10

## Status

Superseded by [3. Fold scans in a worker](0003-fold-scans-in-a-worker.md)

## Context

Couriers send scans out of order when they come back online.

## Decision

Keep every scan as an immutable event and compute parcel state on read.

## Consequences

Reads got slow once a parcel had more than a few hundred scans.
