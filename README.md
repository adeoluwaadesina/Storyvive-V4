# Storyvive V4 — Canon Extractor

The canon-extraction module for Storyvive V4. Built and tested standalone before wiring into the main app.

## Setup

```
npm install
```

## Try it

The harness takes a Wikipedia page title and prints every `{{Episode list}}` entry it finds.

```
npx tsx test-canon.ts "Star Trek: Picard season 1"
npx tsx test-canon.ts "Foundation season 1"
npx tsx test-canon.ts "Dune (novel)"
```

The third one is a book — it has a Wikipedia page but no episode-list templates, so the harness will report `episodes found: 0`. Useful as a sanity check that non-TV pages don't crash.

Set `SV_DEBUG=1` to print per-template trace lines to stderr.
