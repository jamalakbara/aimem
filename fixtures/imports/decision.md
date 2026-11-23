# Store parcel events for 90 days

Roles: dev, devops
Tags: retention, storage

## Summary

Scan events are kept for 90 days, then archived to cold storage.

## Status

Accepted

## Context

Scan events grow by 2 GB a month and slow down the fold worker.

## Decision

Keep 90 days in Postgres and move older events to object storage every night.

## Consequences

Support can only replay the last 90 days without a restore.

## Alternatives

Partitioning by month (more operational work).
