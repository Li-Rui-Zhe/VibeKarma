use std::path::PathBuf;

pub(super) fn resolve_codex_executable(configured: Option<&str>) -> PathBuf {
    if let Some(configured) = configured {
        return PathBuf::from(configured);
    }
    if let Some(path) = executable_on_path("codex") {
        return path;
    }

    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.extend([
            home.join(".local/bin/codex"),
            home.join(".npm-global/bin/codex"),
            home.join("Library/pnpm/codex"),
            home.join(".bun/bin/codex"),
            home.join(".volta/bin/codex"),
            home.join(".nvm/current/bin/codex"),
        ]);

        if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versioned = versions
                .filter_map(Result::ok)
                .map(|entry| entry.path().join("bin/codex"))
                .collect::<Vec<_>>();
            versioned.sort_by(|left, right| right.cmp(left));
            candidates.extend(versioned);
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from("codex"))
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}
