---
title: Study with FRIDAY 元数据规范
series: study-with-friday
type: architecture
status: stable
author: 制作组
created: 2026-04-20
updated: 2026-04-28
summary: 说明 Study with FRIDAY 栏目文章应使用的 frontmatter 字段、推荐枚举和写作约定，让官方频道内容能被用户和 AI 稳定理解。
release_scope:
  - meta
tags:
  - friday
  - study-with-friday
  - metadata
  - obsidian
aliases:
  - Study with FRIDAY Metadata
  - 官方栏目元数据规范
  - 元数据规范
topics:
  - metadata
  - official-content
  - note-governance
---

# Study with FRIDAY 元数据规范

## 一、为什么这个栏目需要统一元数据

**Study with FRIDAY** 不是普通的开发笔记集合。

它更像官方频道里的长期学习记录：我们会在这里解释产品判断、记录方案取舍、复盘版本变化，也会把一些可以复用的方法沉淀下来。读者看到它时，应该能快速判断：

- 这篇文章在讲什么
- 它属于研究、决策、复盘，还是架构说明
- 它现在是草稿、稳定结论，还是历史归档
- 它主要对应哪个版本或哪个产品阶段
- 它和哪些主题、别名、相关内容有关

如果每篇文章的 frontmatter 都随手写，短期不会影响阅读，但长期会带来两个问题。

第一，人很难按主题、版本或文章性质稳定筛选内容。

第二，AI 在读取官方频道内容时，很难判断哪些内容是当前有效结论，哪些只是历史记录或背景材料。

所以这个栏目需要一套轻量但稳定的元数据约定。

## 二、适用范围

这份规范主要适用于官方频道里的 **Study with FRIDAY** 栏目文章。

它也可以作为其他官方栏目文章的参考，但不要求所有栏目完全复制。比如更新日志、入门指南和操作说明，可能会有自己的字段习惯。

如果以后开放社区订阅，社区频道也可以参考这套结构，但不要默认要求社区作者使用完全相同的字段。官方频道需要更稳定，是因为它承担的是第一方说明和产品判断沉淀。

## 三、设计原则

### 1. 轻量

字段不能太多。

如果 frontmatter 比正文还难维护，这套规范就会失效。

### 2. 稳定

同一类信息只保留一个字段，不做多套重复分类。

例如，不要同时使用 `type`、`category`、`theme` 来表达文章性质。

### 3. 对人和 AI 都友好

字段名要直观，枚举值要克制。

人能快速理解，AI 也能稳定检索、归类和串联上下文。

### 4. 服务产品思考，而不只是归档

这个栏目最重要的不是“存过什么”，而是“哪些判断值得以后继续参考”。

所以元数据要优先表达：

- 性质
- 状态
- 摘要
- 版本阶段
- 主题边界

## 四、统一后的字段方案

### 必填字段

```yaml
---
title:
series: study-with-friday
type:
status:
author:
created:
updated:
summary:
release_scope: []
tags: []
---
```

### 选填字段

```yaml
aliases: []
topics: []
related_notes: []
audience:
```

## 五、每个字段的含义

### `title`

必须有。

`title` 是读者和 AI 优先看到的正式标题，不要完全依赖文件名替代标题。

建议让 `title` 和正文一级标题保持一致。文件名可以为了排序或路径兼容略有差异，但不应该表达另一套标题。

### `series`

当前栏目统一写：

```yaml
series: study-with-friday
```

这个字段的作用是明确说明：这篇文章属于 **Study with FRIDAY** 系列。

早期文章里出现过其他系列名，那是历史口径。以后新写或维护这个栏目的文章时，以 `study-with-friday` 为准。

### `type`

建议只用少量枚举，不自由发挥。

推荐值：

- `research`
- `decision`
- `architecture`
- `retrospective`
- `ship-note`
- `guide`

如果一篇文章既像复盘又像架构说明，优先选择它最主要的阅读目的。不要为了覆盖所有角度而给 `type` 填多个值。

### `status`

建议固定枚举：

- `draft`
- `stable`
- `archived`

`draft` 表示还在整理中。

`stable` 表示当前可以作为有效参考。

`archived` 表示保留历史价值，但不再代表当前产品定义。

### `author`

默认写：

```yaml
author: 制作组
```

如果某篇文章需要明确署名，也可以写具体作者。官方频道里更推荐使用稳定的组织身份，避免文章像个人临时笔记。

### `created` / `updated`

日期格式统一为：

```yaml
created: 2026-04-20
updated: 2026-04-28
```

按日期粒度记录就够，不需要精确到时分秒。

`updated` 应该在内容有实质调整时更新。只改错别字或格式，可以不强制更新。

### `summary`

这个字段非常重要，建议每篇都认真写。

它最好是一句话，说明：

- 这篇文章在讲什么
- 为什么值得读
- 它和产品或使用方式有什么关系

不要把 `summary` 写成目录，也不要只重复标题。

### `release_scope`

这个字段用来标记文章主要对应哪个版本阶段。

推荐统一写成列表，即使只有一个版本也这样写：

```yaml
release_scope:
  - 0.2.9
```

如果一篇文章跨越多个版本，可以写成：

```yaml
release_scope:
  - 0.2.8
  - 0.2.9
```

如果这篇文章本身是规范、索引或元规则，不对应某个具体版本，可以写：

```yaml
release_scope:
  - meta
```

建议使用 `release_scope`，而不是 `version`。

因为这个栏目里的文章常常不是“某个版本里的一个功能说明”，而是覆盖一个版本阶段、甚至跨多个版本逐步成形的产品思考。

### `tags`

保留，但保持克制。

推荐至少包含：

- `friday`
- `study-with-friday`

然后再加 2 到 4 个主题标签即可。

不要把 `tags` 当成所有关键词的堆放区。

### `aliases`

用于常见简称、中英混合别名和更稳定的检索命中。

例如：

```yaml
aliases:
  - FRIDAY统一定义
  - FRIDAY Memory Soul定义
```

### `topics`

如果 `tags` 偏向搜索标签，那么 `topics` 更适合表达这篇文章主要覆盖的主题块。

例如：

```yaml
topics:
  - memory
  - soul
  - vault-boundary
```

### `related_notes`

这个字段适合放延伸阅读、并行主题，或者读完当前文章后值得继续看的相关内容。

如果没有明确相关内容，可以不写。

### `audience`

这是一个可选字段。

只有当文章明确面向某类读者时才写，比如：

```yaml
audience: first-time-users
```

如果没有明确必要，可以不写。

## 六、不建议保留的写法

### 不建议继续使用旧系列名

这个栏目现在统一叫 **Study with FRIDAY**。

新文章不要再使用旧的系列名或旧目录口径。旧文章如果还没整理，可以在下次实质更新时顺手迁移。

### 不建议同时出现多套分类字段

例如：

- `category`
- `theme`
- `domain`
- `subject`

这些字段很容易和 `type / topics / tags` 重叠。

### 不建议为了“完整”而加入大量空字段

如果某篇文章没有：

- `aliases`
- `topics`
- `related_notes`
- `audience`

那就直接不写，不要强行留空数组。

### 不建议把版本写死成单个 `version`

很多文章不是只属于一个版本。

用 `release_scope` 可以更自然地表达“这个判断主要发生在哪个版本阶段”。

## 七、推荐模板

```yaml
---
title: FRIDAY 的 Memory、Agent 与 Soul 统一定义
series: study-with-friday
type: architecture
status: stable
author: 制作组
created: 2026-04-20
updated: 2026-04-28
summary: 统一说明 FRIDAY 为什么重做 memory、让 Agent 退场、引入 Soul，并采用本地状态层与 Vault 双根架构。
release_scope:
  - 0.2.6
  - 0.2.7
tags:
  - friday
  - study-with-friday
  - memory
  - soul
  - ai-native
aliases:
  - FRIDAY统一定义
  - FRIDAY Memory Soul定义
topics:
  - memory
  - soul
  - local-state
  - vault-boundary
---
```

## 八、为什么这套 schema 从产品视角是对的

Study with FRIDAY 不是随手写下来的知识库碎片，而是“产品判断的沉淀层”。

它最该表达的，不是作者情绪，也不是标签越多越好，而是：

- 这是什么性质的判断
- 现在成熟到什么程度
- 它主要对应哪个阶段
- 它和哪些主题有关

所以：

- `type`
- `status`
- `summary`
- `release_scope`
- `topics`

比单纯堆 tags 更有价值。

## 九、为什么这套 schema 从 AI Native 视角也是对的

AI 在读取一批官方栏目文章时，最怕的是：

- 每篇结构都不一样
- 同类文章没有统一标识
- 研究、决策、复盘看起来像同一种东西
- 历史内容和当前结论没有状态区分

统一 frontmatter 后，AI 更容易做到：

- 判断这是不是当前有效结论
- 判断这篇文章属于哪类产品思考
- 知道它和哪些版本、主题、相关内容有关
- 在长上下文里更稳定地引用它

所以这套元数据规范不是“为了笔记软件而规范”，而是在给未来的人和 AI 同时提供更稳定的理解入口。

## 十、当前栏目的执行建议

从现在开始，Study with FRIDAY 栏目的新文章默认使用这套规范。

已有文章不需要为了改字段而单独大规模返工，但在出现以下情况时，应该顺手更新：

1. 文章标题、主题或定位发生变化。
2. 文章从草稿变成稳定版本。
3. 文章内容已经过时，需要改成历史归档。
4. 文章被纳入官方内容发布或订阅 feed。

如果只是临时草稿，可以先保证 `title / series / type / status / summary` 这几个关键字段正确。

## 十一、一句话总结

Study with FRIDAY 的元数据不应该只是“文件属性”，而应该是官方频道内容的索引层。

这层如果不稳定，后面的产品复盘、设计传承和 AI 检索都会越来越乱。
