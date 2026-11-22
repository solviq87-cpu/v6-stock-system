# 短线研究台部署交接

部署目录为本项目根目录。完整应用由无第三方包的 Node.js 服务提供，网页也可用任一静态服务器承载。计算在浏览器中完成，历史记录存于当前浏览器和站点地址对应的本地存储。应用使用手工录入和模拟示例，读取、评估与导出均无需外部行情、CDN 或交易接口。

当前版本为 `1.0.0`，包含 95 项规则。Node 回归 20 项通过，Chromium 已实测 320、390、768、1440 像素的模拟示例、风险校验、保存及导出，纯静态服务也已验证。云服务器公网可达性和 Windows 实机启动需在目标环境验收。

## 一键启动

1. 安装 Node.js 20 或更新版本。在终端运行 `node --version` 核实安装。无需运行 `npm install`。
2. 解压完整源码。Windows 双击 `start.cmd`。Linux 或 macOS 打开终端，进入解压目录执行 `sh deploy.sh`。也可以在任一系统运行 `npm start`。
3. 浏览器打开 `http://127.0.0.1:8787/`。在浏览器或终端访问 `http://127.0.0.1:8787/api/health`，返回 `ok: true` 即可确认 Node 服务已启动。
4. 保持启动窗口开启。结束运行时在窗口按 `Ctrl+C`。

如端口被占用可换成 `8899`，访问地址端口随之修改。

```sh
PORT=8899 sh deploy.sh
```

```powershell
$env:PORT = '8899'
node server.mjs
```

## 纯静态运行

在项目根目录执行下列命令，浏览器打开 `http://127.0.0.1:8787/`。部署到 Nginx 或静态站点时，把 `public/` 的全部文件按原路径放入站点根目录，并确认 `.mjs` 以 JavaScript 类型响应。此模式下可以完整使用匹配、风控、保存和导出，`/api/health` 和 `/api/evaluate` 由 Node 模式提供。

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory public
```

如果静态服务器未正确设置 `.mjs` 的类型，可在其 MIME 映射引用 JavaScript 类型时把扩展名加入同一条，例如在 Nginx 的 MIME 文件配置 `application/javascript js mjs;`。

## 普通云服务器与 HTTPS

1. 在服务器安装 Node.js 20 或更新版本，以普通用户上传并解压整个项目。保留 Node 默认的 `127.0.0.1:8787` 回环地址，先运行 `sh deploy.sh`，另开终端执行 `curl http://127.0.0.1:8787/api/health`。
2. 把域名解析到服务器，准备受信任 TLS 证书，设置防火墙和云安全组放行所需的 `80`、`443` 端口。使用中国大陆服务器时，按服务商流程完成适用的备案和绑定。页面所有资源从当前站点加载，实际可达性取决于服务器与域名配置。
3. 把以下配置写入已启用的 Nginx 站点，替换域名和证书文件。使用 `nginx -t` 核实配置后通过服务管理器重载 Nginx。浏览器访问你的 HTTPS 域名，分别调用首页和 `/api/health` 验收。

```nginx
server {
    listen 80;
    server_name research.example.cn;
    return 301 https://research.example.cn$request_uri;
}

server {
    listen 443 ssl;
    server_name research.example.cn;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        client_max_body_size 64k;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

长期运行可用 systemd 管理进程。将下例中的用户名、目录和 Node.js 的绝对路径替换成实际值，确保该用户有权读取应用目录。保存为 `/etc/systemd/system/ashare-strategy-lab.service`，由服务器管理员执行 `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now ashare-strategy-lab`。更换版本后执行 `sudo systemctl restart ashare-strategy-lab`，再检查 HTTPS 首页、健康接口和录入后的结果。

```ini
[Unit]
Description=A-share Short-term Research Lab
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/ashare-strategy-lab
Environment=HOST=127.0.0.1
Environment=PORT=8787
ExecStart=/usr/bin/node /srv/ashare-strategy-lab/server.mjs
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

如需更新或回退，可用整套源码替换应用目录后重启，保持域名、协议和端口一致。复盘数据依赖浏览器本地存储，改用其他浏览器、端口、域名或清理浏览器数据前，先从页面导出需要保留的记录。

## 验收与接口

- 在首页录入一组盘面、个股和因子证据，检查匹配结果和风险提示。用同一浏览器刷新后打开历史，核对刚保存的数据，再导出复盘文件。
- 运行 `npm test` 执行仓库内置的 Node 测试。`GET /api/health` 检查服务可用性。数据格式见 `public/schema.mjs`。
- `POST /api/evaluate` 接收 JSON 对象，可选地供本地工具调用，返回与网页同源的规则引擎结果。该接口同步计算，服务端无历史数据库。

```sh
curl http://127.0.0.1:8787/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"stock":{},"market":{},"portfolio":{},"evidence":{}}'
```

## 源码目录

```text
ashare-strategy-lab/
├── DEPLOYMENT.md          部署入口及运行说明
├── README.md             功能介绍与源码导航
├── deploy.sh             Linux 和 macOS 启动入口
├── start.cmd             Windows 启动入口
├── server.mjs            静态文件及无状态评估接口
├── package.json          Node.js 启动和测试命令
├── public/
│   ├── index.html        页面入口
│   ├── style.css         颜色、排版及响应式布局
│   ├── app.mjs           页面入口及交互
│   ├── ui.mjs            页面组件
│   ├── rules.mjs         95 项规则及解释
│   ├── schema.mjs        输入字段定义
│   ├── engine.mjs        匹配、风控及指数判断
│   ├── records.mjs       浏览器存储及复盘导出
│   └── demo.mjs          演示录入样本
└── tests/                规则与服务回归测试
```
