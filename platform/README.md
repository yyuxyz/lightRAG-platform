# LightRAG Platform Wrapper

这是外置套壳平台，不修改 LightRAG 原生源码。

## 默认端口

- Platform: `http://127.0.0.1:9621`
- LightRAG Runtime: 按用户按需启动，端口为 `9700 + user_id`，例如 `user_1` 使用 `9701`

## 启动

```powershell
powershell -ExecutionPolicy Bypass -File D:\LightRAG\platform\scripts\build-frontend.ps1
powershell -ExecutionPolicy Bypass -File D:\LightRAG\platform\scripts\start-platform.ps1
```

默认管理员：

```text
admin / ChangeMe123!
```

首次登录后应立即修改默认密码。当前 MVP 已支持管理员创建用户、禁用/启用用户、按用户启动独立 LightRAG runtime，并通过启动参数绑定 workspace。
