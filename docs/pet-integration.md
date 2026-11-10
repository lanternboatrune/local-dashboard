# 桌宠接入说明

仪表盘的桌宠卡会自动发现任何声明了 `dsh.pet` 的插件，不需要改仪表盘代码，也不需要用户手动填地址。

## 1. 发现机制

控制台的宿主半在收到 `GET /plugin-local-dashboard/pet` 时：

1. 取 `clientModules` 服务，调用 `graph()` 拿到已安装的客户端插件列表；
2. 对每个条目调用 `clientPath(id)`，得到该插件客户端 bundle 的绝对路径；
3. 从 bundle 所在目录向上最多四层寻找 `package.json`；
4. 读取其中的 `dsh.pet` 声明，汇总成源列表。

因此接入方必须是一个**带客户端 bundle 的插件**，也就是 `package.json` 里有 `dsh.client`。纯宿主插件不会被枚举。

发现路由的响应：

```json
{
  "time": 1762444800000,
  "sources": [
    { "id": "@local/my-pet", "route": "/plugin-my-pet/state", "sprites": null }
  ]
}
```

控制台会逐个请求每个 `route`，把所有 `sessions[]` 合在一起，取 `ts` 最大的一只显示；同时多只桌宠不会并排出现。

## 2. 声明

在插件的 `package.json` 里加一段：

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "immediately": true
    },
    "pet": {
      "route": "/plugin-my-pet/state",
      "sprites": {
        "idle": "/plugin-my-pet/sprite/idle.webp",
        "thinking": "/plugin-my-pet/sprite/thinking.webp"
      }
    }
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `dsh.pet.route` | 是 | 以 `/` 开头，由插件宿主半注册的同源路由 |
| `dsh.pet.sprites` | 否 | 状态到立绘 URL 的映射；不写就使用仪表盘内置的十张图 |

声明改完后需要完整重启 DSH，`clientModules` 的图才会重新扫描。

## 3. 状态路由

```
GET /plugin-my-pet/state
```

同源、无需鉴权，只接受 `GET` / `HEAD`，响应带 `cache-control: no-store`。

```json
{
  "time": 1762444800000,
  "sessions": [
    {
      "id": "3f2c…",
      "state": "reading",
      "text": "在读 src/app.js",
      "ts": 1762444799000
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `time` | 快照时间，毫秒 |
| `sessions[]` | 当前活跃会话，按最后事件时间倒序 |
| `sessions[].id` | 会话 id，与 `conversation.composer.dock` 的 `sessionId` 一致 |
| `sessions[].state` | 见下方枚举 |
| `sessions[].text` | 可直接显示的气泡文案，可为空 |
| `sessions[].ts` | 状态最后更新时间，毫秒；控制台用它挑最近活跃的一只 |

## 4. 状态枚举

| `state` | 含义 |
|---|---|
| `idle` | 空闲 |
| `thinking` | 思考中 |
| `tool` | 跑命令、改文件 |
| `reading` | 读文件、搜索、上网 |
| `waiting` | 等待用户回话或确认 |
| `celebrate` | 长任务收尾 |
| `error` | 出错 |
| `aborted` | 被中断 |
| `stone` | 连续出错后的石化态 |

未知值按 `waiting` 展示。子代理会话建议不要放进 `sessions[]`。

## 5. 立绘

`sprites[state]` 优先；没有声明或该状态没有对应项时，控制台回退到内置的十张图：

```js
const PET_SPRITE_OF = {
  thinking: 'smile-closed',
  tool: 'typing',
  reading: 'notes',
  waiting: 'knock',
  celebrate: 'confetti',
  idle: 'smile',
  error: 'panic',
  aborted: 'guilty',
  stone: 'stone',
};
```

内置图的地址是 `/plugin-local-dashboard/pet/<name>.webp`。接入方当然也可以自己返回立绘 URL，只要它是同源可访问的。

## 6. 降级

以下情况控制台都会显示虚线占位块，不报错、不阻塞其它卡片：

- 没有任何插件声明 `dsh.pet`；
- 声明了但路由未挂载或返回非 200；
- `clientModules` 服务不可用，或旧版控制台没有发现路由，此时退回 `/plugin-desk-pet/state`。

消费方应把桌宠当作可选能力，不要让它成为界面能否渲染的前提。

## 7. 参考实现

- `local-dashboard` 的 `PetCard`：读发现路由、逐个拉状态、按 `ts` 取最近一只、失败占位。
- `desk-pet` 的 `index.js` 与 `package.json`：宿主半折叠会话事件并注册 `/plugin-desk-pet/state`，清单里声明 `dsh.pet.route`。
