# Scans dropped during the March outage

## Summary

Scan events were lost for 40 minutes when the queue filled up.

## Severity

sev2

## Impact

About 3,000 parcels showed a stale state for a day.

## Timeline

09:10 queue full; 09:50 workers restarted.

## Root cause

The worker did not back off when Postgres was slow.

## Fix

Added backoff and a bigger queue.

## Prevention

Alert when the queue is above 80%.
