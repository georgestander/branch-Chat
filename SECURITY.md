# Security Policy

## Supported Branches

Security fixes are currently applied to the active default branch.

## Reporting a Vulnerability

Please do not open public issues for unpatched security vulnerabilities.

Use one of the following:

1. GitHub private vulnerability reporting (preferred).
2. If private reporting is unavailable, contact the maintainer privately through GitHub and request a secure channel.

Include:

- Affected component/file.
- Reproduction steps or proof of concept.
- Impact and severity estimate.
- Any suggested mitigation.

## Response Expectations

- Initial triage target: within 3 business days.
- Status update target: within 7 business days.
- Fix timing depends on severity, exploitability, and release risk.

## Secret Handling

- Never commit API keys or credentials.
- Use Cloudflare environment bindings and `.dev.vars` for local development.
- Rotate exposed credentials immediately.
