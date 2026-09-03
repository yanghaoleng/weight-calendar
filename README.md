# 体重日历

一个面向手机使用的按日体重记录 Web App。用户只需设置一个唯一的六位数字密码，不需要手机号或邮箱。

## 功能

- 打开网站直接进入可操作的 Demo 月历，底部按钮用于打开个人体重日历。
- 六位密码通过页面数字键盘输入，输满后自动识别已有账户或新密码。
- 新密码会先询问是否创建账户，可选填昵称，再重复密码确认。
- 同一个六位密码不能创建多个账户。
- 创建成功后显示网址、二维码和密码，并提醒截图保存。
- 填写昵称后左上角显示“昵称的体重日历”；未填写时显示“我的体重日历”。
- 首次进入设置初始日期和初始体重。
- 今天及以前的日期都可补记或修改体重。
- 每条记录自动显示相对上一条记录的增减值。
- 记录弹窗带有进出场反馈；保存后日历格、涨跌数字和方向箭头会给出轻量动效。
- 设置页统一管理五种背景颜色、三种字体风格、Markdown 数据导出、退出登录和注销账户。
- 页面图标使用可变色 SVG，背景色、Safari 浏览器主题色和图标色调会同步变化。
- 手机端月历按整屏布局适配，关闭页面纵向滚动和双击缩放，同时保留设置页的正常滚动。
- 注销需经过两次确认。账户数据在服务器归档，原密码立即释放并可被重新注册。
- `/data` 提供密码保护的数据后台，包含账户、记录、注销归档和基础访问统计。

## 数据与安全

- 密码不会明文落盘。登录使用 PBKDF2 带盐哈希验证；为满足受保护后台的查看需求，同时保存由 `WCAL_SECRET` 派生密钥加密的副本。
- 旧版账户在首次升级启动时，会利用服务器密钥和有限的六位数字空间一次性补全加密副本。
- 登录态使用随机令牌和 `HttpOnly + SameSite=Strict` Cookie，生产环境增加 `Secure`。
- 用户登录和后台登录在应用层和 Nginx 都有尝试频率限制。
- 访问数据保存原始 IP、由 IP 粗略推测的国家/省市、网络运营信息和访客指纹。位置解析不使用浏览器 GPS，结果仅供访问统计参考。
- 首次遇到一个公网 IP 时，服务器会把该 IP 通过 HTTPS 发送给 IPWhois 查询大致位置；成功结果缓存 30 天，失败结果缓存 1 小时。可用 `WCAL_GEOIP_ENDPOINT` 更换或关闭该第三方服务。
- 数据保存在服务器 SQLite，生产路径为 `/var/lib/wcal/wcal.sqlite3`，不随代码版本切换。
- 六位数字只有一百万种组合，不适合存放高度敏感信息。不要与银行卡、支付或其他重要密码复用。

## 本地运行

```bash
npm install
npm run build
set -a; source .env; set +a
python3 server.py 8141 dist
```

打开 `http://127.0.0.1:8141`。

开发前端时可同时运行：

```bash
set -a; source .env; set +a
python3 server.py 8141 dist
npm run dev
```

## 测试

```bash
npm test
npm run build
```

## 生产部署

- 正式域名：`https://wcal.mikeywa.site`
- 服务：`wcal.service`
- 应用目录：`/opt/wcal/releases/<release-id>`
- 当前版本：`/opt/wcal/current`
- 数据库：`/var/lib/wcal/wcal.sqlite3`
- 环境变量：`/etc/wcal.env`
- 后端端口：`127.0.0.1:8141`

发布使用版本目录和原子软链切换，保留旧版本用于回滚。

`WCAL_SECRET` 和 `WCAL_ADMIN_PASSWORD` 必须只放在私密环境变量中。不要把真实值提交到 GitHub。参考 [`.env.example`](.env.example)。

## 许可证

源码公开，使用 [PolyForm Noncommercial License 1.0.0](LICENSE)。个人、教育、研究和非商业用途可按许可条款使用、修改和分发；商业使用未被授权。这是“源码可用的非商业许可”，不是 OSI 定义的开源许可。

Noto Serif SC 与 Ma Shan Zheng 字体使用 SIL Open Font License 1.1；Calligraph 与 Motion 使用 MIT License。完整第三方声明见 [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt)。
