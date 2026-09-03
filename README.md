# 体重日历

一个面向手机使用的按日体重记录 Web App。用户只需设置一个唯一的六位数字密码，不需要手机号或邮箱；注册时可以选填最多 10 个字符的名字。

## 功能

- 封面提供可操作 Demo、新建账户和已有账户登录。
- 六位密码通过页面数字键盘输入。
- 同一个六位密码不能创建多个账户。
- 注册时可选填名字，登录后显示“某某的体重日历”。
- 首次进入设置初始日期和初始体重。
- 今天及以前的日期都可补记或修改体重。
- 每条记录自动显示相对上一条记录的增减值。
- 五种浅色背景可切换并跟随账户保存。
- 登录用户可导出完整 JSON 原始数据。

## 数据与安全

- 密码不会明文保存。服务端使用服务器密钥生成账户查找指纹，并使用 PBKDF2 带盐哈希验证。
- 登录态使用随机令牌和 `HttpOnly + SameSite=Strict` Cookie，生产环境增加 `Secure`。
- 应用层和 Nginx 都限制密码尝试频率。
- 数据保存在服务器 SQLite，生产路径为 `/var/lib/wcal/wcal.sqlite3`，不随代码版本切换。
- 六位数字只有一百万种组合，不适合存放高度敏感信息。不要与银行卡、支付或其他重要密码复用。

## 本地运行

```bash
npm install
npm run build
WCAL_SECRET=development-secret-with-at-least-32-characters python3 server.py 8141 dist
```

打开 `http://127.0.0.1:8141`。

开发前端时可同时运行：

```bash
WCAL_SECRET=development-secret-with-at-least-32-characters python3 server.py 8141 dist
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
