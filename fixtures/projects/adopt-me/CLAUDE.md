# Notes for Claude

## Code style

- Use named exports only.
- Never log full courier payloads; they contain phone numbers.

## Testing

Write the failing test first. Integration tests live in `test/integration` and need Postgres.
