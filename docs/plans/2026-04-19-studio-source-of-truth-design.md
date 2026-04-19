# Studio Source Of Truth Design

**Goal:** Make `src/content/studio` the authoritative published source for the Vault-side `F.R.I.D.A.Y/来自制作组` tree, while continuing to derive the shipped changelog content from the repo-root `CHANGELOG.md`.

## Scope

This change only governs the published Studio area inside the Vault:

- `F.R.I.D.A.Y/来自制作组`

It does not change project wiki ingestion, general project content sync, or any other Vault-managed folders.

## Desired Behavior

After a new plugin version is installed and loaded:

1. The entire `F.R.I.D.A.Y/来自制作组` folder must match the bundled Studio snapshot from the plugin source.
2. Any extra local files or folders inside `来自制作组` that are not part of the bundled Studio snapshot must be removed.
3. The shipped changelog note must still come from repo-root `CHANGELOG.md`, but its top-level title must be `# 迭代手记 · Changelog`.
4. Empty directories that are intentionally part of the shipped Studio tree must be preserved across builds and runtime sync.

## Source Model

The authoritative Studio snapshot is defined by:

- the directory tree under `src/content/studio`
- the generated changelog note built from `CHANGELOG.md`

This means `src/content/studio` remains the authoring area for ordinary Studio notes and directories, while `CHANGELOG.md` remains the authoring area for changelog content.

## Build-Time Representation

The Studio generator should stop emitting only a flat markdown-file list. Instead it should emit a full snapshot manifest with both:

- directory entries
- file entries

Each entry must include:

- `relativePath`
- `kind` (`directory` or `file`)
- `content` for files only

The generator should:

- recursively collect tracked directories under `src/content/studio`
- ignore generated artifacts such as `generated.ts`
- ignore `.keep` as a published file while still using it to preserve empty directories in git
- inject a virtual `迭代手记.md` file from repo-root `CHANGELOG.md`

## Runtime Sync Model

`AgentService.bootstrap()` should no longer just upsert a few known Studio files. It should reconcile the entire `来自制作组` subtree against the generated snapshot.

Authoritative reconcile rules:

1. Ensure the Studio root exists.
2. Remove files under the Studio root that are not present in the snapshot.
3. Remove directories under the Studio root that are not present in the snapshot.
4. Recreate all snapshot directories.
5. Rewrite all snapshot files with bundled content.

This intentionally makes local user edits under `来自制作组` non-durable across plugin upgrades, which matches the requested product behavior.

## Update Flow

`PluginUpdateService` should stop directly writing `F.R.I.D.A.Y/来自制作组/迭代手记.md`.

Instead:

- update application continues to install plugin artifacts
- on next plugin load, `AgentService.bootstrap()` restores the full Studio snapshot from bundled source

The existing startup helper that syncs bundled changelog text should be replaced or narrowed so it aligns with the authoritative Studio reconcile path instead of maintaining a second special-case content path.

## Test Strategy

Regression coverage should lock:

1. generator output includes directories, ordinary markdown files, and the injected changelog file
2. changelog title normalization produces `迭代手记 · Changelog`
3. runtime bootstrap uses full Studio snapshot reconcile logic instead of fixed child paths
4. update service no longer hardcodes Studio changelog mirroring

