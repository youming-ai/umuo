---
name: umuo.app
description: macOS AI 翻译工具 umuo 的官网——排成一本双语对照本
colors:
  paper: "#fcf9f5"
  paper-shade: "#f4ece1"
  paper-white: "#ffffff"
  ink: "#2a1f1a"
  ink-soft: "#5c4638"
  ink-faint: "#7d6252"
  otter-coffee: "#a8734d"
  otter-coffee-deep: "#7e5236"
  otter-coffee-lift: "#8c5d3f"
  otter-coffee-edge: "#553620"
  cheek-cream: "#efd9bd"
  rule: "#e6dccf"
  rule-strong: "#cdbba7"
  logo-water: "#0a84ff"
typography:
  display:
    fontFamily: "Open Sans, -apple-system, PingFang SC, Hiragino Sans, Apple SD Gothic Neo, sans-serif"
    fontSize: "clamp(2.25rem, min(4.4vw, 8svh), 4.25rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Open Sans, -apple-system, PingFang SC, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Open Sans, -apple-system, PingFang SC, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Open Sans, -apple-system, PingFang SC, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  keycap:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1
rounded:
  tag: "4px"
  keycap: "5px"
  control: "6px"
  button: "1rem"
  popover: "8px"
  card: "10px"
  demo: "12px"
spacing:
  gutter-mobile: "20px"
  gutter: "24px"
  page-max: "76rem"
  nav-height: "4rem"
  button-height: "3.5rem"
  press-depth: "4px"
components:
  button-solid:
    backgroundColor: "{colors.otter-coffee-deep}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.button}"
    padding: "0 28px"
    height: "3.5rem"
  button-solid-hover:
    backgroundColor: "{colors.otter-coffee-lift}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.otter-coffee-deep}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "3rem"
  keycap:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.keycap}"
    rounded: "{rounded.keycap}"
    height: "22px"
  tag:
    textColor: "{colors.otter-coffee-deep}"
    rounded: "{rounded.tag}"
    padding: "1px 6px"
  demo-panel:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.demo}"
  demo-switch:
    backgroundColor: "{colors.paper-shade}"
    textColor: "{colors.ink-faint}"
  demo-switch-active:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink}"
---

# Design System: umuo.app

## Overview

**Creative North Star: "对照本"**

官网排成一本双语对照本：暖白纸面、咖啡色墨字，原文与译文像左右两页一样并排。产品大部分时间藏在快捷键背后，
所以页面不靠插画或渐变制造气氛，而是把**真实的键位、真实的选区、真实的前后对照**当作主角。

颜色只取 logo 里那只水獭：皮毛咖啡、耳朵深咖、眼鼻墨色、脸颊奶油。logo 底色的蓝只留在 logo 图里，界面不用蓝。
组件气质是 **Mac 原生的克制**，只有桌面上的下载按钮例外：沿用「节拍」设计语言的**厚底可按压**（多邻国式）。底部是实心厚边，悬停时微微上抬，按下时下沉，一眼就知道能按。
键帽像真键盘；分隔靠细线和装订线，不靠卡片墙。
全站只有首页一屏、不滚动。手机上更进一步，只留文字与一个按钮（见 Layout › 手机端）。

**Key Characteristics:**
- 暖纸 + 咖啡墨的单色系，靠明度与线条分层，不靠第二种色相
- 左对齐的文字，居中铺满的页面网格（最宽 76rem）
- 区块头像书的章首：标题在左，描述在右
- 自发动效只有两处，都只在加载时演一次：首屏按块进场，随后译文逐字流出（见 Motion）
- 浅色 / 深色 / 高对比三套主题共用同一组语义令牌

## Colors

单一暖色系：纸、墨、咖啡三层，强调靠加深而不是换色。

### Primary
- **水獭咖啡 Otter Coffee** (`otter-coffee`)：皮毛色。用于装饰性线条，例如演示面板顶部的书脊线、键帽底边、焦点框、截图模式的虚线框。
- **耳朵深咖 Otter Coffee Deep** (`otter-coffee-deep`)：唯一的「行动色」。实心下载按钮的底色、当前演示模式键帽的字与底边、「开发中」「预览版」标签的字。在纸面上对比约 6:1，可以直接承载文字。
- **抬起深咖 Otter Coffee Lift** (`otter-coffee-lift`)：实心按钮悬停时的底色，比常态略亮，像按钮被抬起。
- **厚边深咖 Otter Coffee Edge** (`otter-coffee-edge`)：实心按钮底部 4px 厚边，比底色深一档，表现按钮的厚度。

### Neutral
- **暖纸 Paper** (`paper`)：全站底色。
- **纸背 Paper Shade** (`paper-shade`)：演示的选项卡底条、底部提示条这类「次一级纸面」，以及语言菜单的当前项。
- **白页 Paper White** (`paper-white`)：浮起的内页：演示面板、浮窗、键帽、次按钮。
- **咖啡墨 Ink** (`ink`)：正文与标题。取自水獭眼鼻。
- **淡墨 Ink Soft** (`ink-soft`)：副文、导读段落、原文。
- **浅墨 Ink Faint** (`ink-faint`)：注释、页脚、未选中的演示模式。在纸背色上 4.79:1，已经是能承载小字的下限，不要再调浅。
- **细线 Rule / 粗线 Rule Strong** (`rule`, `rule-strong`)：分隔线、边框、字符网格。
- **脸颊奶油 Cheek Cream** (`cheek-cream`)：文字选区与演示中「被选中的原文」底色。

### Logo only
- **Logo 水蓝** (`logo-water`)：只存在于 logo 图（`LogoMark`、`public/favicon.svg`）。界面任何地方都不引用它。

### Themes
深色主题把纸换成深咖啡（`#181310` 起），墨换成奶油（`#f4e6d2`），强调色提亮为 `#c48d65` / `#e0b48f`，
实心按钮改成浅咖底配深色字（`#c48d65` / `#1c140f`）。高对比主题用纯黑底、白字、`#ffbe8a` 强调。
所有颜色都通过 `apps/web/src/styles/app.css` 的语义变量（`--paper`、`--ink`、`--accent`、`--accent-strong`、`--button-fill` 等）切换，组件不写死色值。

### Named Rules
**The No-Blue Rule.** 界面里不出现蓝色。蓝是 logo 的水，不是 umuo 的墨。
**The One Action Color Rule.** 深咖是唯一的行动色，一屏之内实心深咖按钮只有一个。
**The Token-Only Rule.** 组件只引用语义变量，三套主题才能同时成立。

## Typography

**Display Font:** Open Sans（自托管可变字体 400–700，回落 -apple-system）
**Body Font:** Open Sans，中日韩字形由系统字体补齐（PingFang SC/TC、Hiragino Sans、Apple SD Gothic Neo）
**Label/Mono Font:** 键帽用系统 UI 字体，让 ⌃ ⌥ ⌘ 与 macOS 的写法一致

**Character:** 一款字体贯穿全站，靠字重与字号拉开层次；人文无衬线在中日韩系统字体旁边不抢戏。

### Hierarchy
- **Display**（600，`clamp(2.25rem, min(4.4vw, 8svh), 4.25rem)`，1.08）：首屏主标题（页面上唯一的标题），随视口高度缩放，保证一屏放下。中日文在文案里用换行符指定断点。
- **Lead**（400，1.1875rem，1.6，最宽 34em）：标题下的导读。
- **Body**（400，1.0625rem，1.6）：全站基准字号；首屏里的演示原文、译文与下载说明在它上下按视口收放。
- **Label**（500，0.875rem）：演示模式名、系统要求这类元信息。

### Named Rules
**The One Family Rule.** 只用自托管或系统字体，不引 Google Fonts 等外部字体服务。
**The Weight-Not-Color Rule.** 强调靠字重和字号，不用渐变字，也不只把标题里的某个词单独染色。

## Layout

页面网格居中，最宽 76rem，左右留白 24px（手机 20px）；文字一律左对齐。页眉高 4rem，透明地压在内容上。

首页恰好一屏：页面最小高度 `100svh`（iOS Safari 工具栏展开时的可见高度，桌面上等于 `100vh`），主内容吃掉页脚以外的高度，首屏垂直居中。左栏标题与下载（5fr），右栏演示面板（6fr），间距 `clamp(2rem, 5vw, 5.5rem)`。
640–1023px（Mac 半屏）仍是左右两栏；639px 以下的窄窗口改为单栏并收紧纵向节奏，演示照常显示。
改动首页后要在 1280×720 与 390×844 下确认 `scrollHeight` 不超出一屏。

### 手机端
手机（触屏，`(hover: none) and (pointer: coarse)`，与「复制网址」出现的条件相同）只留文字与一个按钮：
页眉 logo + 「umuo」与 GitHub 图标，主体是标题、导读、「请在 Mac 上打开 umuo.app 下载」与「复制网址」，页脚版权与语言 / 主题切换。
演示面板与字符网格照常预渲染（桌面和手机是同一份 HTML，hydrate 才一致），手机上由 CSS 隐藏；logo 不加投影，页脚不画上边线。
手机端不按视口高度分档：标题 `clamp(2rem, 9.5vw, 2.5rem)`、导读 1.0625rem，间距用定值，390×844 与 375×667 都能一屏放下。
平板（iPad）也命中这条件，同样只显示文字与按钮。

## Elevation & Depth

以纸面分层为主，阴影只用在演示面板与桌面上的 logo，像纸上放着一张卡纸；手机上不用阴影。按钮的厚度不靠阴影，靠底部实心厚边（`--press-depth`）。
阴影都带向下偏移和柔和模糊，色调取咖啡墨，不发光。

### Shadow Vocabulary
- **纸上卡纸**（`0 1px 0 var(--rule), 0 26px 52px -32px rgb(42 31 26 / 0.28)`）：演示面板。
- **浮窗**（`0 14px 30px -18px rgb(126 82 54 / 0.22), 0 8px 20px -14px rgb(42 31 26 / 0.25)`）：演示里的翻译浮窗。
- **键帽**（`0 1px 0 rgb(42 31 26 / 0.06)` + 2px 咖啡底边）：键帽的厚度主要靠底边表现。

### Named Rules
**The Flat Paper Rule.** 区块和列表不加阴影，用细线分隔。

## Motion

动效是用来交代「发生了什么」的，不是装饰：快、短、只动一次。手法参考 recent.design 的克制（短时长、一条缓动、只动合成属性），外观仍是对照本自己的。

### Tokens
定义在 `apps/web/src/styles/app.css` 的 `:root`，三套主题共用；组件只引用令牌，不写死毫秒数与曲线。

| 令牌 | 值 | 用在哪 |
| --- | --- | --- |
| `--dur-fast` | 120ms | 颜色、底色、边框这类状态变化；按钮的抬起与下沉 |
| `--dur-base` | 180ms | 出现与消失、图标交叉淡化、缩放按压、箭头转向、菜单展开、场景切换 |
| `--dur-enter` | 520ms | 首屏进场（每块） |
| `--stagger` | 70ms | 首屏进场相邻两块的间隔 |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | 默认缓动，所有状态过渡 |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | 进场：起步快、收尾长 |

切换主题 / 语言的整页淡化是 180ms、`--ease-out`（`::view-transition-*` 上写的是同值的字面量）。

### 自发动效（加载时各演一次）
1. **首屏进场**：标题 → 导读 → 下载区 → 演示面板，依次间隔 70ms 浮上来。文字是淡入 + 上移 10px + 4px 模糊收清，面板只淡入 + 上移 14px。最晚 730ms 收完。
2. **译文逐字流出**：900ms 起，每字 45ms（`Hero.tsx` 的 `FIRST_STREAM_DELAY` 要晚于进场结束）。

页眉、页脚、字符网格不参与进场：它们是版面的框，框先在，内容再到。标题整块进场，不拆成逐字或逐词，「逐字」留给译文。

### 访客触发的动效
- **下载按钮**：厚底抬起 / 下沉（见 Buttons）；悬停时下载箭头下探 2px。
- **「接下来」三步**：点了下载后标题先到，三步各隔 60ms 跟上（淡入 + 上移 6px，360ms）。
- **复制网址**：按下缩到 0.97；成功后图标由「复制」交叉淡化成对勾（缩放 0.5 → 1 + 2px 模糊），文字淡入换成「已复制」，2 秒后回到原样。按钮宽度取两种文案里较长的一种，不跳。
- **语言菜单**：从触发按钮一侧展开（淡入 + 4px 位移 + 0.97 缩放，180ms），箭头转 180°；收起不做动画，立即消失。
- **切换主题 / 语言**：View Transitions 整页交叉淡化 180ms（`lib/transition.ts`）；不支持的浏览器直接切换。
- **演示切换**：新场景淡入 + 上移 4px，随后译文重新流出。
- **页眉 GitHub 图标**：悬停换色，按下缩到 0.92。

### Named Rules
**The Composite-Only Rule.** 只动 `opacity`、`transform`、`filter`，不动会引起重排的属性（厚底按钮的 `border-bottom-width` 是唯一例外，它被同步的位移抵消，外框不动）。进场不占位、不改尺寸，首屏不产生布局跳动。
**The Once Rule.** 自发动效只在加载时演一次，不循环、不随滚动重播；光标闪 6 下就停。
**The 200ms Rule.** 访客触发的反馈在 200ms 内给出结果；只有进场可以更长。
**The Hover-Is-Color Rule.** 悬停只换颜色，位移留给按下。例外只有厚底下载按钮（抬起 1px）和它的箭头。
**The Instant Focus Rule.** 焦点框立即出现，不做过渡。
**The Reduced Motion Rule.** `prefers-reduced-motion: reduce` 时所有 animation 与 transition 关闭，位移、缩放、模糊一并去掉，整页淡化也跳过（CSS 与 JS 各守一道）；状态变化照常发生，只是瞬时完成。

## Shapes

小圆角，按「越大的东西圆角越大」递增：标签 4px、键帽 5px、控件 6px、浮窗 8px、卡片 10px、演示面板 12px、按钮 16px。
不用胶囊形。线条语言是全站的骨架：1px 细线分隔，2–3px 咖啡线标出书脊与装订处，虚线只用来表示截图框选。

## Components

### Buttons
**「节拍」厚底可按压**（多邻国式）。所有变体的几何只写一条共享规则，变体只声明颜色；新增变体请加进那条选择器列表，不要复制几何。

- **Shape:** 圆角 16px（`--radius-button`），高 3.5rem，左右 28px，字重 700，字距 0.025em；2px 边框，底边加厚到 4px。不转大写，因为五种语言里有四种是中日韩文字。
- **Press tokens:** `--press-depth` 4px（厚边）、`--press-depth-active` 1px（按下后剩下的厚度）、`--press-lift-hover` -1px（悬停上抬）、`--press-lift-active` 3px（按下下沉）。只定义一次，与主题无关。
- **Solid（主行动）:** 深咖底、白字、更深一档的咖啡厚边（`--button-edge`）；悬停时底色变亮并上抬，按下时下沉、厚边收窄。全站只用于下载。
- **Secondary（普通按钮，不在厚底规则里）:** 透明底、1.5px 深咖描边、深咖字，6px 圆角（`--radius-control`），高 3rem；没有厚边与位移，悬停 / 按下铺一层淡咖底，按下时整体缩到 0.97。只用于手机上的「复制网址」：左边带一枚图标，复制成功时换成对勾（见 Motion）。
- **Ghost:** 没有厚边，用于页脚的语言 / 主题切换；悬停时铺淡咖底，按下时下沉 1px。
- **Pending:** 安装包还没发布时，按钮不变灰、不响应按压，靠里面的状态标签说明。
- **Reduced motion:** 所有按钮去掉位移、缩放和厚边收窄，保留颜色反馈。
- **Focus:** 2px 咖啡色描边，外扩 3px，立即出现、不做过渡。

### Download Panel
首页的下载区（`DownloadPanel`）：实心下载按钮（带「预览版」状态标签）、系统要求、未公证预览版的放行说明。按钮旁不放说明句，源码入口只在页眉右侧。
触屏设备（`hover: none` 且 `pointer: coarse`）拿不到能用的 Mac 安装包，换成一句「请在 Mac 上打开 umuo.app」加「复制网址」普通按钮。两套都预渲染，由 CSS 显示其中一套。
点了下载之后，系统要求与放行说明就地换成「下载已开始，接下来」三步：拖进应用程序、被拦截时怎么放行、选供应商填 Key。
触屏上复制成功显示「已复制」2 秒后复原；失败时要说出来，并给出手动记下的网址（失败提示不自动收起）。
窄窗口里日文、英文的下载按钮放不下一行时允许折行，不被容器裁掉。

### Keycap
像真键盘：白页底、粗细线边框、2px 咖啡底边、5px 圆角，用系统字体写 ⌃ ⌥ ⌘。首页只用在演示选项卡里，是 22px 的小号（`keycap-xs`）；≤1023px 宽时选项卡不显示键位。
当前模式的键帽换成咖啡色边框加深咖字。

### Tag
淡咖底、混了咖啡色的细边框、深咖字、4px 方角，12px 字。用来标「开发中」「预览版」这类状态。不做胶囊，也不放在标题上方当眉题。

### Demo Panel（招牌组件）
首屏右侧的对照演示：白页内页、顶部 3px 咖啡书脊线、12px 圆角、纸上卡纸阴影。

- **书签式选项卡**在面板顶部一行排开，顺序是划词翻译、闪电替换、截图翻译、语音输入，默认第一项。每项两行：上面名称，下面小键帽（开发中的功能显示标签而不是键位）。当前项是白页、压住下边线和舞台连成一体，其余退到纸背色。标准 `tablist`：只有当前项可 Tab 进入，←/→ 循环、Home/End 到头尾，切换即选中。
- **舞台**：四个场景叠在同一格里，只显示当前一个，舞台高度始终等于最高的场景，切换时页面不跳。闪电替换是同一个输入框里原文划掉、译文写在下面，下附一行安全边界；语音输入下附「开发中」说明。译文逐字流出，末尾跟一个咖啡色光标；再点一次当前项会重新流出；尊重 reduced-motion。
- **底部提示**随当前模式变化，告诉访客怎样在这个页面上亲手试。
- **响应式**：≤1023px 选项卡只留名称，「开发中」标签缩成名称后的小圆点；≤639px 宽时单栏、字号收一档，不按高度分档。手机（触屏）上整个演示不显示。
- **光标**闪 6 下就停，不在流式结束后一直闪。

### Language Grid
首屏背景是由多种文字组成的字符网格，透明度 0.13（深色主题 0.1），只保留上下边缘，像对照本的页眉页脚。手机（触屏）上不显示。
指针附近亮起一圈加深的咖啡色聚光，这是访客触发的效果，不算自发动效。

### Navigation
左边是 logo 加小写字样「umuo」（桌面上 logo 带一层纸上投影，手机上不带），右边是 GitHub 标志图标（`GitHubIcon`，24px、44px 圆形点击区，`text-secondary`，悬停转 `text-primary`，`aria-label="GitHub"`，占原「免费与开源」的位置）；页眉高度固定 4rem。GitHub 链接只在仓库公开（`SOURCE_PUBLIC`）时出现，是站内唯一的源码入口；首页下载旁不放说明句。

### Footer
页脚只有一行：左边版权「© 2026 umuo」（`ink-faint` 小字），右边语言与主题切换（Ghost）。语言菜单向上展开，切换语言或主题时整页短淡化（见 Motion）。不放条款、隐私、源码与联系邮箱链接，也不重复下载 CTA。

## Do's and Don'ts

### Do:
- **Do** 用语义变量（`--accent-strong`、`--button-fill`、`--select`…），保证浅色、深色、高对比三套主题都成立。
- **Do** 桌面上的下载按钮用厚底按压：底部实心厚边，悬停上抬 1px，按下下沉 3px、厚边收窄到 1px；手机上的「复制网址」是普通描边按钮。
- **Do** 用真实键位和真实前后对照来展示产品，不用示意插画。
- **Do** 用细线和装订线组织信息；标题在左、描述在右，像书的章首。
- **Do** 改动首页后在 1280×720 与 390×844（手机另看 375×667）下检查是否仍在一屏内，并抽查日文、韩文：韩文标题与导读用 `keep-all` 按词断行。
- **Do** 让自发动效只保留加载时的首屏进场与随后的译文逐字流出，各演一次；其余动效都由访客触发，并尊重 `prefers-reduced-motion`。
- **Do** 新增动效时只引用 `--dur-*` / `--ease-*` 令牌，只动 `opacity` / `transform` / `filter`。

### Don't:
- **Don't** 在界面里用蓝色；`#0A84FF` / `#5FB2FF` 只属于 logo 图。
- **Don't** 加回深色光晕或渐变、胶囊形眉题标签、标题里单独上色或用渐变的某个词、`A · B · C` 式的中间点分隔。
- **Don't** 做千篇一律的圆角卡片墙，也不要加没有信息量的 01 / 02 / 03 编号。
- **Don't** 引入外部字体服务，也不要在 Open Sans 之外再加一款展示字体。
- **Don't** 用胶囊形按钮或胶囊形标签；按钮圆角固定 16px。
- **Don't** 用模糊阴影或发光表现按钮的厚度，厚度只靠底部实心边。
- **Don't** 加循环动画、滚动触发的动画、视差、自定义光标，或把标题拆成逐字进场；也不要为动效引入动画库。
