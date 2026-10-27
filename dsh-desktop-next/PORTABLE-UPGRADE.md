# DSH NEXT 多窗口增强版：Mac 升级与回滚

同一 Mac 内的窗口共用原后台、插件和配置，页面、会话选择和草稿独立。每个 Codex 任务运行 `dsh-window bind` 自动认领窗口，不覆盖 CODEX_THREAD_ID；工具只操作自己的窗口，不能撤销通用桌面工具权限。

## 其他 Mac 安装

解压整个包 → 正常退出目标 DSH NEXT → 双击 `升级与回滚.command` → 打开原位置的 DSH NEXT。不要只拖拽 App 覆盖，否则不会生成回滚回执。

不包含个人账号、插件配置、会话或窗口归属，安装复用目标 Mac 自己的数据；账号仍使用目标机器已有登录。优先使用 Node 22+，缺少时使用本机 DSH 自带的 Electron Node，不下载运行时。不同用户名不需改脚本。多个安装或自定义程序目录时明确指定：

```sh
node tools/upgrade-cli.mjs doctor
node tools/upgrade-cli.mjs install /path/to/解压目录 --app /custom/DSH\ NEXT.app
```

安装后工具位于 `~/.local/bin/dsh-next-upgrade` 和 `~/.local/bin/dsh-window`，不依赖制作电脑的用户名、任务目录或开发依赖。该目录不在 PATH 时使用完整路径。

## 制作新版

```sh
dsh-next-upgrade prepare latest /new/upgrade-work --source /path/to/feature-repository
# 冲突在返回的独立源码目录解决，不覆盖现用程序。
dsh-next-upgrade verify /new/upgrade-work --source /path/to/feature-repository
# vendor 必须为同版本官方 Mac App，下载先核对官方 SHA256。
dsh-next-upgrade package --app /path/to/官方新版/DSH\ NEXT.app --prepared /new/upgrade-work --out /new/增强包
```

源码准备需要 Git、已登录 gh 和仓库匹配的构建依赖；其他 Mac 安装已经打好的包不需要开发环境。检查后源码、脚本、编译产物发生变化或版本不一致时拒绝打包。冲突、依赖变化、测试失败都保留现用程序。

已有已验证增强版可直接打包分发：

```sh
dsh-next-upgrade package --app /Applications/DSH\ NEXT.app --out /new/增强包
```

## 安装、回滚和中断恢复

```sh
dsh-next-upgrade install /path/to/增强包
dsh-next-upgrade rollback
dsh-next-upgrade rollback --receipt /path/from/install-output.json
dsh-next-upgrade recover --receipt /path/from/install-output.json
```

先正常退出 DSH，运行中脚本拒绝覆盖，不杀进程、不停在途任务。每笔安装保留完整旧 App 和独立回执。回滚只恢复程序，保留当前数据目录、插件配置、会话和绑定，也保留用户升级后修改的设置。新版自行迁移的数据不自动倒回，旧程序兼容性须单独核查。

回滚检查完整文件清单，程序已被其他方式更新或备份不一致时拒绝覆盖。中断恢复只处理本工具能核验的事务；活跃或不明锁不删除。失败/退休 App 保留，不自动清理业务数据。升级工具继续保留供下一次恢复和升级。

## 范围

面向 Mac。包保留官方 universal 可执行文件与 arm64/x64 运行时，Apple 芯片 Mac 的原生实测单列在交付记录，Intel Mac 尚未亲机实测。当前版本重打包的安装回滚不等于已完成更新官方版本的合并。

增强版是本地签名构建，不宣称官方签名发行；不修改 Gatekeeper 或系统安全设置。一个 Mac 内共享不等于不同 Mac 自动同步配置。
