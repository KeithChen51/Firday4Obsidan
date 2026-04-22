# Friday Root Cleanup Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the user-visible `F.R.I.D.A.Y` tree as clean as possible by removing all machine-generated runtime/config/project scaffolding from the visible root, while preserving existing user data through a staged compatibility migration.

**Architecture:** Treat `F.R.I.D.A.Y` as a user-visible content area, not a runtime workspace. The final steady state is: studio/onboarding content may remain visible, but project roots, runtime audit files, and settings mirrors must live outside the visible tree. The migration therefore has four phases: first lock the clean-root contract with failing tests, then stop all new writes into visible legacy folders, then add inventory/import/relocation flows for existing `项目` and `个人` data, and finally clean up only empty or obsolete visible legacy artifacts. `boundaryPath` becomes the only project source of truth; visible legacy paths become read-only migration inputs.

**Tech Stack:** TypeScript, Obsidian API, Node built-in test runner (`node --test`), npm, vault adapter and local filesystem helpers.

---

### Task 1: Lock The Clean-Root Contract With Failing Tests

**Files:**
- Modify: `tests/project-editor-service.test.mjs`
- Modify: `tests/settings-project-ui-regression.test.mjs`
- Create: `tests/friday-root-cleanliness-regression.test.mjs`
- Create: `tests/legacy-friday-root-migration.test.mjs`
- Create: `tests/settings-mirror-location.test.mjs`

**Step 1: Add a visible-root cleanliness regression test**

Create `tests/friday-root-cleanliness-regression.test.mjs` that asserts the source no longer treats `F.R.I.D.A.Y` as a write target for:
- new project roots
- runtime audit files
- config mirrors

Use assertions like:

```js
assert.doesNotMatch(source, /F\.R\.I\.D\.A\.Y\/runtime/);
assert.doesNotMatch(source, /F\.R\.I\.D\.A\.Y\/项目/);
assert.doesNotMatch(source, /F\.R\.I\.D\.A\.Y\/个人/);
```

The only allowed visible-root usage after migration should be explicit studio/user-facing content.

**Step 2: Add migration inventory contract tests**

Create `tests/legacy-friday-root-migration.test.mjs` that locks this shape:

```ts
interface LegacyFridayRootReport {
  registeredLegacyProjects: Array<{ projectId: string; boundaryPath: string }>;
  importableLegacyProjects: Array<{ folderPath: string; suggestedProjectId: string }>;
  legacyPersonalFolders: string[];
  hasObsoleteVisibleConfigMirror: boolean;
}
```

Cover:
- registered project still rooted under `F.R.I.D.A.Y/项目/...`
- unregistered importable project folder under `F.R.I.D.A.Y/项目/*`
- non-empty `F.R.I.D.A.Y/个人/*`
- obsolete visible `_配置.md`

**Step 3: Add settings mirror location tests**

Create `tests/settings-mirror-location.test.mjs` that asserts:
- the canonical mirror path is `.obsidian/friday-state/friday-obsidian-plugin/settings.mirror.yaml`
- no extra `config/` folder is introduced
- `_配置.md` and `_config.md` are not the canonical write target

Use assertions like:

```js
assert.match(source, /settings\.mirror\.yaml/);
assert.match(source, /resolveVault\("settings\.mirror\.yaml"\)/);
assert.doesNotMatch(source, /_配置\.md/);
```

**Step 4: Update existing project-editor tests to the new product rule**

Modify:
- `tests/project-editor-service.test.mjs`
- `tests/settings-project-ui-regression.test.mjs`

Change the contract so:
- new projects never default under `F.R.I.D.A.Y/项目`
- no new personal/project scaffolding is created under `F.R.I.D.A.Y`
- editing an already-registered legacy project is still allowed during the compatibility window

**Step 5: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/project-editor-service.test.mjs tests/settings-project-ui-regression.test.mjs tests/friday-root-cleanliness-regression.test.mjs tests/legacy-friday-root-migration.test.mjs tests/settings-mirror-location.test.mjs
```

Expected:
- failures mentioning visible-root writes still exist
- failures showing project defaults still point into `F.R.I.D.A.Y/项目`
- failures for missing hidden settings mirror path

**Step 6: Commit the red baseline**

```bash
git add tests/project-editor-service.test.mjs tests/settings-project-ui-regression.test.mjs tests/friday-root-cleanliness-regression.test.mjs tests/legacy-friday-root-migration.test.mjs tests/settings-mirror-location.test.mjs
git commit -m "test: lock friday root cleanup contracts"
```

### Task 2: Make BoundaryPath The Only Project Identity Source

**Files:**
- Modify: `src/services/ProjectBoundaryService.ts`
- Modify: `src/services/DataService.ts`
- Modify: `src/commands/syncCommands.ts`
- Modify: `src/main.ts`
- Modify: `src/views/DailyBoardView.ts`
- Test: `tests/friday-root-cleanliness-regression.test.mjs`

**Step 1: Add canonical project lookup by registered root**

Extend `ProjectBoundaryService` with:

```ts
getProjectForVaultPath(vaultRelativePath: string): ProjectEntry | null
```

Implementation rule:
- first match against `settings.projects[].boundaryPath`
- only if no registered project matches, consult legacy migration inventory helpers

Do not keep visible-root path guessing as a primary branch.

**Step 2: Remove hot-path dependence on `DataService.getProjectIdFromPath()`**

Replace current path-guessing call sites in:
- `src/commands/syncCommands.ts`
- `src/main.ts`

with `ProjectBoundaryService.getProjectForVaultPath(...)`.

Expected usage:

```ts
const project = this.projectBoundaryService.getProjectForVaultPath(file.path);
if (!project) {
  return;
}
```

**Step 3: Make project metadata/member lookup root-driven**

Refactor `DataService.getProjectMembers()` and `setProjectMembers()` to accept a registered project root:

```ts
async getProjectMembers(project: Pick<ProjectEntry, "projectId" | "boundaryPath">): Promise<ProjectMember[]>
async setProjectMembers(project: Pick<ProjectEntry, "projectId" | "boundaryPath">, members: ProjectMember[]): Promise<void>
```

Fallback to `F.R.I.D.A.Y/项目/...` is allowed only if that path is already the saved `boundaryPath` of a registered legacy project.

**Step 4: Run the focused tests**

Run:

```bash
node --test tests/friday-root-cleanliness-regression.test.mjs tests/project-editor-service.test.mjs
```

Expected:
- registered roots resolve correctly
- no core sync/runtime logic needs `F.R.I.D.A.Y/项目` guessing

**Step 5: Commit**

```bash
git add src/services/ProjectBoundaryService.ts src/services/DataService.ts src/commands/syncCommands.ts src/main.ts src/views/DailyBoardView.ts tests/friday-root-cleanliness-regression.test.mjs tests/project-editor-service.test.mjs
git commit -m "refactor: use boundary path as the only project identity"
```

### Task 3: Stop All New Visible Legacy Writes

**Files:**
- Modify: `src/main.ts`
- Modify: `src/services/DataService.ts`
- Modify: `src/features/workbench/ProjectEditorService.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/platform/tools/StepTraceStore.ts`
- Modify: `src/platform/tools/ToolRunAuditStore.ts`
- Test: `tests/project-editor-service.test.mjs`
- Test: `tests/friday-root-cleanliness-regression.test.mjs`

**Step 1: Remove startup creation of visible legacy folders**

Stop creating these on startup for new installs:
- `F.R.I.D.A.Y/项目`
- `F.R.I.D.A.Y/个人`

If `DataService.ensureDirectoryStructure()` survives this task, it must not create those folders anymore.

**Step 2: Remove Friday-root defaults from project creation**

Update project editor and settings flows so:
- `local_only` starts with blank `boundaryPath`
- `remote_bootstrap` starts with blank `boundaryPath`
- the user must explicitly choose a vault folder

Do not prefill any new path under `F.R.I.D.A.Y`.

**Step 3: Move visible runtime audit files into hidden state**

Refactor:
- `src/platform/tools/StepTraceStore.ts`
- `src/platform/tools/ToolRunAuditStore.ts`

so they write under the hidden vault state root via a shared helper, not `F.R.I.D.A.Y/runtime`.

Target:

```text
.obsidian/friday-state/friday-obsidian-plugin/runtime/step_traces.jsonl
.obsidian/friday-state/friday-obsidian-plugin/runtime/tool_runs.jsonl
```

**Step 4: Keep a narrow legacy edit exception**

Validation may still allow a Friday-managed root only when:
- editing an already-registered project
- `initialBoundaryPath === normalizedRoot`

New projects targeting `F.R.I.D.A.Y` must still fail.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/project-editor-service.test.mjs tests/friday-root-cleanliness-regression.test.mjs
```

Expected:
- no new code writes runtime or project scaffolding into `F.R.I.D.A.Y`
- legacy edit-in-place remains possible

**Step 6: Commit**

```bash
git add src/main.ts src/services/DataService.ts src/features/workbench/ProjectEditorService.ts src/settings/FridaySettingTab.ts src/platform/tools/StepTraceStore.ts src/platform/tools/ToolRunAuditStore.ts tests/project-editor-service.test.mjs tests/friday-root-cleanliness-regression.test.mjs
git commit -m "refactor: stop new visible legacy writes under friday root"
```

### Task 4: Move The Settings Mirror To Hidden Vault State Without Adding A Folder

**Files:**
- Create: `src/services/SettingsMirrorService.ts`
- Modify: `src/services/LocalStateRootService.ts`
- Modify: `src/main.ts`
- Modify: `src/services/DataService.ts`
- Test: `tests/settings-mirror-location.test.mjs`

**Step 1: Introduce a dedicated settings mirror service**

Create `src/services/SettingsMirrorService.ts` with:

```ts
export class SettingsMirrorService {
  getMirrorPath(): string {
    return this.localStateRootService.resolveVault("settings.mirror.yaml");
  }
}
```

Canonical target:

```text
.obsidian/friday-state/friday-obsidian-plugin/settings.mirror.yaml
```

No `config/` subdirectory is allowed.

**Step 2: Move mirror write responsibility out of `DataService`**

After this task:
- `main.ts` calls `SettingsMirrorService.write(...)`
- `DataService` no longer owns mirror path resolution

**Step 3: Make migration low-risk**

For the first release:
- always write the hidden `settings.mirror.yaml`
- stop updating visible `_配置.md`
- do not auto-delete visible `_配置.md` yet

This ensures the product gets cleaner immediately without risking silent data loss.

**Step 4: Keep the file machine-oriented**

Write YAML with a machine-facing type:

```yaml
type: settings_mirror
version: 7
```

Do not preserve note-style naming in the hidden path.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/settings-mirror-location.test.mjs tests/friday-root-cleanliness-regression.test.mjs
```

Expected:
- hidden mirror path is canonical
- no new folder is introduced
- visible `_配置.md` is no longer written

**Step 6: Commit**

```bash
git add src/services/SettingsMirrorService.ts src/services/LocalStateRootService.ts src/main.ts src/services/DataService.ts tests/settings-mirror-location.test.mjs tests/friday-root-cleanliness-regression.test.mjs
git commit -m "refactor: move settings mirror into hidden vault state"
```

### Task 5: Add Legacy Inventory And Safe Import For Existing `项目` And `个人`

**Files:**
- Create: `src/services/LegacyFridayRootMigrationService.ts`
- Modify: `src/main.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Test: `tests/legacy-friday-root-migration.test.mjs`
- Test: `tests/settings-project-ui-regression.test.mjs`

**Step 1: Implement a read-only inventory service**

Create `LegacyFridayRootMigrationService` with:

```ts
scan(): Promise<LegacyFridayRootReport>
importLegacyProject(folderPath: string): Promise<ProjectEntry>
```

The inventory must scan:
- `F.R.I.D.A.Y/项目/*`
- `F.R.I.D.A.Y/个人/*`
- visible `_配置.md`

but must not auto-move or auto-delete anything.

**Step 2: Define importable project heuristics**

Treat a folder under `F.R.I.D.A.Y/项目/*` or `F.R.I.D.A.Y/个人/*` as importable when at least one is true:
- contains `.git`
- contains `_项目.md` / `_meta.md`
- contains `raw/`, `wiki/`, or `.friday/`

This is important: subfolders under `个人` are treated as candidate projects, not as one giant personal project.

**Step 3: Surface migration UI in settings**

Add a legacy cleanup/migration panel that shows:
- registered legacy projects still rooted in `F.R.I.D.A.Y/项目/...`
- unregistered importable folders under both `项目` and `个人`
- obsolete visible `_配置.md`

Actions for this task:
- `导入为已注册项目`
- `打开所在目录`
- `稍后处理`

No delete button yet.

**Step 4: Keep `个人` conservative**

Do not auto-convert the entire `个人` folder into one registered project. Only support:
- scanning subfolders
- importing subfolders that look like projects

Loose files or ambiguous content in `个人` remain untouched and visible until the user resolves them.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/legacy-friday-root-migration.test.mjs tests/settings-project-ui-regression.test.mjs
```

Expected:
- importable project folders are detected in both `项目` and `个人`
- ambiguous personal content is only reported, never force-migrated

**Step 6: Commit**

```bash
git add src/services/LegacyFridayRootMigrationService.ts src/main.ts src/settings/FridaySettingTab.ts src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts tests/legacy-friday-root-migration.test.mjs tests/settings-project-ui-regression.test.mjs
git commit -m "feat: add legacy friday root inventory and import flow"
```

### Task 6: Add Opt-In Relocation So Imported Legacy Projects Can Leave `F.R.I.D.A.Y`

**Files:**
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/features/workbench/ProjectEditorService.ts`
- Modify: `src/main.ts`
- Modify: `src/types/project.ts`
- Test: `tests/project-editor-service.test.mjs`
- Test: `tests/settings-project-ui-regression.test.mjs`
- Test: `tests/legacy-friday-root-migration.test.mjs`

**Step 1: Add a relocation action for registered legacy projects**

For a project whose `boundaryPath` is still under:
- `F.R.I.D.A.Y/项目/...`
- `F.R.I.D.A.Y/个人/...`

show:

```text
迁移到新的项目目录
```

This action must be explicit and per-project.

**Step 2: Implement relocation as move plus `boundaryPath` update**

Move the full folder tree to a user-selected vault path, then update:

```ts
settings.projects[index].boundaryPath = nextPath;
```

If the folder is a Git repository, move the whole repo root as one directory.

**Step 3: Add guardrails**

Reject relocation when:
- target folder is non-empty
- target path is inside `F.R.I.D.A.Y`
- target path overlaps another registered project boundary

**Step 4: Leave unresolved personal loose content alone**

This task only relocates registered/imported projects. It must not bulk-move all remaining `个人` content.

**Step 5: Run the focused tests**

Run:

```bash
node --test tests/project-editor-service.test.mjs tests/settings-project-ui-regression.test.mjs tests/legacy-friday-root-migration.test.mjs
```

Expected:
- imported legacy projects can leave `F.R.I.D.A.Y`
- unresolved personal loose content is untouched

**Step 6: Commit**

```bash
git add src/settings/FridaySettingTab.ts src/features/workbench/ProjectEditorService.ts src/main.ts src/types/project.ts tests/project-editor-service.test.mjs tests/settings-project-ui-regression.test.mjs tests/legacy-friday-root-migration.test.mjs
git commit -m "feat: add relocation flow for imported legacy projects"
```

### Task 7: Clean Up Only Empty Or Obsolete Visible Legacy Artifacts

**Files:**
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/main.ts`
- Modify: `CHANGELOG.md`
- Modify: `tests/main-root-index-recovery.test.mjs`
- Modify: `tests/friday-root-cleanliness-regression.test.mjs`

**Step 1: Add cleanup eligibility checks**

Only allow cleanup of:
- empty `F.R.I.D.A.Y/项目`
- empty `F.R.I.D.A.Y/个人`
- obsolete visible `_配置.md`
- obsolete visible `runtime` directory if already emptied by migration

Do not auto-delete any non-empty folder.

**Step 2: Expose a cleanup action only when safe**

Show a cleanup action in settings only when inventory proves:
- the folder is empty
- or the file is obsolete and already superseded

Expected user-facing effect:
- `F.R.I.D.A.Y` gradually becomes cleaner
- no destructive cleanup is possible while legacy data still exists

**Step 3: Run full verification**

Run:

```bash
npm run test
npm run build
npm run lint
```

Expected:
- all tests pass
- build passes
- lint passes
- visible-root writes are gone except for intended studio content

**Step 4: Update release notes**

Document:
- `F.R.I.D.A.Y` is now a user-visible content area, not a runtime workspace
- new projects are never created under `F.R.I.D.A.Y`
- runtime and settings mirror data moved into hidden vault state
- legacy `项目` and `个人` content can be imported and then relocated out of `F.R.I.D.A.Y`
- empty legacy folders can be safely cleaned up

**Step 5: Commit**

```bash
git add src/settings/FridaySettingTab.ts src/main.ts CHANGELOG.md tests/main-root-index-recovery.test.mjs tests/friday-root-cleanliness-regression.test.mjs
git commit -m "chore: finalize friday root cleanup migration"
```
