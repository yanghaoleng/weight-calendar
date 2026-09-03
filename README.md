# 体重日历

一个面向手机使用的按日体重记录 Web App。用户只需设置一个唯一的六位数字密码，不需要手机号或邮箱。

## 功能

- 打开网站直接进入可操作的 Demo 月历，底部按钮用于打开个人体重日历。
- 六位密码通过页面数字键盘输入，输满后自动识别已有账户或新密码。
- 新密码会先询问是否创建账户，再要求输入昵称并重复密码。
- 同一个六位密码不能创建多个账户。
- 创建成功后显示网址、二维码和密码，并提醒截图保存。
- 登录后左上角显示“昵称的体重日历”。
- 首次进入设置初始日期和初始体重。
- 今天及以前的日期都可补记或修改体重。
- 每条记录自动显示相对上一条记录的增减值。
- 设置页统一管理五种背景颜色、Markdown 数据导出、退出登录和注销账户。
- 注销需经过两次确认。账户数据在服务器归档，原密码立即释放并可被重新注册。
- `/data` 提供密码保护的数据后台，包含账户、记录、注销归档和基础访问统计。

## 数据与安全

- 密码不会明文落盘。登录使用 PBKDF2 带盐哈希验证；为满足受保护后台的查看需求，同时保存由 `WCAL_SECRET` 派生密钥加密的副本。
- 旧版账户在首次升级启动时，会利用服务器密钥和有限的六位数字空间一次性补全加密副本。
- 登录态使用随机令牌和 `HttpOnly + SameSite=Strict` Cookie，生产环境增加 `Secure`。
- 用户登录和后台登录在应用层和 Nginx 都有尝试频率限制。
- 访问数据只保存使用服务器密钥生成的访客指纹，不保存原始 IP。
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
