# 需求映射

| 用户说法 | 实现位置 |
| --- | --- |
| 参考这个布局 | `src/App.jsx` 的月历与体重秤日期卡，`src/styles.css` 的七列移动端布局 |
| 封面可以看 Demo | `Cover`、`CoverPreview`、`CalendarApp` 的 Demo 模式 |
| 新建账户，六位密码和选填名字 | `AuthPanel`、`Keypad`、`display_name`、`POST /api/accounts` |
| 名字最多 10 个字符，进入后显示个人标题 | `limitCharacters`、`validate_display_name`、`CalendarApp` 标题 |
| 密码重复不允许创建 | `users.passcode_lookup UNIQUE` 和 `PASSCODE_EXISTS` 错误 |
| 进入对应用户数据 | `sessions` 表、`HttpOnly` Cookie、`GET /api/me` |
| 创建初始体重 | `WeightSheet` 初始模式、`PUT /api/profile` |
| 以前的天数都可以补记 | `ScaleDay`、无限向前翻月、`PUT /api/records` |
| 相对上一次的差值 | `recordsWithDeltas` |
| 浅色背景选项 | `ThemePicker`、五套 CSS 主题、`PUT /api/theme` |
| 导出 JSON 原始数据 | `GET /api/export` 和 `exportData` |
| 具备后端能力 | `server.py`、SQLite、会话、限速与生产服务配置 |
