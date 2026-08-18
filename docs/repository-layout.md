# 仓库结构

知枢采用前端、Node BFF、Java Control Plane 和契约分层。各层职责如下：

| 目录 | 职责 | 发布说明 |
| --- | --- | --- |
| `src/` | React 前端、设置、壁纸和新任务中心 | 对外 UI 代码 |
| `server/` | Node BFF、Provider、认证、WebSocket 和本地运行时 | 对外服务端代码 |
| `control-plane/` | Java 21 / Spring Boot 控制平面和受治理任务执行 | 独立 Maven 模块 |
| `contracts/` | 跨 Node、Java 和前端的接口契约 | 与 API 版本同步 |
| `database/` | 本地运行时数据库目录 | 数据库文件不入库 |
| `docs/` | 架构、演示、阶段记录和建设总计划 | 公开文档入口在 `docs/README.md` |
| `scripts/` | 演示、验证、迁移和开发辅助脚本 | 发布前确认脚本不含凭据 |
| `docker/` | PostgreSQL、测试和部署辅助配置 | 不放运行时数据 |
| `electron/` | 桌面端启动和打包逻辑 | 与 Web 端共享前端构建 |
| `public/` | Logo、截图和静态资源 | 只放可公开资源 |
| `plugins/` | 随仓库提供的插件源码 | 插件单独说明依赖 |

## 不应进入公开仓库

- `.env` 和任何包含密钥的本地配置。
- `*.db`、运行日志、Playwright 产物和 `output/`。
- `dist/`、`dist-server/`、`node_modules/` 等可再生成目录。
- 本地聊天记录、临时截图和个人路径信息。

源码目录暂不拆分或重命名。当前模块边界已经被构建、测试和 Control Plane 契约验证，后续如需重构应单独建立迁移批次。
