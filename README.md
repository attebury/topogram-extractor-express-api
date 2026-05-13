# @topogram/extractor-express-api

Package-backed Topogram extractor for Express API route surfaces.

This repository currently contains the extractor package skeleton. The next implementation pass will add precision-first extraction for Express route files, API capabilities, route metadata, params, auth hints, and stack evidence.

Extractor packages run only during `topogram extract`, emit review-only candidates, and never mutate the source app or write canonical `topo/**` directly.

## Verification

```bash
npm run check
```

