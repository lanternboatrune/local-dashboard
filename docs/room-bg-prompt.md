# perf-console 房间底图 · 提示词（正面平视剖面 / 直播背景风）

> 状态：定稿，待出图。
> 变更：2026-11-06 由「原神式一点透视」改为「正交正面剖面」，理由：需要和立绘同层平贴、右侧压 UI，透视房间贴进圆角面板会显得"陷进去"。
> 出图后：压成 1920×1080 → WebP q82 → `plugins/perf-console/assets/room.webp`。

## 一、结构锚点（这张图的"规矩"）

| 项 | 约定 |
|---|---|
| 视角 | 正面平视剖面，正交投影，**无灭点** |
| 墙面 | 背墙整面正对镜头；天花板只露一条横梁 |
| 家具 | 全部正面朝镜头，只能看到极窄的顶面 |
| 地板 | 只露一条横带（底部 10%–16%），板缝平行于画面 |
| 窗 | 横向 0–28%，画在背墙上（示意性光照，不追求物理正确） |
| 书桌 | 42–62%，桌沿水平 |
| 书架 | 66–84%，到顶、正面 |
| 床 | 86–100%，只露靠墙一段 |
| **角色位** | 横向 30%，脚底 88%，该处地面必须干净 |
| 右侧 | 保留细节，明度中低，避免大块纯白 |

## 二、主提示词（中文）

> 2D 二次元直播背景风格的房间插画，纯正面平视剖面视角，像把一间房的正面墙整面拆掉；正交投影，没有透视、没有灭点，墙线、木板缝、家具边全部平行于画面，所有家具正面朝镜头，几乎看不到桌面俯视面。
>
> 一间温暖慵懒的木质单间卧室兼书房。画面最上方约 8% 是一条横向木梁，梁下垂两盏暖黄小吊灯；梁下是整面奶油色细竖条纹墙纸的木墙。
>
> 画面左侧 0–28%：一整面木框大窗，白色薄纱帘在两侧束起，窗台上摆龟背竹、垂下来的绿萝、几摞旧书和一只白瓷杯；窗外用简化色块画明亮天空与远处树影。午后金色阳光从窗口斜射，在右侧墙面上投下窗棂的格状光影，并在地板上拉出一条斜向暖色光带。
>
> 画面中部 42–62%：一张正对镜头的原木书桌，桌沿是一条水平线，桌上从左到右摆着机械键盘、摊开的笔记本、马克杯、黄铜台灯；木椅正面朝外，推入桌下三分之一。
>
> 画面右侧 66–84%：到顶的正面木书架，书脊高低错落、留几格空，架顶摆一盆垂吊绿萝；书架与窗之间的墙上钉一块软木板，贴满无字便签，旁边一只圆形挂钟。
>
> 画面最右 86–100%：铺白色被褥的床，只露出靠墙的一段，床头有枕头和搭着的毛毯。
>
> 画面底部 10–16%：横向暖棕木地板带，木板缝平行于画面，上面铺一块横向长方形的米色绒面地毯，边缘柔和。
>
> 角色站位在横向 30% 处，脚底落在木地板带上（约画面高度 88%），此处地毯与地板保持干净，不要放家具、花盆或任何高对比物件。
>
> 配色与质感：蜂蜜金木、奶油白墙、赭色地毯、鼠尾草绿植物，暗部掺少量冷紫灰；平涂色块＋硬边阴影＋干净描线，木质与布料有轻微手绘笔触；整体扁平，不要泛光、不要镜头光晕、不要景深虚化、不要任何文字。
>
> 画面中没有任何人物、手、剪影或动物。

## 三、主提示词（English）

> 2D anime stream-background style room illustration, pure front-facing elevation view, as if the front wall of a single room has been removed; orthographic projection, no perspective, no vanishing point, wall lines, plank seams and furniture edges all parallel to the picture plane, every piece of furniture facing the camera straight on, almost no top surfaces visible.
>
> A cozy, lazy wooden one-room bedroom-study. The top 8% is a horizontal timber beam with two small warm pendant lamps; below it a cream wallpaper wall with faint vertical pinstripes.
>
> Left 0–28%: a large wood-framed window with sheer white curtains gathered at the sides; on the sill a monstera, trailing pothos, stacks of old books and a white ceramic mug; outside, simplified flat shapes of bright sky and distant foliage. Golden afternoon light falls in at an angle, casting a grid of window-mullion shadows on the right wall and a diagonal warm band across the floor.
>
> Center 42–62%: an oak desk facing the camera exactly, its front edge a single horizontal line; on it, left to right, a mechanical keyboard, an open notebook, a mug and a brass lamp; a wooden chair facing outward, tucked a third under the desk.
>
> Right 66–84%: a floor-to-ceiling oak bookshelf seen straight on, book spines at uneven heights with a few empty cells, a trailing pothos on top; between shelf and window a corkboard covered in blank notes and a round wall clock.
>
> Far right 86–100%: a bed with white bedding, only the wall-side segment visible, pillow and a folded blanket at the head.
>
> Bottom 10–16%: a horizontal band of warm brown plank floor, seams parallel to the frame, with a horizontally-proportioned cream velvet rug, soft edges.
>
> The character standing spot is at 30% of the width, feet on the floor band at about 88% height; keep that rug and floor patch clean — no furniture, no pots, no high-contrast objects there.
>
> Palette: honey-gold wood, cream wall, terracotta rug, sage-green plants, a touch of cool violet-grey in the shadows. Flat color blocks, hard-edged shadow shapes, clean lineart, subtle hand-painted brush texture on wood and fabric; entirely flat, no glow, no lens flare, no depth of field, no text anywhere. No people, no hands, no silhouettes, no animals.

## 四、负面词

**结构类（这版最关键）**
```
perspective, vanishing point, one-point perspective, isometric,
3/4 view, angled view, tilted, Dutch angle, floor converging lines,
fisheye, wide-angle distortion, 3d render, CGI
```

**人物与文字**
```
people, character, 1girl, hands, silhouette, animals,
text, letters, gibberish writing, watermark, signature, logo, UI, frame, border
```

**画质与光**
```
depth of field, bokeh, blurry, motion blur, glow, lens flare,
harsh pure white blowout, neon colors, cluttered mess
```

> 要像素风时，把 `3d render` 换成 `smooth vector`、`glow` 保留，另加 `16-bit pixel art, tile-based, charming pixel texture, crisp pixel edges`。

## 五、参数

| 引擎 | 设置 |
|---|---|
| Midjourney | `--ar 16:9 --niji 6 --s 150 --no perspective,people,text`（stylize 调低更听话） |
| SDXL / WebUI | 1536×864，CFG 7，steps 32，DPM++ 2M Karras，负面权重 1.2 |
| NovelAI v3 | 1472×832，Prompt Guidance 6 |
| 即梦 / 可灵 / 豆包 | 贴中文段，比例 16:9 |

## 六、正交视角的补救手段

模型天然爱画透视，一次不到位很正常。按代价从低到高：

1. **加词**：`orthographic elevation, flat stage backdrop, dollhouse cross-section, front view only`；
2. **前置**：把 `front-facing elevation, orthographic` 放到提示词最前面（权重最高）；
3. **参考图**：MJ 用 `--sref` 喂一张直播背景图定风格；
4. **ControlNet**（有 SD 的话最稳）：先用一张 16:9 的方块分区稿做 `lineart` 约束，结构一次到位。

## 七、出图自检（三条否决项）

1. **有没有灭点**：地板缝、桌沿、书架横板是否还互相平行？一旦向某点收束，弃；
2. **左侧 30% 处地面是否干净**：立绘要踩在那里，有花盆或高对比物就得重出；
3. **右侧 55% 以后有没有大面积纯白**：窗光扫到右墙最容易过曝，11px 小字会消失。
