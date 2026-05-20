# Game Assets Crawler

用于打开网页游戏、在浏览器里手动操作游戏，并实时保存页面加载到的静态资源。

## 安装依赖

首次使用先安装依赖：

```powershell
cd C:\game-assets-crawler
npm install
```

如果 Playwright 浏览器缺失，再执行：

```powershell
npx playwright install chromium
```

## 启动抓取

命令格式：

```powershell
node .\crawl-assets.mjs "游戏URL" "项目文件夹名"
```

示例：

```powershell
cd C:\game-assets-crawler
node .\crawl-assets.mjs "https://example.com/game/index.html" mjhl2
```

脚本会启动一个模拟 iPhone 13 的 Chromium 浏览器，支持移动端触摸事件。它还会给游戏画布注入鼠标到触摸的桥接逻辑：你用鼠标点浏览器里的游戏区域时，页面会额外收到 `touchstart`、`touchmove`、`touchend` 事件。进入游戏后可以手动点击开始、spin、paytable、购买、free spin、big win 等界面；页面新加载到的 JS、JSON、图片、音频、视频、字体等资源会实时保存。

## 输出目录

抓取结果统一保存到 `crawled-projects` 下：

```text
C:\game-assets-crawler\crawled-projects\项目文件夹名\assets-dump-时间戳\
```

每次启动都会新建一个带时间戳的目录，不会覆盖同一项目之前的抓取结果。

目录里主要有：

- `files\`：实际保存的资源文件。
- `assets-log.json`：每个资源的原始 URL、类型、大小、本地文件名等记录。

`assets-log.json` 是后续按原始 URL 路径还原 Web 包的主要依据。

## 多电脑同步

需要在另一台电脑继续使用同一批资料时，推送这些内容即可：

- 抓取脚本和说明：`crawl-assets.mjs`、`README.md`、`package.json`、`package-lock.json`。
- 指定项目的抓包目录，例如 `crawled-projects\jtty\`。
- 针对抓包项目写下的分析报告，例如 `crawled-projects\jtty\jtty-local-run-and-api-report.md`。

不要提交 `node_modules\`；另一台电脑拉取后执行 `npm install` 还原依赖。

默认 `.gitignore` 会忽略新的 `crawled-projects\*` 目录，避免误提交大批临时抓包。确认某个项目需要同步后，再在 `.gitignore` 里给该项目加例外，或显式调整提交范围。

## 自动预加载 Cocos 资源

默认情况下，脚本会在 Cocos 运行时准备好后尝试执行 `cc.resources.loadDir('')`，让游戏主动加载 `resources` bundle 下的资源。终端看到类似下面的日志，表示正在补抓：

```text
[crawler-preload] resources 120/556 (21%)
```

如果自动预加载导致游戏卡顿，或只想手动操作抓取，可以关闭：

```powershell
node .\crawl-assets.mjs "游戏URL" "项目文件夹名" --no-preload-cocos
```

## 结束抓取

脚本不会自动退出。完成手动操作和资源加载后，回到终端按回车结束抓取。

结束时终端会打印本次保存目录和资源数量。

## 生成资源预览页

抓完后可以生成一个简单的图片、音频、JSON 预览页：

```powershell
node .\make-gallery.mjs ".\crawled-projects\mjhl2\assets-dump-时间戳"
```

生成文件：

```text
preview.html
```

用浏览器打开 `preview.html` 可以快速检查抓到的图片和音频资源。

## 注意事项

- 这个工具保存的是浏览器实际收到的 response body，不依赖后续 URL 是否过期。
- 只有被浏览器加载过的资源才会保存；需要更完整的 dump，就要尽量多触发游戏状态和界面。
- 重复内容只保存一份文件，但每个请求 URL 都会写入 `assets-log.json`，方便后续还原路径。
- 当前抓到的是 Web 打包产物，不等于完整 Cocos Creator 工程源码。
