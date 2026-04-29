# FRIDAY Logo 资产目录

本目录收录 FRIDAY Double Shell Frame 标识系统的 SVG 源文件。所有文件均为矢量格式，可用于产品界面、文档、插件入口、系统图标和品牌物料。

HTML 版详细说明见 `guidelines/friday-brand-assets-guide.zh-CN.html`，其中包含资产目录、字体、颜色、几何、尺寸、留白、背景、错误用法和导出建议。

## 快速选择

| 使用场景 | 推荐文件 | 说明 |
| --- | --- | --- |
| 默认品牌展示 | `logo/friday-logo.svg` | 横向组合，适合浅色背景、文档页眉、官网区域和发布物料。 |
| 深色背景品牌展示 | `logo/friday-logo-reversed.svg` | 反白横向组合，适合 Graphite 或其他深色底。 |
| 产品界面图标 | `logo/friday-icon.svg` | 带安全边距的主图标，适合侧边栏、标题栏、插件列表。 |
| Obsidian Ribbon 图标 | 插件内 `friday-double-shell` | 单色 `currentColor` 图标，适合 18-20 px 的侧边栏和命令入口。 |
| Obsidian 对话头像 | 插件内 `friday-double-shell` | 22-28 px 圆角方形头像容器内使用单色图标，不使用文字或机器人图标。 |
| 深色界面图标 | `logo/friday-icon-reversed.svg` | 反白图标，适合深色 UI、深色卡片和系统栏。 |
| 单色限制环境 | `logo/friday-icon-mono.svg` | 不使用功能色的单色版本，适合小尺寸或低色彩环境。 |
| 精确排版源文件 | `logo/friday-icon-tight.svg` | 无额外安全边距的紧凑版本，仅用于可控布局系统。 |
| 方形或竖向版式 | `logo/friday-logo-stacked.svg` | 上下组合，适合封面、方形构图和品牌页。 |
| 浏览器标签页 | `logo/friday-favicon.svg` | Favicon 源文件，可导出 16 px、32 px、48 px。 |
| App 图标 | `logo/friday-app-tile-rounded.svg` | 圆角 App Tile，适合桌面入口、启动器和安装图标。 |
| 插件图标 | `logo/friday-plugin-tile-square.svg` | 方形 Plugin Tile，适合插件市场、仓库封面和列表卡片。 |

## 文件清单

### 核心标志

- `logo/friday-icon.svg`  
  主图标。包含安全 viewBox，适合大多数产品和文档场景。

- `logo/friday-icon-reversed.svg`  
  反白主图标。图形本身不带背景，需要放在深色底上使用。

- `logo/friday-icon-mono.svg`  
  单色图标。用于无法稳定显示 Muted Teal 功能色的场景。

- `logo/friday-icon-tight.svg`  
  紧凑裁切版本。用于需要由外部系统控制留白的场景。

### 品牌组合

- `logo/friday-logo.svg`  
  默认横向组合。由主图标和 FRIDAY 字标组成。

- `logo/friday-logo-reversed.svg`  
  反白横向组合。图形本身透明，不内置深色背景。

- `logo/friday-logo-stacked.svg`  
  上下组合。用于方形、竖向或封面式排版。

### 系统与图标出口

- `logo/friday-favicon.svg`  
  浏览器标签页图标源文件。

- `logo/friday-app-tile-rounded.svg`  
  圆角 App Tile。包含 Warm Bone 底与主图标。

- `logo/friday-plugin-tile-square.svg`  
  方形 Plugin Tile。包含 Warm Bone 底与主图标。

## 导出建议

- SVG 作为主源文件保留，不建议转曲后再手动修改。
- PNG 导出建议准备 `1x`、`2x`、`3x` 三档。
- Favicon 建议导出 `16 px`、`32 px`、`48 px`。
- Touch icon 或应用图标建议从 `logo/friday-app-tile-rounded.svg` 导出 `180 px`、`256 px`、`512 px`。
- 用于插件市场或 README 封面时，优先使用 `logo/friday-plugin-tile-square.svg` 或 `logo/friday-logo.svg`。

## 使用原则

- 默认浅色背景使用 `logo/friday-logo.svg` 或 `logo/friday-icon.svg`。
- 深色背景使用反白版本，不要把默认版本直接放到深色底上。
- Obsidian 插件内的小尺寸入口优先使用单色 `friday-double-shell` 图标，跟随主题颜色。
- 插件 UI 内品牌字样统一写作 `FRIDAY`，不再使用 `F.R.I.D.A.Y` 作为界面字标。
- 不要拉伸、旋转、描边、加阴影或重绘标志。
- 不要单独把 F 当作独立字母放入框架，F 必须从框架结构中自然形成。
- 不要替换 Graphite、Warm Bone、Muted Teal 三个核心色。



