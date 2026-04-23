# Unified Release-Branch Publishing Design

## Goal

把当前仓库的“插件版本更新发布”和“官方内容订阅发布”统一到同一个 **release 分支发布模型** 下，并为未来社区频道仓库定义同构协议。目标态要求：

- `main` 只承载源码、内容源和生成脚本
- `release` 只承载客户端可消费的发布物
- 插件更新、官方频道、社区频道都遵循“源码分支触发构建，发布分支承载产物”的统一模式
- 订阅端配置尽可能极简

当前版本尚未正式对外发布，因此本设计不保留迁移兼容要求，直接以目标态为准。

## Final Product Contract

### Branch Roles

- `main`
  - 插件源码
  - 官方频道源码
  - 生成脚本
  - Gitee pipeline 配置
- `release`
  - 插件更新 feed 与插件 artifacts
  - 官方频道内容 feed 与 blobs
  - 不包含任何源码、设计文档、开发脚本或编辑态内容

### Repository Roles

- **应用仓库**：当前插件仓库。发布树同时包含 `plugin/` 与 `official/`
- **频道仓库**：未来社区发布者仓库。一个仓库只允许发布一个频道，发布树固定为 `channel/`

### Changelog Ownership

- 完整 `CHANGELOG.md` 归属官方频道，作为官方频道里的 `Changelog` 栏目对外分发
- 插件更新系统只在 `plugin/latest.json` 中保留简短 `releaseNotes`
- `plugin/artifacts/` 不再携带 `CHANGELOG.md`

## Release Trees

### Application Repository: `release` Branch

```text
plugin/
  latest.json
  artifacts/
    main.js
    manifest.json
    styles.css

official/
  latest.json
  channels/
    official.json
  files/
    <hash>.md
```

### Community Channel Repository: `release` Branch

```text
channel/
  latest.json
  channels/
    <channel-id>.json
  files/
    <hash>.md
```

这三棵树都是“入口 manifest + 结构 manifest + blob 文件”的分层模型，只是命名空间不同。

## Publisher Workflow

### Official Publisher

官方发布者只在应用仓库的 `main` 分支维护：

- 插件源码
- 官方频道源目录
- 仓库根 `CHANGELOG.md`

每次 `push main` 后，Gitee pipeline 负责：

1. 安装依赖
2. 跑测试
3. 构建插件
4. 生成 `plugin/latest.json`
5. 扫描官方频道源目录并生成 `official/latest.json`、channel manifest 和 blobs
6. 把这些发布物写入 `release` 分支

### Community Publisher

社区发布者在自己的频道仓库 `main` 分支只维护频道源目录和脚本。每次 `push main` 后，仓库自己的 pipeline 生成：

- `channel/latest.json`
- `channels/<channel-id>.json`
- `files/<hash>.md`

然后把这些结果写入该仓库的 `release` 分支。

发布者不手改 `latest.json`、file hash 或 manifest 细节；这些都由生成器负责。

## Subscriber Workflow

### Plugin Update

插件更新客户端只读取：

- `plugin/latest.json`
- `plugin/artifacts/*`

它不读取官方频道正文，不读取 `official/`，也不依赖完整 changelog 文件。

### Official Content

官方频道由插件内置，不需要用户配置地址。客户端固定去应用仓库的 `release` 分支读取：

- `official/latest.json`
- `official/channels/*.json`
- `official/files/*`

### Community Channels

社区订阅的目标是让用户只填一个字段：

- `repoUrl`

其余由协议固定：

- `branch = release`
- `entry = channel/latest.json`

也就是说，客户端默认把社区频道仓库视为“一个仓库 = 一个频道”，不要求用户填写 `channelRoot`、manifest 路径或 blob 路径。

## Manifest Layering

### `latest.json`

职责是“入口索引”，只承载：

- schema version
- generated/published timestamp
- provider / channel summary
- 下一级 manifest 位置
- 可选的摘要级 release notes

### `channels/<id>.json`

职责是“结构 manifest”，承载：

- 频道 ID
- 栏目清单
- 每个栏目的稳定 ID
- 栏目路径、类型、版本
- 文件列表与 blob 路径

### `files/<hash>.md`

职责是“正文 blob”，只承载实际 Markdown 内容。

客户端读取顺序因此被固定为：

1. 读取 `latest.json`
2. 读取 channel manifest
3. 按需拉取 blobs

## Stable Identity Rules

- 频道 ID 从稳定发布路径推导，不从显示标题推导
- 栏目 ID 从稳定顶层路径推导，不从标题推导
- 标题允许修改，但不能影响订阅关系和本地映射
- `Changelog` 虽然源自仓库根 `CHANGELOG.md`，但对外仍表现为官方频道中的 `Changelog` 栏目

## Gitee Pipeline Model

推荐统一采用：

- `push main` 触发流水线
- 流水线从 `main` 检出源码
- 流水线生成发布物
- 流水线更新 `release` 分支

不推荐：

- 直接在 `release` 分支上以其自身为输入构建
- 手工维护 `release` 分支内容
- 在源码分支中长期保存发布物

## Local Runtime Implications

当前插件本地运行时需要随协议同步修改：

- 插件更新常量改为读取 `release` 分支上的 `plugin/latest.json`
- 官方内容服务改为读取 `release` 分支上的 `official/latest.json`
- 官方内容生成脚本改为产出 `official/` 命名空间，而不是 `official-content/`
- 插件 release 脚本改为产出 `plugin/` 命名空间，而不是根下 `release/latest.json`

## Non-Goals

本轮不做：

- 多频道共享一个仓库
- 用户自定义社区频道入口路径
- 不经 manifest 的“直接浅克隆整个仓库快照”模式
- 独立于 Git 仓库之外的频道注册中心
- 细粒度鉴权和付费频道方案

## Why This Design

这套设计的关键价值是统一心智：

- 发布者只关心维护源码和触发 pipeline
- 客户端只关心读取发布物
- 官方和社区协议一致，只是来源不同
- 插件升级和内容订阅共用一条“release 分支发布”原则，但保持命名空间隔离

这样既能让未来社区订阅接入成本足够低，也能让当前官方发布从“开发分支里的中间态目录”收口到真正的发布树。
