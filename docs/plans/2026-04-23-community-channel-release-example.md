# Community Channel Release Example

## Source Branch Layout

`main` only keeps editable channel source plus the generator and pipeline:

```text
channel-src/
  README.md
  Start Here.md
  Study Notes/
    Welcome.md
scripts/
  generate-channel-release.mjs
.workflow/
  channel-release-publish.yml
```

## Release Branch Layout

`release` only keeps publishable trees:

```text
channel/
  latest.json
  channels/
    my-channel.json
  files/
    <hash>.md
```

## Subscriber Input

Community subscribers only provide:

- `repoUrl`

Protocol defaults:

- `branch = release`
- `entry = channel/latest.json`

## Pipeline Notes

A community channel pipeline should:

1. Trigger on `push main`
2. Run dependency install if needed
3. Generate `channel/latest.json`, `channel/channels/*`, and `channel/files/*`
4. Commit only the publish tree into `release`

The pipeline should not build from `release` itself, and should not ask subscribers to provide branch or manifest path manually.
