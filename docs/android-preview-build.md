# Android Preview APK 构建指南

本文档记录了从源码构建 Happy Android Preview APK 所需的所有修改和步骤。

## 前置条件

- Windows 系统
- Android Studio（提供 JDK 和 SDK）
- CMake 4.1.0（解决 Windows 长路径问题）
- pnpm（monorepo 包管理）

## 环境变量

构建时需设置以下环境变量：

```bash
export APP_ENV=preview
export EXPO_PUBLIC_HAPPY_SERVER_URL=http://<你的服务器IP>:<端口>
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="/c/Users/<用户名>/AppData/Local/Android/Sdk"
unset ANDROID_SDK_ROOT
```

## 构建步骤

```bash
cd packages/happy-app

# 1. 生成 Android 原生目录（每次修改 AndroidManifest 或原生配置后需要）
npx expo prebuild --platform android --clean

# 2. 应用以下所有修改（见下方详细说明）

# 3. 构建 APK
cd android
./gradlew assembleRelease
```

APK 输出路径：`android/app/build/outputs/apk/release/app-release.apk`

---

## 修改清单

以下所有修改在 `npx expo prebuild --clean` 后都需要重新应用。

### 1. AndroidManifest.xml — 允许 HTTP 明文流量

**文件**: `android/app/src/main/AndroidManifest.xml`

**问题**: Android 9+ 默认禁止 HTTP 明文请求，连接自建 HTTP 服务器时请求被系统拦截，显示"连接服务器失败"。

**修改**: 在 `<application>` 标签中添加 `android:usesCleartextTraffic="true"`。

```xml
<!-- 修改前 -->
<application android:name=".MainApplication" ... android:fullBackupContent="...">

<!-- 修改后 -->
<application android:name=".MainApplication" ... android:usesCleartextTraffic="true" android:fullBackupContent="...">
```

### 2. build.gradle — Metro 打包路径修复

**文件**: `android/app/build.gradle`

**问题**: React Native Gradle Plugin 将 `--entry-file` 转为相对路径传给 `@expo/cli`，Metro 从 monorepo 根目录而非 `happy-app` 目录解析 `index.ts`，导致打包失败。

**修改 a)** — 修改 `entryFile`：

```groovy
// 修改前
entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')", ...].execute(null, rootDir).text.trim())

// 修改后
entryFile = file("${projectRoot}/index.ts")
```

**修改 b)** — 修改 `cliFile` 为 bundle-wrapper，并设置 `root`：

```groovy
// 修改前
cliFile = new File(["node", "--print", "require.resolve('@expo/cli', ...)"].execute(null, rootDir).text.trim())
bundleCommand = "export:embed"

/* Folders */
 //   The root of your project, i.e. where "package.json" lives. Default is '../..'
// root = file("../../")

// 修改后
cliFile = file("${projectRoot}/android/bundle-wrapper.cjs")
bundleCommand = "export:embed"

/* Folders */
 //   The root of your project, i.e. where "package.json" lives. Default is '../..'
root = file("${projectRoot}")
```

**修改 c)** — 添加 CMake 4.1.0 版本声明：

```groovy
android {
    ndkVersion rootProject.ext.ndkVersion

    // 新增: 使用 CMake 4.1.0 解决 Windows 长路径问题
    externalNativeBuild {
        cmake {
            version "4.1.0"
        }
    }

    buildToolsVersion rootProject.ext.buildToolsVersion
    // ...
}
```

### 3. bundle-wrapper.cjs — Metro 打包包装脚本

**文件**: `android/bundle-wrapper.cjs`（新建文件）

**问题**: `@expo/cli export:embed` 不尊重 Gradle Plugin 的 `root` 设置，始终从 monorepo 根目录解析相对路径。

**方案**: 创建包装脚本，将 `--entry-file` 转为绝对路径，添加 `--config` flag，从正确的工作目录运行。

```javascript
#!/usr/bin/env node
// Wrapper script to ensure @expo/cli export:embed uses the correct project root
// Fixes Metro resolving from monorepo root instead of happy-app directory

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HAPPY_APP_DIR = path.resolve(__dirname, '..');
const METRO_CONFIG = path.join(HAPPY_APP_DIR, 'metro.config.js');

// Get the actual @expo/cli path
const expoCliPath = require.resolve('@expo/cli', { paths: [HAPPY_APP_DIR] });

// Get all arguments except node and script name
const args = process.argv.slice(2);

// Fix: Make --entry-file absolute so Metro resolves correctly
let finalArgs = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--entry-file' && i + 1 < args.length) {
        finalArgs.push('--entry-file');
        // Resolve relative entry-file against HAPPY_APP_DIR
        const entryFile = path.resolve(HAPPY_APP_DIR, args[i + 1]);
        finalArgs.push(entryFile);
        i++; // skip next arg
    } else {
        finalArgs.push(args[i]);
    }
}

// Add --config if not already present
const hasConfig = finalArgs.some((a, i) => a === '--config');
if (!hasConfig) {
    finalArgs.push('--config', METRO_CONFIG);
}

console.log(`[bundle-wrapper] Running: node ${expoCliPath} ${finalArgs.join(' ')}`);
console.log(`[bundle-wrapper] Project root: ${HAPPY_APP_DIR}`);

const child = spawn('node', [expoCliPath, ...finalArgs], {
    cwd: HAPPY_APP_DIR,
    stdio: 'inherit',
    shell: true,
});

child.on('close', (code) => {
    process.exit(code);
});
```

### 4. gradle.properties — 增大 JVM 堆内存

**文件**: `android/gradle.properties`

**问题**: D8 DEX 合并阶段由于 JVM 堆内存不足（2GB）导致 `OutOfMemoryError: Java heap space`。

**修改**:

```properties
# 修改前
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m

# 修改后
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
```

### 5. libsodium CMakeLists.txt — Windows 反斜杠路径修复

**文件**: `node_modules/@more-tech/react-native-libsodium/android/CMakeLists.txt`

**问题**: CMake 在 Windows 上将 `NODE_MODULES_DIR` 中的反斜杠 `\` 当作转义符，导致路径解析错误。

**修改**: 在 `cmake_minimum_required` 之后添加一行：

```cmake
cmake_minimum_required(VERSION 3.4.1)

# 新增: 修复 Windows 反斜杠路径被 CMake 当作转义符的问题
string(REPLACE "\\" "/" NODE_MODULES_DIR "${NODE_MODULES_DIR}")
```

> **注意**: 此修改在 `node_modules/` 中，不会被 git 跟踪。换机器后需要重新应用。
> 推荐使用 `patch-package` 固化此修改。

### 6. CMake 4.1.0 — 解决 Windows 长路径问题

**要求**: 系统中需安装 CMake 4.1.0

**问题**: CMake 3.x 在 Windows 上会将 `E:/` 替换为 `E_/` 并嵌入构建路径，加上深度嵌套的 node_modules 结构，路径超过 260 字符的 Windows MAX_PATH 限制，导致 ninja `mkdir` 失败。

**安装**: 下载 CMake 4.1.0 并放置在 `C:/Users/<用户名>/AppData/Local/Android/Sdk/cmake/4.1.0/`

**build.gradle 配置**（已在修改 2c 中完成）:

```groovy
externalNativeBuild {
    cmake {
        version "4.1.0"
    }
}
```

---

## 可移植性说明

### 哪些修改会被 git 跟踪

| 文件 | git 跟踪 | 备注 |
|------|----------|------|
| `android/app/src/main/AndroidManifest.xml` | ❌ | `android/` 目录在 `.gitignore` 中 |
| `android/app/build.gradle` | ❌ | 同上 |
| `android/bundle-wrapper.cjs` | ❌ | 同上 |
| `android/gradle.properties` | ❌ | 同上 |
| `node_modules/@more-tech/react-native-libsodium/android/CMakeLists.txt` | ❌ | `node_modules/` 在 `.gitignore` 中 |

### 在新机器上构建

换机器后需要：

1. 设置环境变量（`APP_ENV`, `EXPO_PUBLIC_HAPPY_SERVER_URL`, `JAVA_HOME`, `ANDROID_HOME`）
2. 安装 CMake 4.1.0 到 Android SDK 目录
3. 运行 `npx expo prebuild --platform android --clean`
4. 重新应用上述所有修改（或使用 `patch-package` 固化 node_modules 修改）
5. 运行 `./gradlew assembleRelease`

### 永久化建议

- **方案 A**: 使用 `patch-package` 固化 `libsodium` 的 CMake 修改，其他修改写成脚本自动应用
- **方案 B**: 将 `android/` 目录从 `.gitignore` 移除，所有修改直接提交到 git
