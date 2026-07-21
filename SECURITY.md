# Security Policy

VibeKarma controls a local coding agent and therefore treats process execution, credentials and workspace boundaries as security-sensitive.

## Reporting

Please report vulnerabilities privately to the repository owner before opening a public issue.

## Design boundaries

- VibeKarma never asks the React frontend to execute an arbitrary shell command.
- Authentication remains owned by the locally installed Codex CLI.
- API keys and Codex auth files are not copied into VibeKarma storage.
- The default Codex session uses workspace-write sandboxing with on-request approvals.
- Reflection threads are ephemeral and read-only.
- Logs remain local unless the user exports them.

