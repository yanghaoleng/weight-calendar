# 需求映射

| 用户说法 | 实现位置 |
| --- | --- |
| 参考这个布局 | `src/App.jsx` 的月历与体重秤日期卡，`src/styles.css` 的七列移动端布局 |
| 一进来就是 Demo 日历 | `App` 默认状态和 `CalendarApp` 的 Demo 模式 |
| 底部渐变遮罩与单一入口 | `demo-access-gradient`、`open-my-calendar` |
| 单纯输入六位密码 | `AccessPanel`、`Keypad`、`POST /api/sessions` |
| 新密码询问创建并再次确认 | `AccessPanel` 的 `ask`、`confirm` 阶段和 `POST /api/accounts` |
| 创建后显示网址、二维码、密码并建议截图 | `AccessPanel` 的 `created` 阶段、浏览器端二维码生成和“已截图”按钮 |
| 密码重复不允许创建 | `users.passcode_lookup UNIQUE` 和 `PASSCODE_EXISTS` 错误 |
| 进入对应用户数据 | `sessions` 表、`HttpOnly` Cookie、`GET /api/me` |
| 创建初始体重 | `WeightSheet` 初始模式、`PUT /api/profile` |
| 以前的天数都可以补记 | `ScaleDay`、无限向前翻月、`PUT /api/records` |
| 相对上一次的差值 | `recordsWithDeltas` |
| 浅色背景选项 | `ThemePicker`、五套 CSS 主题、`PUT /api/theme` |
| 导出 Markdown 日历表 | `makeMarkdownExport` 和 `exportData` |
| 具备后端能力 | `server.py`、SQLite、会话、限速与生产服务配置 |
| 创建新用户必须输入昵称 | `AccessPanel` 的 `name` 阶段、`validate_display_name(required=True)` |
| 左上角显示谁的体重日历 | `CalendarApp` 的 `calendarTitle` |
| 设置页统一管理颜色、导出和退出 | `SettingsPage`、`ThemeOptions` |
| 注销账户二次确认 | `DeleteAccountDialog`、`DELETE /api/account` |
| 服务器归档并释放密码 | `archived_accounts`、`Database.archive_account` |
| `/data` 后台 | `AdminApp`、`GET /api/admin/dashboard`、管理会话 Cookie |
| 访问数据 | `access_events`、`POST /api/visits`，仅保存不可逆访客指纹 |
