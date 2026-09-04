# 需求映射

| 用户说法 | 实现位置 |
| --- | --- |
| 参考这个布局 | `src/App.jsx` 的月历与体重秤日期卡，`src/styles.css` 的七列移动端布局 |
| 一进来就是 Demo 日历 | `App` 默认状态和 `CalendarApp` 的 Demo 模式 |
| 底部渐变遮罩与单一入口 | `demo-access-gradient`、`open-my-calendar` |
| 默认注册，也可切换到登录 | `AccessPanel` 的 `authMode`、标题旁弱化切换按钮和 `POST /api/sessions` |
| 输入四位或六位密码 | `PasscodeLengthToggle`、`Keypad`、`POST /api/sessions` |
| 新用户再次确认密码 | `AccessPanel` 的 `enter`、`confirm`、`name` 阶段和 `POST /api/accounts` |
| 创建后显示网址、圆点二维码、App 图标、密码并建议截图 | `AccessPanel` 的 `created` 阶段、`qr-code-styling` 和“已截图”按钮 |
| 密码重复不允许创建 | `users.passcode_lookup UNIQUE` 和 `PASSCODE_EXISTS` 错误 |
| 进入对应用户数据 | `sessions` 表、`HttpOnly` Cookie、`GET /api/me` |
| 创建初始体重 | `WeightSheet` 初始模式、`PUT /api/profile` |
| 以前的天数都可以补记 | `ScaleDay`、无限向前翻月、`PUT /api/records` |
| 相对上一次的差值 | `recordsWithDeltas` |
| 浅色背景选项 | `ThemePicker`、五套 CSS 主题、`PUT /api/theme` |
| 导出 Markdown 日历表 | `makeMarkdownExport` 和 `exportData` |
| 具备后端能力 | `server.py`、SQLite、会话、限速与生产服务配置 |
| 创建新用户昵称非必填 | `AccessPanel` 的 `name` 阶段、`validate_display_name` |
| 左上角显示谁的体重日历 | `CalendarApp` 的 `calendarTitle` |
| 设置页统一管理颜色、导出和退出 | `SettingsPage`、`ThemeOptions` |
| 注销账户二次确认 | `DeleteAccountDialog`、`DELETE /api/account` |
| 服务器归档并释放密码 | `archived_accounts`、`Database.archive_account` |
| `/data` 后台 | `AdminApp`、`GET /api/admin/dashboard`、管理会话 Cookie |
| 每日数据库快照 | `Database.create_snapshot`、`WCAL_SNAPSHOT_DIR`、`wcal-database-maintenance` |
| B 端按用户恢复某日数据 | `AdminSnapshots`、`POST /api/admin/restore`、`Database.restore_user_from_snapshot` |
| 生成 123456 模拟减重用户 | `scripts/seed_mock_user.py` |
| 访问数据保存原始 IP 和大致位置 | `access_events`、`ip_locations`、`GeoLocator`、`POST /api/visits` |
| 每位云端用户的点击行为埋点 | `BehaviorTracking`、`behavior_events`、`POST /api/analytics/events` |
| 页面和功能 CTR | `Database.admin_behavior_analytics`、`AdminAnalytics` |
| 按用户查看使用路径 | `GET /api/admin/analytics/user`、`Database.admin_user_journey`、`AdminAnalytics` |
| 注销 30 天后清除个人数据并保留匿名行为 | `Database.purge_expired_archived_accounts`、`behavior_events` 匿名编号 |
