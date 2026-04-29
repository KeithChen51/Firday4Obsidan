# FRIDAY 视觉识别标准

## 品牌理念

FRIDAY 是一个以 Obsidian 为中心的本地 AI 工作伙伴。它应该给人的感觉是安静、可靠、低侵入。视觉识别不把 AI 表现成一个强势的主脑，也不把产品包装成需要用户迁就的新系统，而是表达一种稳定的工作层：帮助用户收拢上下文、整理知识、减少摩擦，并始终把判断权和控制权留给用户。

FRIDAY 的价值不在于展示“AI 很强”，而在于让工作变得更从容。它应该理解用户已经建立的笔记结构、项目脉络和上下文线索，在重复、低价值或易遗漏的环节提供帮助；但在判断、取舍、写作表达和最终决策上，始终把用户放在前景。视觉系统的克制不是保守，而是为了避免产品在长期使用中变成新的干扰源。

标志采用 Double Shell Frame 双层框架结构。后方框架暗示保护壳、连续性和后台能力；前方框架暗示用户真正触达的、有秩序的工作空间。外壳与内核的关系对应产品结构：用户看到的是轻量入口和自然衔接，系统背后承担本地知识同步、版本管理、上下文组装和自动化执行。

F 不是一个单独放入框架的字母，而是由前景框架和中段结构自然形成。这个结构表达 FRIDAY 的工作方式：把分散材料压缩成可理解的结构，让复杂能力退到背后。任何后续图标、页面、物料或宣传图，都应保留这种“结构中生成识别”的逻辑，不把 FRIDAY 处理成高调接管工作的 AI 符号。

品牌判断可以归纳为四点：

- FRIDAY 是协作者，不是替用户做决定的代理人。
- FRIDAY 是系统入口，不是炫技舞台。
- FRIDAY 是本地知识伙伴，不是云端黑箱。
- FRIDAY 应该安静但可识别，专业但不冰冷，有能力但不表演。

## 标志系统

### 主图标

主图标是带有 Muted Teal 功能色方块的 Double Shell Frame。适用于产品侧边栏、应用标题栏、插件列表、系统托盘、文档图标等已经能从上下文识别 FRIDAY 的场景。

源文件：`logo/friday-icon.svg`

### 横向组合

横向组合由主图标和 FRIDAY 字标构成。适用于文档封面、官网区域、发布物料、引导页和需要明确品牌名称的位置。

源文件：

- `logo/friday-logo.svg`
- `logo/friday-logo-reversed.svg`

### 上下组合

上下组合适用于方形或竖向版式。当横向组合过宽、缩小后识别度下降时，优先使用上下组合。

源文件：`logo/friday-logo-stacked.svg`

### 系统图标与 Tile

Tile 版本用于应用图标、插件市场、系统入口和需要固定方形容器的导出场景。

源文件：

- `logo/friday-app-tile-rounded.svg`
- `logo/friday-plugin-tile-square.svg`
- `logo/friday-favicon.svg`

## 几何结构

标志由填充轮廓构成，不依赖 stroke 描边。这样可以避免不同浏览器、操作系统和导出工具对描边渲染的差异，让小尺寸和大尺寸下的轮廓都保持稳定。

圆角分为两套逻辑：

- 外层轮廓：8 px 圆角逻辑。
- 内部开口与结构切入：6 px 圆角逻辑。

主图标使用 `viewBox="-8 -8 128 150"`，用于保留导出安全边距。紧凑图标使用 `viewBox="0 0 112 134"`，只适合在外部系统能精确控制留白时使用。

## 字体规范

### 英文字标

当前横向组合中的 FRIDAY 字标使用 SVG 文本，字体栈为：

`Avenir Next, Inter, Segoe UI, Arial, sans-serif`

当前参数：

- 字重：600
- 横向组合字号：44
- 横向组合字距：18
- 上下组合字号：34
- 上下组合字距：14

设计基准是 Avenir Next。选择它的原因是：它介于几何无衬线和人文无衬线之间，结构清晰但不冷硬，圆弧和开口带有轻微的亲和感，和 Double Shell Frame 的稳定几何相互匹配。大字距让 FRIDAY 不像一个强势的技术品牌口号，而更像一个安静、克制、可长期使用的系统入口。

需要注意：当前 SVG 仍保留文本层。如果设备没有 Avenir Next，渲染可能回退到 Inter、Segoe UI 或 Arial。正式发布、印刷、官网主视觉和应用商店物料中，建议将字标转为轮廓，避免不同设备造成字形漂移。

### 英文界面字体

英文界面、英文标题和英文说明可以使用以下字体栈：

`Avenir Next, Inter, Segoe UI, Arial, sans-serif`

英文标题使用 500-650 字重，避免过重。界面正文使用 400-500 字重。品牌页或说明页可以保留适度字距；产品 UI 中不要大面积使用宽字距，以免降低阅读效率。

### 中文品牌字体

中文不建议直接使用过于机械的默认黑体来承担品牌标题。FRIDAY 的中文视觉应该有“知识工作”“笔记”和“长期写作”的温度，同时保持克制，不走书法化或装饰化。主视觉中文字体确定为霞鹜文楷方向。

推荐中文品牌标题字体栈：

`LXGW WenKai Screen, LXGW WenKai, Noto Serif SC, Noto Serif CJK SC, Source Han Serif SC, STFangsong, FangSong, serif`

推荐使用范围：

- 品牌标题
- 文档封面标题
- VI 说明页标题
- 少量强调语句

选择理由：霞鹜文楷比默认黑体更有书写感和人文温度，能把 FRIDAY 从单纯效率工具拉回到“本地知识伙伴”和“长期写作环境”。它的笔画不如传统楷体夸张，屏幕版在小尺寸下也更稳，因此适合作为品牌手册、中文标题、封面和叙述性文案的主要声音。Noto Serif / 思源宋体只作为回退，不再作为中文主视觉优先级。

使用限制：

- 大标题优先使用 `LXGW WenKai`，屏幕中小标题优先使用 `LXGW WenKai Screen`。
- 不在按钮、表格、设置项、状态提示和密集列表中强行使用文楷。
- 不使用系统楷体作为主要回退，以免品牌显得过度书法化。

### 中文正文与产品 UI 字体

中文正文分为“品牌叙述正文”和“产品 UI 正文”两层，不再混用一个规则。

品牌叙述正文推荐字体栈：

`LXGW WenKai Screen, LXGW WenKai, Source Han Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif`

适用于品牌手册、视觉说明、长段理念文字和周边物料说明。正文颜色不宜使用满值 Graphite，建议使用 72%-82% 墨色，避免长文显得压迫。

推荐中文正文与 UI 字体栈：

`MiSans, HarmonyOS Sans SC, Source Han Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif`

使用原则：

- 产品 UI、设置项、列表、表格、说明文字使用现代无衬线。
- 文档长文正文优先使用霞鹜文楷 Screen；当排版密度较高或字号低于 14px 时，切回现代无衬线。
- Windows 默认环境下可以回退到 Microsoft YaHei UI，但不要把它作为品牌标题的首选。
- 中文标题和品牌叙述可以使用霞鹜文楷，插件内部操作界面仍以系统 UI 字体为准。

### 等宽字体

代码、文件名、路径和版本号使用：

`SFMono-Regular, Cascadia Mono, Consolas, Liberation Mono, monospace`

等宽字体只用于技术信息，不作为品牌气质的主要来源。

## Obsidian 插件内使用规范

FRIDAY 在 Obsidian 里的品牌露出要比文档和官网更克制。插件界面的第一目标是降低认知摩擦，因此侧边栏、小图标和对话头像都应优先使用图标标识，不在小尺寸环境里强行加入字标。

### 侧边栏与 Ribbon 图标

- 使用自定义 `friday-double-shell` 图标，形态来自主图标的 Double Shell Frame 单色化版本。
- 默认尺寸遵循 Obsidian Ribbon 规范，视觉目标为 18-20 px。
- 使用 `currentColor`，让图标跟随 Obsidian 主题的普通图标颜色。
- 不在 Ribbon 图标中使用 Muted Teal 小方块，避免 16-20 px 下产生脏点或误读。
- 不使用 `cpu`、`bot`、`sparkles` 等通用 AI 图标替代 FRIDAY 标识。

### 页面内小图标

- 工作台、页面标题、状态摘要和设置标题附近的小图标使用同一 `friday-double-shell` 图标。
- 推荐尺寸为 16-22 px，和文字基线居中对齐。
- 当同一区域已经出现 FRIDAY 字标时，小图标只承担识别锚点，不再重复添加完整横向组合。
- 小图标应保持单色，功能色只留给选中态、状态点或系统响应。

### 对话头像

- FRIDAY assistant 头像使用 22-28 px 圆角方形容器，内部放置单色 Double Shell 图标。
- 圆角建议为 6 px，和标志内部圆角逻辑一致，避免使用完全圆形头像。
- 对话头像不使用文字、emoji 或通用机器人图标。
- 用户头像保留用户身份，不使用 FRIDAY 标志。
- 深色主题下头像容器可使用 Obsidian 的次级背景色，图标跟随 `currentColor`。

### 插件内字标

- 插件 UI 中的品牌字样统一写作 `FRIDAY`，不再写作 `F.R.I.D.A.Y`。
- 工作台页头、设置标题和 assistant 角色名使用英文字标字体栈：`Avenir Next, Inter, Segoe UI, Arial, sans-serif`。
- 字标建议使用 600 字重、0.14-0.18em 字距，并保持全大写。
- 不再内嵌或加载装饰性字库。插件应依赖系统字体栈，避免增加体积和渲染不确定性。
- `F.R.I.D.A.Y/` 作为历史 Vault 目录路径或迁移兼容路径时可以保留，不作为新的界面品牌写法。

## 色彩规范

### 核心色

Graphite `#1E1F21`

用于主标志、字标、核心标题和严肃界面表面。Graphite 应替代纯黑，避免视觉过硬。长正文、卡片说明、表格内容和辅助文字不建议直接使用 100% Graphite，可使用 70%-88% Graphite 透明度或接近 `#4C4D4B` 的柔和墨色。

Warm Bone `#F4F1EB`

用于主要浅色背景、文档底色和反白标志主体。它保留知识工作场景中的温度，但不应发展成米色装饰风格。

Muted Teal `#4A7F7B`

用于标志中的功能色方块、活跃状态、连接提示、链接和系统响应。它是克制的功能色，不是装饰色。

Stone `#D9D5CA`

用于分隔线、次级底色、非活跃 UI 和低层级表面。

Accent `#E07A5F`

只用于警告、重要状态变化或少量编辑性强调。它不是主品牌色。

## 标志颜色使用

浅色背景使用 Graphite 版本。适合 Warm Bone、白色或浅中性色背景。

深色背景使用 Warm Bone 反白版本。适合 Graphite 或足够深的中性色背景。

无论浅色版还是反白版，Muted Teal 功能色应保持不变。只有在单色环境、极小尺寸或技术限制下，才使用单色版本。

## 留白

标志四周最小留白等于 F 中段横条的高度。横向组合需要对整个组合外框应用同样的留白原则。

不要在留白区域内放置文字、图标、边框或复杂图片。

## 最小尺寸

图标：

- 数字环境最小高度：16 px。
- 产品 UI 推荐高度：20 px 到 32 px。
- App Tile 源文件建议 256 px 或更大。

横向组合：

- 数字环境最小宽度：120 px。
- 页眉和品牌物料推荐宽度：160 px 或更大。

极小尺寸场景优先使用 `logo/friday-icon-mono.svg` 或 `logo/friday-favicon.svg`。

## 视觉手册图片水印

视觉手册中的真实摄影图、周边模拟图和场景展示图应统一添加左下角品牌水印。水印用于说明图片归属，不是画面主体，也不替代产品或物料本身的主标志。

推荐规则：

- 位置：图片左下角，距离图片边缘约 2%-3% 宽度。
- 尺寸：横向 FRIDAY 组合宽度约为图片宽度的 10%-14%，最小 104 px，最大 154 px。
- 形式：使用 `logo/friday-logo-reversed.svg`，放入半透明 Graphite 底板。
- 底板：Graphite `#1E1F21`，透明度约 72%-78%，圆角 6 px。
- 留白：底板内部保留 8-10 px 横向留白，避免字标贴边。
- 遮挡：水印不得压住主体产品、产品上的主标志、人物面部、重要纹理或关键信息。
- 一致性：同一组视觉手册图片中，水印位置、尺寸和透明度应保持一致。

当前视觉手册周边图位于 `visual-manual/originals/` 目录，HTML 版通过统一组件为图片叠加水印，避免破坏原始图片。需要把单张图片直接放入 PPT、PDF、发布图或外部文档时，使用 `visual-manual/watermarked/` 中已烘焙官方水印的 PNG。

## 错误用法

不要：

- 拉伸、压扁、倾斜或旋转标志。
- 把 F 重新绘制成一个独立字母放入框架。
- 改变 Graphite、Warm Bone 或 Muted Teal 的色值。
- 添加阴影、发光、渐变、玻璃质感或 AI 风格光效。
- 把标志放在低对比度或复杂图片背景上。
- 把标志轮廓裁成通用圆角方块。
- 用纯黑替代 Graphite。
- 在浅色背景上把所有正文都设为 100% Graphite，导致阅读对比过硬。
- 用高饱和青色、紫色或霓虹色替代 Muted Teal。
- 在中文品牌标题中大面积使用默认黑体，导致视觉过硬。

## 品牌语气

FRIDAY 应该显得：

- 安静，但不是沉默。
- 有能力，但不强势。
- 本地优先，而不是云端依赖。
- 有结构，但不僵硬。
- 有帮助，但不表演。

视觉系统应始终让用户的工作处在前景。FRIDAY 是稳定入口，不是主角。

## 资产索引

源文件以以下资产为准：

- `logo/friday-icon.svg`
- `logo/friday-icon-reversed.svg`
- `logo/friday-icon-mono.svg`
- `logo/friday-icon-tight.svg`
- `logo/friday-logo.svg`
- `logo/friday-logo-reversed.svg`
- `logo/friday-logo-stacked.svg`
- `logo/friday-favicon.svg`
- `logo/friday-app-tile-rounded.svg`
- `logo/friday-plugin-tile-square.svg`

详细 HTML 版说明见 `guidelines/friday-brand-assets-guide.zh-CN.html`。



