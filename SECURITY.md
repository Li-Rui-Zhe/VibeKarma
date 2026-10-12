# Security Policy

VibeKarma interacts with a local Codex installation and a visible desktop window. Process execution, credentials, captured context, and local storage are therefore treated as security-sensitive.

## Reporting

Please report vulnerabilities privately to the repository owner before opening a public issue. Include the affected version, reproduction steps, and the expected security impact. Do not include real API keys, auth files, or other credentials in a report.

## Design boundaries

- The React frontend cannot execute arbitrary shell commands. Native operations are exposed through a fixed set of Tauri commands.
- Authentication remains owned by the locally installed Codex CLI. VibeKarma does not copy API keys or Codex authentication files into its data store.
- VibeKarma prefers a separately installed Codex CLI. A CLI found inside the Codex desktop application is a best-effort fallback only; no Codex binary is copied, bundled, or redistributed.
- The current reward and punishment flow does not inject text into, interrupt, or modify the active Codex task.
- The transparent interaction layer is positioned only after a visible Codex desktop window has been identified.
- Diary generation runs through non-interactive Codex CLI execution in an ephemeral session with a `read-only` sandbox.
- The diary process runs from the VibeKarma data directory rather than the user's project workspace.
- Settings, feedback events, and generated diaries are stored locally. During diary generation, the required window context, feedback reason, and recent diary excerpts are provided to the user's configured Codex CLI / Provider, which may process them remotely. VibeKarma does not upload these materials to a separate VibeKarma service.
- On macOS, reading window text requires Accessibility permission. Missing permission or a failed read is reported and falls back to the feedback reason and recent diaries. The reader skips draft input fields and secure fields, matches the selected window, and limits traversal and communication time.

## Local data

VibeKarma stores settings, JSONL event logs, and a SQLite diary database. On Windows machines with a D drive the default location is `D:\VibeKarmaData`; otherwise the application data directory is used. macOS uses its application data directory. `VIBEKARMA_DATA_DIR` can override this location.

Local databases, logs, environment files, temporary browser profiles, generated previews, SSH keys, signing credentials, and API keys must not be committed to the repository.

## Release signing

The repository's release workflow can build unsigned application bundles. Any future signing certificate or signing secret must be supplied through the release platform's encrypted secret store and must never be checked into source control.
