# FRIDAY Obsidian 插件

当前版本：`0.2.14`

## 1. 这是什么产品

FRIDAY 是一个运行在 Obsidian 里的本地 AI 工作流插件。它把 AI 对话和项目同步放进同一个 Vault 工作空间，让用户可以围绕真实项目持续使用 AI，而不是每次都从一段临时对话开始。

核心功能：

- **对话**：在 Obsidian 侧边栏打开 FRIDAY，围绕当前项目提问、总结、整理资料，也可以引用笔记、文件夹和图片。
- **项目同步**：把项目同步、分支、本地改动和冲突处理包装成更适合普通用户的界面，降低直接操作 Git 的门槛。

适合的人和业务：

- 适合用 Obsidian 管理研究、写作、复盘、项目资料和团队知识库的人。
- 适合需要长期维护资料、决策记录、任务进展和方法论的业务团队。
- 适合想把 AI 对话和项目版本同步放在同一套工作流里的团队。
- 不适合把 AI 当成完全自动代理来放任执行；关键写入、删除、同步和冲突处理仍应由用户确认。

## 2. 分支、下载和安装

目前 GitHub 主要作为远端代码存储；面向用户的实际发布以 Gitee 发布页和 Gitee 上的发布分支为准。

发布和维护时会遇到的三个分支：

| 分支 | 用途 | 普通用户是否需要 |
| --- | --- | --- |
| `main` | 源码和开发分支，给开发者查看代码、提交改动和本地构建 | 不建议作为安装来源 |
| `release` | 当前插件发布分支，包含插件更新 feed 和安装产物 | 需要，普通用户从 Gitee 这个分支或发布页下载 |
| `friday-model-catalog` | 模型列表更新分支，用来更新可选模型和默认模型配置 | 不需要，普通用户不用手动下载 |

普通用户下载哪个文件：

1. 推荐打开发布压缩包下载页：[friday-obsidian-plugin.zip](https://devops.byd.com/QCSHFW/_source/QCSHFW/houshichangjiazhifazhanbu/F.R.I.D.A.Y/-/blob/heads%2Frelease/plugin/friday-obsidian-plugin.zip)，进入页面后选择 **下载**。
2. 解压后，把 `friday-obsidian-plugin/` 里的 `main.js`、`manifest.json`、`styles.css` 放进 Obsidian 插件目录。
3. 如果不下载压缩包，也可以直接下载 `plugin/artifacts/main.js`、`plugin/artifacts/manifest.json`、`plugin/artifacts/styles.css` 这三个文件。

不要下载代码托管平台自动生成的源码包来安装插件；那是源码，不是 Obsidian 可直接加载的插件产物。

手动安装目录：

```text
<你的 Vault>/.obsidian/plugins/friday-obsidian-plugin/
```

目录中最终应包含：

```text
main.js
manifest.json
styles.css
```

然后在 Obsidian 的 **设置 -> 第三方插件** 中启用 FRIDAY。

如果想用本地命令行安装，先把下面的 `D:\Obsidian\MyVault` 改成自己的 Vault 路径，再在 PowerShell 中执行：

```powershell
$Vault = "D:\Obsidian\MyVault"
$Repo = "https://devops.byd.com/QCSHFW/houshichangjiazhifazhanbu/F.R.I.D.A.Y.git"
$Branch = "release"
$ZipPath = "plugin/friday-obsidian-plugin.zip"
$PluginDir = Join-Path $Vault ".obsidian\plugins\friday-obsidian-plugin"
$WorkDir = Join-Path $env:TEMP ("friday-install-" + [guid]::NewGuid())

git clone --depth 1 --branch $Branch --filter=blob:none --sparse $Repo $WorkDir
git -C $WorkDir sparse-checkout set $ZipPath
Expand-Archive -Path (Join-Path $WorkDir $ZipPath) -DestinationPath $WorkDir -Force
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Copy-Item -Path (Join-Path $WorkDir "friday-obsidian-plugin\*") -Destination $PluginDir -Recurse -Force
```

如果使用 OpenCode，可以让它执行同一件事：

```text
从 https://devops.byd.com/QCSHFW/houshichangjiazhifazhanbu/F.R.I.D.A.Y.git 的 release 分支下载 plugin/friday-obsidian-plugin.zip，解压后把 friday-obsidian-plugin/main.js、friday-obsidian-plugin/manifest.json、friday-obsidian-plugin/styles.css 复制到 D:\Obsidian\MyVault\.obsidian\plugins\friday-obsidian-plugin。不要修改其他文件。
```

## 3. 第一次怎么用

1. 启用插件后，打开 FRIDAY 工作台。默认会出现在 Obsidian 侧边栏，也可以从命令面板打开。
2. 选择一个文件夹作为当前项目。这个文件夹就是 FRIDAY 的默认工作范围。
3. 配置模型：填写 API 地址、模型名称和 API 密钥。模型配置完成后，先做一次连通测试。
4. 从一个小任务开始，例如：

```text
总结当前笔记，并列出三个行动项。
```

```text
检查这个项目文件夹里最需要补充说明的地方。
```

```text
把这篇笔记整理成更清楚的结构，不要直接覆盖原文。
```

第一次使用时可以先不配置 Git 和自动同步。只要当前项目和模型可用，就可以开始对话。

## 4. 开发者视角

FRIDAY 是一个桌面端 Obsidian Community Plugin，入口是 `main.ts`，构建后输出 `main.js`、`manifest.json` 和 `styles.css`。

技术栈：

- TypeScript
- npm
- esbuild
- Obsidian Plugin API

常用命令：

```bash
npm install
npm run dev
npm run build
npm test
npm run lint
```

主要目录：

| 路径 | 说明 |
| --- | --- |
| `src/` | 插件源码 |
| `scripts/` | 构建、发布和生成脚本 |
| `plugin/` | 当前发布链路生成的插件产物 |

开发者改完代码后，至少运行 `npm run build`。如果改动涉及运行时、设置、同步或工具链，再运行 `npm test`。
