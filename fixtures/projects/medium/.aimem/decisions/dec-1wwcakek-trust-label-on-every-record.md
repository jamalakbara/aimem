---
aimem: 1
id: dec-1wwcakek
type: decision
title: Trust label on every record
summary: Each record says whether a human verified it, an agent wrote it, or adopt inferred it; briefings weight and label accordingly.
status: accepted
trust: verified
roles: [all]
tags: [format, briefing]
author: human:akbar
created: 2026-05-06T09:00:00Z
updated: 2026-05-06T09:00:00Z
verified: 2026-05-06
---

## Context
Agents write fast and sometimes wrong; readers must see what is confirmed.

## Decision
Three levels: verified 1.0, agent 0.7, inferred 0.4. Only humans can verify.

## Consequences
Briefings and the web app always label non-verified records.
