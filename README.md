# @topogram/extractor-express-api

> Package-backed Topogram extractor for Express API route surfaces.

Status: current
Audience: extractor package authors and maintainers
Use when: you need to change extractor evidence recovery, manifests, package metadata, or release proof.

Package-backed Topogram extractor for Express API route surfaces.

This package extracts review-only API candidates from Express projects:

- Express route handlers
- API route and capability candidates
- path and query parameter hints
- authentication hints from middleware or route permissions metadata
- Express stack evidence

Extractor packages run only during `topogram extract`, emit review-only candidates, and never mutate the source app or write canonical `topo/**` directly.

## Usage

```bash
topogram extract ./brownfield-app --out ./topogram-review --from api --extractor @topogram/extractor-express-api
```

## Verification

```bash
npm run check
```

## Release Preflight

```bash
npm run release:preflight
```

The preflight runs package checks, docs/RAG verification, `npm pack --dry-run`,
and Gitleaks secret scanning before publish or broad sharing.
