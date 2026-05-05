import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const startUrl = process.argv[2];

if (!startUrl) {
  console.error('用法：node crawl-assets.mjs "https://你的游戏地址/index.html"');
  process.exit(1);
}

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-');

const saveRoot = path.resolve(`./assets-dump-${timestamp}`);
const filesDir = path.join(saveRoot, 'files');
const logFile = path.join(saveRoot, 'assets-log.json');

fs.mkdirSync(filesDir, { recursive: true });

const savedContentHashes = new Set();
const assetLogs = [];

const staticExts = new Set([
  '.js',
  '.css',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.ogg',
  '.mp3',
  '.wav',
  '.mp4',
  '.wasm',
  '.bin',
  '.atlas',
  '.plist',
  '.fnt',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
]);

const ignorePatterns = [
  /google-analytics/i,
  /googletagmanager/i,
  /doubleclick/i,
  /facebook/i,
  /ad[_-]?adv/i,
  /sentry/i,
];

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function getExtByContentType(contentType = '') {
  const ct = contentType.toLowerCase();

  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/jpeg')) return '.jpg';
  if (ct.includes('image/webp')) return '.webp';
  if (ct.includes('image/gif')) return '.gif';
  if (ct.includes('image/svg')) return '.svg';

  if (ct.includes('audio/ogg')) return '.ogg';
  if (ct.includes('audio/mpeg')) return '.mp3';
  if (ct.includes('audio/wav')) return '.wav';

  if (ct.includes('video/mp4')) return '.mp4';

  if (ct.includes('application/json')) return '.json';
  if (ct.includes('text/json')) return '.json';

  if (ct.includes('javascript')) return '.js';
  if (ct.includes('text/css')) return '.css';

  if (ct.includes('font/woff2')) return '.woff2';
  if (ct.includes('font/woff')) return '.woff';
  if (ct.includes('font/ttf')) return '.ttf';
  if (ct.includes('font/otf')) return '.otf';

  if (ct.includes('application/wasm')) return '.wasm';

  return '';
}

function isProbablyAsset(url, resourceType, contentType) {
  if (ignorePatterns.some((reg) => reg.test(url))) {
    return false;
  }

  let ext = '';

  try {
    const u = new URL(url);
    ext = path.extname(u.pathname).toLowerCase();
  } catch {
    return false;
  }

  if (staticExts.has(ext)) {
    return true;
  }

  const ct = contentType.toLowerCase();

  if (
    ct.includes('image/') ||
    ct.includes('audio/') ||
    ct.includes('video/') ||
    ct.includes('font/') ||
    ct.includes('javascript') ||
    ct.includes('text/css') ||
    ct.includes('application/json') ||
    ct.includes('application/wasm')
  ) {
    return true;
  }

  if (
    ['script', 'stylesheet', 'image', 'media', 'font'].includes(resourceType)
  ) {
    return true;
  }

  return false;
}

function makeSafeFilename(url, contentType, buffer) {
  const u = new URL(url);

  const rawBase = path.basename(u.pathname) || 'resource';
  const urlExt = path.extname(rawBase);
  const contentExt = getExtByContentType(contentType);
  const ext = urlExt || contentExt || '.bin';

  const nameWithoutExt = rawBase.replace(urlExt, '') || 'resource';

  const cleanName = nameWithoutExt
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 80);

  const contentHash = md5(buffer).slice(0, 12);

  return `${cleanName}.${contentHash}${ext}`;
}

function writeLog() {
  fs.writeFileSync(
    logFile,
    JSON.stringify(assetLogs, null, 2),
    'utf-8'
  );
}

const browser = await chromium.launch({
  headless: false,
});

const context = await browser.newContext({
  viewport: {
    width: 430,
    height: 900,
  },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  serviceWorkers: 'allow',
});

const page = await context.newPage();

page.on('response', async (response) => {
  const request = response.request();
  const url = response.url();
  const status = response.status();
  const resourceType = request.resourceType();
  const headers = response.headers();
  const contentType = headers['content-type'] || '';

  if (status !== 200) {
    return;
  }

  if (!isProbablyAsset(url, resourceType, contentType)) {
    return;
  }

  try {
    const buffer = await response.body();

    if (!buffer || buffer.length === 0) {
      return;
    }

    const contentHash = md5(buffer);

    // 同一个资源如果因为 sign 不同重复请求，只保存一份
    if (savedContentHashes.has(contentHash)) {
      return;
    }

    savedContentHashes.add(contentHash);

    const filename = makeSafeFilename(url, contentType, buffer);
    const filepath = path.join(filesDir, filename);

    fs.writeFileSync(filepath, buffer);

    const item = {
      filename,
      filepath,
      url,
      status,
      resourceType,
      contentType,
      size: buffer.length,
      fromServiceWorker:
        typeof response.fromServiceWorker === 'function'
          ? response.fromServiceWorker()
          : false,
      time: new Date().toISOString(),
    };

    assetLogs.push(item);
    writeLog();

    console.log(
      `[saved] ${filename} | ${(buffer.length / 1024).toFixed(1)} KB | ${resourceType}`
    );
  } catch (err) {
    console.warn(`[skip] ${url}`);
    console.warn(`       ${err.message}`);
  }
});

page.on('console', (msg) => {
  const text = msg.text();
  if (/error|warn/i.test(msg.type())) {
    console.log(`[browser:${msg.type()}] ${text}`);
  }
});

console.log('开始打开页面：');
console.log(startUrl);
console.log('');
console.log('说明：');
console.log('1. 浏览器打开后，手动进入游戏、点击按钮、触发不同界面。');
console.log('2. 脚本会实时保存已经加载到的静态资源。');
console.log('3. 不要等 URL 过期后再下载，本脚本保存的是 response body。');
console.log('4. 按回车结束抓取。');
console.log('');

await page.goto(startUrl, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

await rl.question('资源抓取中。手动操作页面，完成后按回车结束。\n');

rl.close();

writeLog();

console.log('');
console.log(`抓取结束。`);
console.log(`保存目录：${saveRoot}`);
console.log(`资源数量：${assetLogs.length}`);

await context.close();
await browser.close();