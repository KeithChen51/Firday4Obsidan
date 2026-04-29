# FRIDAY 品牌 SVG 资产说明

本文件说明 `brand` 目录中的 FRIDAY Logo SVG 资产。当前版本基于 Double Shell Frame 标识系统：外层框架表达稳定的保护壳，内层框架表达被组织好的工作空间，F 不是单独放入框内的字母，而是由前景框架和中段结构自然形成。

## 目录结构

- `logo/` - Logo、图标、favicon、App Tile 和 Plugin Tile 的 SVG 源文件。
- `guidelines/` - VI 标准、Logo 资产目录和 HTML 品牌系统手册。
- `icon-system/` - FRIDAY 专属 icon system 的探索稿、定稿预览和后续源文件。
- `visual-manual/originals/` - 视觉手册周边与真实场景模拟原图。
- `visual-manual/watermarked/` - 已烘焙左下角品牌水印的视觉手册 PNG。
- `exports/` - 从 SVG 或视觉源文件导出的 PNG、ICO、ICNS 等派生产物。

## 核心文档

- `guidelines/LOGO-ASSET-CATALOG.zh-CN.md` - Logo 资产目录中文版。
- `README.zh-CN.md` - 资产说明中文版。
- `guidelines/FRIDAY-VI-STANDARDS.md` - 品牌 VI 标准文稿。
- `guidelines/FRIDAY-VI-STANDARDS.zh-CN.md` - 品牌 VI 标准文稿中文版。
- `guidelines/friday-brand-assets-guide.zh-CN.html` - FRIDAY Brand System Manual HTML 版，按设计理念、VI 规范、视觉手册、资产目录四个板块组织。

## 核心文件

- `logo/friday-icon.svg` - 浅色背景使用的主图标，已包含安全边距。
- `logo/friday-icon-reversed.svg` - 深色背景使用的反白主图标。
- `logo/friday-icon-mono.svg` - 单色图标，用于系统限制或极小尺寸场景。
- `logo/friday-icon-tight.svg` - 紧凑裁切图标，用于外部系统自行控制留白的场景。
- `logo/friday-logo.svg` - 浅色背景使用的默认横向组合。
- `logo/friday-logo-reversed.svg` - 深色背景使用的反白横向组合。
- `logo/friday-logo-stacked.svg` - 方形或竖向版式使用的上下组合。
- `logo/friday-favicon.svg` - 浏览器标签页图标源文件。
- `logo/friday-app-tile-rounded.svg` - 圆角 App Tile。
- `logo/friday-plugin-tile-square.svg` - 方形 Plugin Tile。

## 标准色

- Graphite：`#1E1F21`  
  主标志、字标、核心标题和严肃界面表面。普通正文可降到 70%-88% Graphite，避免过硬。

- Warm Bone：`#F4F1EB`  
  浅色背景、文档底色、反白标志主体。

- Muted Teal：`#4A7F7B`  
  状态提示、连接感和系统响应的克制功能色。

- Stone：`#D9D5CA`  
  分隔线、辅助底色、低层级界面元素。

- Accent：`#E07A5F`  
  只用于重要提醒或少量强调，不作为主品牌色。

## 几何规则

- 标志由填充轮廓构成，不依赖 stroke 描边。
- 外层框架采用 8 px 的圆角逻辑。
- 内层开口、框架内缘和结构切入采用 6 px 的圆角逻辑。
- 主图标安全 viewBox 为 `-8 -8 128 150`。
- 紧凑图标 viewBox 为 `0 0 112 134`。
- F 必须融入前景框架结构，不应作为独立字母额外放入。

## 字体规范

- 英文字标当前使用 `Avenir Next, Inter, Segoe UI, Arial, sans-serif` 字体栈，设计基准为 Avenir Next。
- Avenir Next 的人文几何气质与双层框架匹配：稳定、清晰，但不冷硬。
- 正式发布、印刷、官网主视觉和应用商店物料中，建议将 FRIDAY 字标转为轮廓，避免不同设备字体回退导致字形漂移。
- 中文品牌标题以 `LXGW WenKai Screen, LXGW WenKai` 为主视觉，回退到思源宋体 / Noto Serif CJK SC，强调写作感、人文温度和长期知识工作的气质。
- 品牌叙述正文可使用 `LXGW WenKai Screen, LXGW WenKai`，正文颜色建议低于满值 Graphite；插件 UI、设置项、表格和小字号说明继续使用现代无衬线。
- 中文产品 UI 使用 `MiSans, HarmonyOS Sans SC, Source Han Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif`。
- 完整字体规则见 `guidelines/FRIDAY-VI-STANDARDS.zh-CN.md` 和 `guidelines/friday-brand-assets-guide.zh-CN.html`。

## 使用建议

- 默认情况下，在 Warm Bone、白色或浅中性色背景上使用 `logo/friday-logo.svg`。
- 在 Graphite 或其他深色表面上使用 `logo/friday-logo-reversed.svg`。
- 当周围已经出现 FRIDAY 名称时，使用 `logo/friday-icon.svg` 即可。
- 当色彩环境受限或尺寸过小时，使用 `logo/friday-icon-mono.svg`。
- 图标建议最小使用尺寸为 `16 px`。
- 横向组合建议最小宽度为 `120 px`。
- 标志四周应保留至少等于 F 中段横条高度的安全空间。
- 视觉手册图片统一在左下角叠加品牌水印：使用 `logo/friday-logo-reversed.svg`，置于半透明 Graphite 底板中，宽度约为图片宽度的 10%-14%。

## 视觉手册图片

`visual-manual/originals/` 目录包含用于 HTML 手册展示的真实摄影质感周边图：

- `friday-merch-mug-black-white.png` - 黑白马克杯。
- `friday-merch-canvas-tote.png` - 帆布袋。
- `friday-merch-notebook.png` - 笔记本。
- `friday-merch-laptop-sticker.png` - MacBook 贴纸。
- `friday-merch-enamel-pin.png` - 胸针。

这些图片在 HTML 手册中通过统一组件添加左下角水印。`visual-manual/originals/` 保留无水印原图，便于后续重新排版或导出不同尺寸版本。`visual-manual/watermarked/` 提供已经烘焙官方水印的版本，可以直接放入 PPT、PDF、发布图或外部文档。

## Obsidian 插件内规范

- 侧边栏 / Ribbon 使用插件注册的 `friday-double-shell` 单色图标，跟随 Obsidian 主题的 `currentColor`。
- 页面内小图标用于工作台页头、状态摘要和设置入口，推荐 16-22 px。
- 对话中的 FRIDAY assistant 头像使用 22-28 px 圆角方形容器，内部放置单色 Double Shell 图标；用户头像不使用 FRIDAY 标志。
- 插件 UI 内品牌字样统一写作 `FRIDAY`，不再使用 `F.R.I.D.A.Y` 作为界面字标。
- 工作台页头、设置标题和 assistant 角色名使用 `Avenir Next, Inter, Segoe UI, Arial, sans-serif` 字体栈，不再内嵌装饰性字库。
- `F.R.I.D.A.Y/` 作为历史 Vault 目录或迁移兼容路径时可以保留。

## 禁止事项

- 不要拉伸、压扁、倾斜或旋转标志。
- 不要改变图标和字标之间的比例关系。
- 不要添加投影、发光、渐变、描边或玻璃质感效果。
- 不要使用未经批准的颜色替换 Graphite 或 Muted Teal。
- 不要把反白版本放在浅色背景上。
- 不要把默认版本直接放在深色背景上。
- 不要重新绘制 F，或把 F 当作独立字母塞进框架。

## 版本备注

当前资产为 FRIDAY Double Shell Frame 标识系统的 SVG 源文件版本。后续如需导出 PNG、ICO、ICNS 或应用商店图标，应以本目录中的 SVG 为唯一源文件。



