# Security Policy

VibeKarma interacts with a local Codex installation and a visible desktop window. Process execution, credentials, captured context, and local storage are therefore treated as security-sensitive.

## Reporting

Please report vulnerabilities privately to the repository owner before opening a public issue. Include the affected version, reproduction steps, and the expected security impact. Do not include real API keys, auth files, or other credentials in a report.

## Design boundaries

- The React frontend cannot execute arbitrary shell commands. Native operations are exposed through a fixed set of Tauri commands.
- Authentication remains owned by the locally installed Codex CLI. VibeKarma does not copy API keys or Codex authentication files into its data store.
- The current reward and punishment flow does not inject text into, interrupt, or modify the active Codex task.
- The transparent interaction layer is positioned only after a visible Codex desktop window has been identified.
- Diary generation runs in an ephemeral Codex CLI process with a `read-only` sandbox and `never` approval policy.
- The diary process runs from the VibeKarma data directory rather than the user's project workspace.
- Window context, feedback events, settings, and generated diaries remain local unless the user exports or publishes them.

## Local data

VibeKarma stores settings, JSONL event logs, and a SQLite diary database. On machines with a D drive the default location is `D:\VibeKarmaData`; otherwise the application data directory is used. `VIBEKARMA_DATA_DIR` can override this location.

Local databases, logs, environment files, temporary browser profiles, generated previews, SSH keys, signing credentials, and API keys must not be committed to the repository.

## Release signing

The repository's release workflow can build unsigned application bundles. Any future signing certificate or signing secret must be supplied through the release platform's encrypted secret store and must never be checked into source control.
