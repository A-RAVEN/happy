# Happy Server 本地 Docker 搭建指南

## 前置条件

- Docker Desktop（已安装并正常运行）
- 项目代码已克隆到本地

## 一键启动

在项目根目录（`src/`）执行：

```bash
powershell -ExecutionPolicy Bypass -File .\start-happy-server.ps1
```

脚本会自动完成：检查 Docker → 构建镜像 → 启动容器 → 验证服务。

启动后服务器地址：`http://localhost:3005`

## 手动构建与运行

### 1. 构建镜像

```bash
docker build -t happy-server -f Dockerfile .
```

### 2. 生成密钥

```bash
[guid]::NewGuid().ToString()
```

### 3. 启动容器

```bash
docker run -d `
  --name happy-server `
  -p 3005:3005 `
  -e HANDY_MASTER_SECRET=<你的密钥> `
  -e PUBLIC_URL=http://localhost:3005 `
  -v happy-data:/data `
  --restart unless-stopped `
  happy-server
```

### 4. 验证

```bash
docker logs happy-server
```

看到日志输出说明服务已正常运行。

---

## 客户端连接

### CLI（命令行）

设置环境变量 `HAPPY_SERVER_URL` 指向你的服务器：

**临时生效**（当前终端窗口有效）：

```bash
set HAPPY_SERVER_URL=http://localhost:3005
```

**永久生效**（所有新终端有效）：

```bash
setx HAPPY_SERVER_URL "http://localhost:3005"
```

设置后重新打开终端，启动 happy-cli 即可。服务器地址会显示在 `happy doctor` 的输出中：

```bash
happy doctor
```

### 移动端 App（happy-app）

设置环境变量 `EXPO_PUBLIC_HAPPY_SERVER_URL`，然后重新构建 APK。

```bash
# 根据你的使用场景选择：

# 场景1: Android 模拟器（与服务器同一台电脑）
set EXPO_PUBLIC_HAPPY_SERVER_URL=http://10.0.2.2:3005

# 场景2: 真机 + 同一 WiFi 网络（先用 ipconfig | findstr "IPv4" 查电脑 IP）
set EXPO_PUBLIC_HAPPY_SERVER_URL=http://192.168.x.x:3005

# 场景3: 真机 + 公网访问（需要服务器有公网 IP 或内网穿透）
set EXPO_PUBLIC_HAPPY_SERVER_URL=http://你的公网IP:3005
```

> **注意**：
> - 不能用 `localhost`，因为手机的 `localhost` 是手机自己，不是你的电脑。
> - `EXPO_PUBLIC_*` 前缀的变量会在构建时内联到 APK 中，设置后必须重新执行 `./gradlew assembleDebug` 构建 APK 才能生效。
> - 更换服务器地址需要重新构建。

### 如何验证客户端是否连上了自己的服务器

1. 查看服务端日志中是否有来自客户端的请求：

   ```bash
   docker logs -f happy-server
   ```

2. 操作客户端（如扫码登录），观察日志中是否出现 `/v1/auth/request` 等请求记录。

3. CLI 端执行 `happy doctor`，看 `HAPPY_SERVER_URL` 字段是否指向你的服务器地址。

## 常用命令

| 命令 | 说明 |
|------|------|
| `docker logs -f happy-server` | 实时查看日志 |
| `docker restart happy-server` | 重启服务 |
| `docker stop happy-server` | 停止服务 |
| `docker start happy-server` | 启动已停止的服务 |

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `HANDY_MASTER_SECRET` | 是 | - | 主密钥，用于认证和加密 |
| `PORT` | 否 | `3005` | 服务端口 |
| `PUBLIC_URL` | 否 | `http://localhost:3005` | 公网访问地址 |
| `DATA_DIR` | 否 | `/data` | 数据存储目录 |

## 国内网络注意

如果 `docker build` 拉取镜像超时，需在 Docker Desktop → Settings → Docker Engine 中配置镜像源：

```json
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
```

然后点击 Apply & restart，重新执行构建。
