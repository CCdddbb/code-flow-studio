# Contributing

Requires Node.js 22+ and npm.

```bash
npm ci
npm run verify
npx playwright install chromium
npm run test:browser
```

For an installed Chrome binary, use `CHROME_PATH=/path/to/chrome npm run test:browser` instead. Tests automatically use local Google Chrome on macOS if available.

## Principles

1. Keep source extraction, model validation, pure projection and rendering separate.
2. Every source claim needs evidence. Name-based storage/queue hints must remain inferred.
3. Unknown is not null, an empty table, rollback or success.
4. Never execute uploaded code or model-generated code.
5. Do not introduce business-name conditionals into the renderer.
6. Add synthetic regression fixtures for every new parser pattern; never contribute private source.
7. Keep lockfile, schema, support matrix and tests aligned with implementation.

Proposed changes should explain supported syntax, unresolved behavior, security impact and tests actually run. Browser screenshots belong in `artifacts/` unless deliberately curated as public documentation.

No framework/build step is needed for this version: the browser UI uses native ES modules. If adding a frontend framework, preserve offline standalone export and do not add remote runtime assets.
