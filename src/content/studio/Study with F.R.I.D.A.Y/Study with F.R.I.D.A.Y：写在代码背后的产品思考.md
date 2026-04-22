---
title: 写在代码背后的产品思考：我们为什么做 Friday
series: study-with-friday
type: retrospective
status: stable
author: 制作组
created: 2026-04-20
updated: 2026-04-20
summary: 探讨现有 AI Native 工作模式的局限性，以及 Friday 如何通过“以 Obsidian 为中心”和“隐形 Git”来降低认知摩擦，实现能力复利。
release_scope:
  - 0.2.6
tags:
  - friday
  - backstage
  - ai-native
  - product-philosophy
aliases:
  - Friday产品思考
  - AI Native工作模式思考
topics:
  - product-philosophy
  - ai-native-workflow
  - local-state
---

# Study with F.R.I.D.A.Y：写在代码背后的产品思考

> "工具的终极形态，是消失在工作流中。"

**Study with F.R.I.D.A.Y** 是来自制作组下的深度文章系列，每一篇都是我们和 Friday 一起学习的过程。这里没有枯燥的技术文档，也没有包装过度的产品宣传——更像是一本工作日志，记录 F.R.I.D.A.Y（下称 Friday）真实的演进过程、方案取舍，以及我们在开发中遇到并试图解决的问题。

这是这个系列的第一篇，我想和大家分享一个最近在团队里热烈讨论的话题：**如何让 AI Native 工作模式真正落地？**

最近大家传阅了一份关于新工作模式的文档，核心思路是把 Git、Gitee、VSCode 和各种 AI 插件组合起来，搭一个智能协作终端。这份文档给了我们很多启发，也正是它，促使我们做出了 Friday 现在的形态。

在这篇文章里，我们将和大家一起，随着 Friday 的视角，去拆解这套模式的愿景与困境，并分享我们尝试给出的一套解法。

---

## 一、愿景很美，但我们在推行中遇到了困难

那份文档看透了组织进化的方向：**把 Prompt、Workflow 和 Skills 当代码一样管理**。

在这个框架下，Git 不再是程序员的专属，它成了“数字资产变化的历史”。每次思考和调优都被记录，沉淀在主分支里，从而实现“能力复利”。今天有人调优了一个数据分析 Prompt，明天整个团队拉取更新，所有人就都拥有了这个能力。这是从重复消耗到组织迭代的巨大进步。

我们完全认同这个大方向，这也是为什么 Friday 底层依然选择用 Git 做协作通道。但在把这套以 VSCode 和 Git 为核心的模式带给非技术同学（比如 HR、运营或商务）时，我们在实践中遇到了三个真实的阻力：

### 1. 较高的初始配置门槛

要体验这套流程，业务同学需要先过配置关：装 Git、注册 Gitee、配 SSH 密钥、装 VSCode，再在 VSCode 里装一堆插件。

对习惯了开箱即用的用户来说，这个过程并不轻松。为了让一个 AI 插件有个运行环境，去学习一个专业的开发环境，显得有些吃力。

### 2. 高摩擦的认知负担

环境搭好后，业务同学还需要理解一套陌生的概念：工作区、暂存区、`add`、`commit`、`push`。如果在协作中遇到合并冲突，屏幕上出现的 `<<<<<<< HEAD` 标记往往会让人不知所措。

我们在规划 Friday 时一直在思考：如果一个功能让用户花更多时间在工具上，而不是工作本身上，那它是否还有优化的空间？让非技术人员学 Git 命令行，可能是一种认知带宽的浪费。我们更希望打造一个**低摩擦**的工作流。

### 3. 高熵的上下文困境

即使克服了前两点，实际工作时信息依然是分散的：文档在本地，沟通在企业微信，参考网页在浏览器。而 VSCode 里往往只有零散的 Markdown 文件。

AI 的能力上限取决于上下文的质量。当上下文高度分散、充满混乱（高熵）时，AI 很难理解工作全貌，自然也无法给出深入的建议。

这让我们意识到：**交付卓越结果的关键，永远在于“思维”和“洞察力”，而非工具或技术本身**。如果工具本身带来了过高的理解成本，它反而可能阻碍思维的流动。

---

## 二、行业给我们的启发

在构思 Friday 的解法时，我们和 Friday 一起“学习”了行业里发生的几件事。它们给了我们很大的启发，也帮我们明确了方向。

### 1. Claude Code 泄露与“薄壳厚技能”

2026 年 3 月，Anthropic 的 Claude Code CLI 工具源码意外泄露 [1]。开发者们分析后发现，它的架构重心不在模型本身，而在编排层（Harness） [2]。

Y Combinator 的 CEO Garry Tan 借此写了篇文章，提出 **"Thin Harness, Fat Skills"（薄壳厚技能）** 的架构思路 [3]。他建议把智能向上推入 Skills（可复用的 Markdown 程序），把执行向下推入确定性的代码，中间的 Harness 保持极度轻薄。

"Markdown is actually code." Garry 认为，Markdown 文件比刚性源码更适合封装能力，因为它用模型能理解的语言描述了过程和判断。这坚定了我们采用 Markdown 的思路。

### 2. Karpathy 的 LLM Wiki：让 AI 拥有记忆

前 OpenAI 负责人 Andrej Karpathy 随后发布了 LLM Wiki 方法论 [4]。他提到当前 RAG（检索增强生成）模式的一个痛点：AI 每次回答问题都在从零开始，没有积累。

他建议让 LLM 增量构建和维护一个持久化的 Wiki。知识被编译一次并保持更新，而不是每次查询时重新推导。Karpathy 提到他自己的习惯是“一边开着 LLM agent，一边开着 Obsidian”。这直接启发了我们设计 Friday 项目结构中的 `wiki/` 目录。

### 3. Hermes-Agent：会生长的智能体

Nous Research 开源的 Hermes-Agent 在短短两个月内获得了极大关注 [5]。它最吸引人的地方在于自学习闭环：在复杂任务后自主创建 Skill，在使用中自我改进，并定期持久化知识。

这让我们看到，未来的 AI 助理应该是一个有记忆、有技能库、能随你使用而进化的伙伴。

---

## 三、Friday 的一次尝试：以 Obsidian 为中心

结合内部模式的愿景和行业的启发，Friday 尝试给出这样一种解法：**以 Obsidian 为中心，把复杂的工程逻辑藏到幕后**。

### 为什么选择 Obsidian？

因为它是天生的“人机共享暂存区”。Obsidian 的核心是本地 Markdown 文件。对人类来说，它是好用的笔记工具，所见即所得；对 AI 来说，Markdown 是解析成本极低的母语；对 Git 来说，纯文本是版本控制的最优解。在 Obsidian 里，用户只需要专注写字、整理思路，不需要去适应复杂的工程结构。

### 让 Git 隐身，实现低摩擦

我们保留了 Git 作为团队协作的底层通道，但**把 Git 对用户隐藏了**。在 Friday 里没有 `commit` 或 `push` 按钮。同步服务在后台静默工作，自动拉取、自动提交。遇到代码冲突时，Friday 会把它转化成直观的可视化选项。这样，用户既能享受版本管理的红利，又不需要承担认知摩擦。

### 打造低熵的统一上下文

我们将项目管理、任务拆解、知识沉淀全部收敛在 Obsidian 的一个 Vault（知识库）里。在这个统一的容器中，信息从无序的高熵状态转变为有序的低熵状态。Friday 能看到历史需求，也能看到今日待办。当上下文完整有序时，AI 才能更好地辅助我们思考。

---

## 四、Friday 的产品哲学

在设计 Friday 时，我们给这个名字赋予了三层期望：

1. **Make Every Day Friday**：情感诉求。希望有了它，大家每天的工作能多一份从容。
2. **鲁滨逊的伙伴 Friday**：功能定位。它是那个默默帮忙打理繁杂事务的伙伴，但**它永远不会替代你思考，你才是这座岛的主人**。
3. **漫威的 F.R.I.D.A.Y.**：技术气质。它是一个安静的助理，随时待命，但不喧宾夺主。

基于这三点，我们定下了几条设计原则：

- **减少认知负担**：操作尽量符合直觉，追求极致的低摩擦。
- **用户决策主权**：AI 提供建议、整理信息、起草方案，但所有关键决策（如定优先级、改核心数据）必须由用户确认。
- **AI 可选**：哪怕断网或大模型不可用，基础的项目管理和同步功能也必须正常工作。
- **首次即有价值**：不强求长期的历史数据积累，哪怕第一次安装只是让它帮忙拆分个任务，也要给出有用的反馈。
- **透明可解释**：AI 给出的建议尽量附带推理过程，建立信任。
- **非侵入式**：在用户专注码字时保持安静，只有被召唤或触发特定工作流时才出现。

---

## 五、工程实现上的尝试

为了支撑这些想法，我们在工程架构上做了一些设计尝试。

### 1. 实践 "Thin Harness, Fat Skills"

在 Friday 底层，Harness（调度层）保持极简，主要负责理解意图并寻找对应方法。真正干活的是内置的各种 Markdown Skill 文件（如 `compile-wiki`、`resolve-conflict`）。如果你想让 Friday 学会新技能，只需用自然语言写个 Markdown 格式的 Skill 文档。这为“能力复利”提供了一种相对简单的实现方式。

### 2. 呼应 LLM Wiki 的三层目录结构

每个 Friday 项目都遵循一套约定的目录结构，从根本上维持系统的低熵状态：

- `raw/`：存放不可变的原始文件（如 PDF、录音转写稿），作为绝对的参考源。
- `wiki/`：存放 AI 编译生成的知识沉淀，作为持久化层。
- `workspace/`：人机共同的游乐场，草稿、大纲、脑暴都在这里进行。

这种结构帮助 AI 明确知道哪里是源头，哪里可以修改。

### 3. 知识编译与记忆维护

借鉴 Hermes-Agent 的思路，我们尝试加入了记忆维护功能。当新资料放入 `raw/` 目录时，Friday 的 `compile-wiki` Skill 会在后台静默启动，阅读资料、提取概念，并更新 `wiki/` 目录下的相关页面，让知识库能够逐渐“生长”。

### 4. 隐形的 Git 同步引擎

基于 `simple-git`（移动端备用 `isomorphic-git`），我们封装了一个 `SyncService`。它复用了企业内网的 HTTP Basic Auth 凭据，实现无感认证，并通过监听文件变更在后台完成同步。遇到冲突时，会弹出友好的 UI 让用户选择保留哪个版本。

---

## 六、一点诚实的自我剖析

Friday 并不完美，我们还在摸索中，目前也有一些没做好的地方。

在 UI 交互上，我们还有妥协。比如对话界面的层级有时显得较深，处理复杂多分支对话时体验还不够丝滑。

此外，“隐形 Git”在面对企业内网复杂的网络环境（如各种代理、防火墙）时，偶尔会出现同步失败的边缘情况，后续需要加入更强壮的重试和降级机制。

但最让我们挂怀的，是关于**智能主体性**的探索。目前的 Friday 依然偏向于一个“被动响应”的助理。我们如何让它的思维更敏锐？如何让它在整理 `wiki/` 时，不仅是提取信息，还能主动发现逻辑漏洞并提出好问题？

当工具的门槛降低，当底层的复杂性被隐藏，真正决定工作产出质量的，终将回归到我们与 AI 碰撞出的思维火花。

Friday 迈出了第一步，我们期待能和大家一起把这条路走得更好。这也是“来自制作组”这个栏目存在的意义：我们不仅交付代码，也交付思考；我们希望你不只是使用 Friday，也能随着它一起成长。

---

### 参考资料

[1] [Claude Code Source Code Leak: 8 Hidden Features You Need to Know](https://www.mindstudio.ai/blog/claude-code-source-code-leak-8-hidden-features/)  
[2] [Everyone Analyzed Claude Code’s Features. Nobody Analyzed Its Architecture.](https://medium.com/data-science-collective/everyone-analyzed-claude-codes-features-nobody-analyzed-its-architecture-1173470ab622)  
[3] [Thin Harness, Fat Skills - garrytan/gbrain](https://github.com/garrytan/gbrain/blob/master/docs/ethos/THIN_HARNESS_FAT_SKILLS.md)  
[4] [LLM Wiki - A pattern for building personal knowledge bases using LLMs](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)  
[5] [NousResearch/hermes-agent: The agent that grows with you](https://github.com/nousresearch/hermes-agent)
