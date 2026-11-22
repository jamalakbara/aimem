# 1. Use Postgres for parcel state

* Status: accepted
* Date: 2025-03-02

## Context and Problem Statement

We need durable storage for parcels and scan events, with transactions across both.

## Decision Outcome

Chosen option: Postgres 16, because it gives us transactions, JSONB for courier payloads, and the team already runs it.

### Consequences

* Good, because one datastore covers state and events.
* Bad, because the nightly export puts load on the primary.
