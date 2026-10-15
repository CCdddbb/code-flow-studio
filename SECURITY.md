# Security and privacy

This is a **local desktop development tool**, not a multi-tenant or public upload service. Do not expose its port through a public reverse proxy.

## Boundaries

- Server binds only to `127.0.0.1`; Host allowlist protects against DNS rebinding.
- POST APIs require a session token, same-origin checks and JSON content type.
- Source is read, not compiled or executed. No repository scripts, shell commands, database operations or external AI requests are run by the analyzer.
- Browser uploads are processed in memory and not written to an uploads directory.
- CLI excludes generated directories and symlinks; output must be outside the source directory.
- File and request sizes are bounded. The static server exposes only allowlisted frontend assets.
- Source excerpts use text rendering. Standalone exports escape embedded JSON to prevent script injection.
- The projection evaluator accepts only a fixed declarative vocabulary and blocks prototype access.

## Important limitations

Redaction is **best effort**, not a secret-scanning guarantee. Arbitrary secrets in unrecognized strings/comments may remain. JSON and HTML exports contain source excerpts. Review them before sharing, and do not analyze code you are not authorized to disclose. File hashes are not anonymization.

Runtime source buffers may remain in Node/browser process memory until garbage-collected. This tool is not a hardened confidential-computing environment. Directory reads are not an atomic snapshot of a concurrently changing repository; stop editing source while generating or verifying evidence.

Only use the provided synthetic fixtures in CI, screenshots and public demonstrations. Never commit exported analyses of private repositories. `artifacts/`, local source, credentials and dependencies are excluded by `.gitignore`.

## Reporting

Do not put secrets or proprietary source into public issues. Report a security issue through the repository owner's private channel / GitHub private vulnerability reporting when enabled; include a minimal synthetic reproduction.
