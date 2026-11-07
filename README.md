# local-dashboard（仪表盘）

把「控制台」与「右侧资源监控」合成一个插件：**侧栏面板**看历史与明细，**右缘悬浮卡**看当下，**设置页**单独调强调色。

- 包名：`@local/local-dashboard`
- 版本：1.0.0
- 形态：宿主半边读系统与会话数据（`index.js`），客户端半边渲染（`client.js`）
- 前身：`perf-console` + `resource-monitor`（2026-11-06 合并）

## 功能

### 侧栏面板（`sidebar.panellist`，order 20，「仪表盘」）

- **CPU / 内存**：1000ms 采样，保留最近 60 点，带曲线与峰值。
- **Token 汇总**：输入 / 输出 / 缓存命中 / 累计，按会话分组。
- **会话明细**：每个会话的 turn 数、运行状态、待确认数。
- **月历**：当月网格，今天高亮。
- **秒表**：开始 / 暂停 / 复位。
- **天气**：open-meteo，定位到城市（默认北京）；离线时卡片显示占位，不阻塞其它卡片。
- **桌宠接入区**：轮询 `/plugin-desk-pet/state`（400ms），显示立绘与气泡；未装桌宠时显示虚线占位「桌宠接入区」。

### 右缘悬浮卡（`shell.overlay`，order 11）

- CPU、内存、**本轮 Token 与预估金额**、北京时间四行。
- 默认悬浮在右缘，可**钉住**（固定在对话右侧），鼠标移入展开。
- 金额按 DeepSeek Flash 高峰/空闲价估算（见下）。

### 设置页（`settings.section`，order 34，「仪表盘」）

- 20 色强调色板 + 恢复默认。
- 默认**跟随全局品牌色**；一旦在本插件里选色，独立存储，不再受主主题影响。
- 通过 CSS 变量 `--dash-accent` 注入，所有卡片的高亮/曲线/选中态都读它。

## 数据来源

宿主路由（同源，只读）：

```
GET /plugin-local-dashboard/stats
→ {
    cpu: { percent, cores },
    memory: { usedBytes, totalBytes, percent },
    process: { rssBytes },
    sessions: [{ id, title, running, pendingApprovals, turns, input, output, cached, total, lastAt }],
    totals: { input, output, cached, total },
    time
  }
```

- CPU 用 `node:os` 的 tick 差值算，首帧可能为 `null`。
- 会话 Token 来自 `session.snapshotEvents(seq)` 增量折叠 `assistant/message.usage`，只读、不写会话。
- 立绘路由：`GET /plugin-local-dashboard/pet/<sprite>.webp`，素材取自 `assets/pet/`（与桌宠同源）。

预估金额（CNY / 百万 token，写死在 `DASH_PRICING`）：

| 档位 | 输入 | 缓存读 | 缓存写 | 输出 |
|---|---|---|---|---|
| 高峰 | 2 | 0.04 | 2 | 8 |
| 空闲 | 半价 | 半价 | 半价 | 半价 |

官方调价后需改常量并重新构建。

## 桌宠接入

右侧卡与侧栏面板都会探测桌宠插件的状态路由。**未安装/未运行时自动降级为占位块**，不会报错。

接入协议、状态枚举与立绘映射见 [desk-pet 接入说明](../desk-pet/docs/integration.md)。

## 安装

```powershell
& "D:\Deepseek\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add `
  "C:\Users\wuyux\Documents\deepseek-harness\default-workspace\develop-plugins\local-dashboard"
```

依赖的 UI 包（`dsh.client.inject`）：`@deepseek-ai/dsh-client-ui-conversation`、`-settings`、`-sidebar`，随 DSH Desktop 提供。

装完**完整重启** DSH：客户端 bundle 在启动时捕获，宿主路由也要重新挂载。

## 存储键

| 键 | 内容 |
|---|---|
| `dsh.local-dashboard.v1` | 本插件强调色（`#rrggbb`），空 = 跟随全局 |
| `dsh.perf-console.weather.v2` | 天气缓存（沿用旧键，升级不丢） |

## 限制

- 单价表写死，实际账单以控制台为准；这是**估算**。
- 天气需要外网；无网络时只显示占位。
- 面板只在侧栏展开时渲染；收起后停止采样。
- 悬浮卡的「钉住」状态存在内存里，刷新后回到默认位置。
- 桌宠立绘为静态 PNG/WebP，无逐帧动画（CSS 呼吸/抖动替代）。

## 排查

| 现象 | 处理 |
|---|---|
| 面板空白 / 一直 0 | 宿主路由没挂上：确认 `index.js` 已注册、重启 DSH；访问 `/plugin-local-dashboard/stats` 看是否 200 |
| 金额为 0 | 当前会话没有 `assistant/message.usage`，或模型不在定价表内 |
| 桌宠区一直占位 | 桌宠插件未启用，或其路由 `/plugin-desk-pet/state` 返回非 200 |
| 强调色不生效 | 设置页选一次色；清 `dsh.local-dashboard.v1` 可回到跟随全局 |
| CPU 首帧为空 | 正常，宿主需要两次采样才有差值 |

## 文件结构

```
local-dashboard/
├── client.js        # 面板 + 右卡 + 设置页（约 60 KB）
├── index.js         # 宿主路由 /stats 与 /pet/*（约 8 KB）
├── assets/          # 桌宠立绘、错误/空闲插画
├── cordis.patch.yml
├── package.json
├── icon.svg
├── locale/{zh,en}.json
├── docs/room-bg-prompt.md
└── README.md
```

## 许可证

[MIT](LICENSE) © 2026 wuyux
