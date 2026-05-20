import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const args = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const [startUrl, rawProjectName] = positionalArgs;
const shouldPreloadCocosResources = !args.includes('--no-preload-cocos');

function makeSafeFolderName(name) {
  return String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
}

const projectName = makeSafeFolderName(rawProjectName);

if (!startUrl || !projectName) {
  console.error(
    '用法：node crawl-assets.mjs "https://你的游戏地址/index.html" "项目文件夹名"'
  );
  console.error(
    '示例：node crawl-assets.mjs "https://example.com/game/index.html" mjhl2'
  );
  process.exit(1);
}

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-');

const crawledProjectsRoot = path.resolve('./crawled-projects');
const projectRoot = path.join(crawledProjectsRoot, projectName);
const saveRoot = path.join(projectRoot, `assets-dump-${timestamp}`);
const filesDir = path.join(saveRoot, 'files');
const logFile = path.join(saveRoot, 'assets-log.json');

fs.mkdirSync(filesDir, { recursive: true });

const savedByContentHash = new Map();
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

async function preloadCocosResourcesWhenReady(page) {
  console.log('[preload] waiting for Cocos resources bundle...');

  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const readyTimeoutMs = 180000;
    const loadTimeoutMs = 900000;
    const startedAt = Date.now();
    let triedLoadBundle = false;

    while (Date.now() - startedAt < readyTimeoutMs) {
      const cocos = window.cc;
      let resources =
        cocos &&
        (cocos.resources ||
          (cocos.assetManager &&
            typeof cocos.assetManager.getBundle === 'function' &&
            cocos.assetManager.getBundle('resources')));

      if (
        !resources &&
        !triedLoadBundle &&
        cocos?.assetManager &&
        typeof cocos.assetManager.loadBundle === 'function'
      ) {
        triedLoadBundle = true;
        resources = await new Promise((resolve) => {
          cocos.assetManager.loadBundle('resources', (err, bundle) => {
            resolve(err ? null : bundle);
          });
        });
      }

      if (resources && typeof resources.loadDir === 'function') {
        return await new Promise((resolve) => {
          let settled = false;
          let lastLoggedPercent = -1;

          const finish = (payload) => {
            if (settled) {
              return;
            }

            settled = true;
            resolve(payload);
          };

          const timer = setTimeout(() => {
            finish({
              ok: false,
              error: 'Timed out while loading Cocos resources.',
              count: 0,
            });
          }, loadTimeoutMs);

          try {
            resources.loadDir(
              '',
              (finished, total) => {
                if (!total) {
                  return;
                }

                const percent = Math.floor((finished / total) * 100);
                if (
                  percent === 100 ||
                  percent >= lastLoggedPercent + 10
                ) {
                  lastLoggedPercent = percent;
                  console.log(
                    `[crawler-preload] resources ${finished}/${total} (${percent}%)`
                  );
                }
              },
              (err, assets) => {
                clearTimeout(timer);
                finish({
                  ok: !err,
                  error: err ? String(err.message || err) : '',
                  count: Array.isArray(assets) ? assets.length : 0,
                });
              }
            );
          } catch (err) {
            clearTimeout(timer);
            finish({
              ok: false,
              error: String(err.message || err),
              count: 0,
            });
          }
        });
      }

      await wait(1000);
    }

    return {
      ok: false,
      error: 'Cocos resources bundle was not ready before timeout.',
      count: 0,
    };
  });

  if (result.ok) {
    console.log(`[preload] Cocos resources loaded: ${result.count}`);
  } else {
    console.warn(`[preload] Cocos resource preload failed: ${result.error}`);
  }
}

async function installMouseToTouchBridge(context) {
  await context.addInitScript(() => {
    if (window.__crawlerTouchBridgeInstalled) {
      return;
    }

    window.__crawlerTouchBridgeInstalled = true;

    const touchState = {
      active: false,
      id: 1,
      loggedStarts: 0,
      target: null,
    };

    function getCanvasAtPoint(event) {
      const elements =
        typeof document.elementsFromPoint === 'function'
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : [document.elementFromPoint(event.clientX, event.clientY)];
      const canvas = elements.find((item) => item?.tagName === 'CANVAS');

      if (!canvas) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return null;
      }

      return canvas;
    }

    function createTouchList(touches) {
      const list = touches.slice();
      list.item = (index) => list[index] || null;
      return list;
    }

    function createTouch(event, target, identifier) {
      const init = {
        identifier,
        target,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        pageX: event.pageX,
        pageY: event.pageY,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: event.type === 'mouseup' ? 0 : 0.5,
      };

      try {
        return new Touch(init);
      } catch {
        return init;
      }
    }

    function dispatchTouch(type, event) {
      const target = touchState.target || getCanvasAtPoint(event);
      if (!target) {
        return;
      }

      if (type === 'touchstart' && touchState.loggedStarts < 5) {
        touchState.loggedStarts += 1;
        console.log(
          `[crawler-touch-bridge] tap ${Math.round(event.clientX)},${Math.round(event.clientY)}`
        );
      }

      const touch = createTouch(event, target, touchState.id);
      const activeTouches =
        type === 'touchend' || type === 'touchcancel' ? [] : [touch];
      const touches = createTouchList(activeTouches);
      const changedTouches = createTouchList([touch]);
      const targetTouches = createTouchList(activeTouches);

      let touchEvent;
      try {
        touchEvent = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches,
          changedTouches,
          targetTouches,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        });
      } catch {
        touchEvent = document.createEvent('Event');
        touchEvent.initEvent(type, true, true);
        Object.defineProperties(touchEvent, {
          touches: { value: touches },
          changedTouches: { value: changedTouches },
          targetTouches: { value: targetTouches },
        });
      }

      target.dispatchEvent(touchEvent);
    }

    function dispatchPointer(type, event) {
      const target = touchState.target || getCanvasAtPoint(event);
      if (!target || typeof PointerEvent !== 'function') {
        return;
      }

      const isEnd = type === 'pointerup' || type === 'pointercancel';
      const pointerEvent = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: touchState.id,
        pointerType: 'touch',
        isPrimary: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        pageX: event.pageX,
        pageY: event.pageY,
        width: 1,
        height: 1,
        pressure: isEnd ? 0 : 0.5,
        buttons: isEnd ? 0 : 1,
        button: 0,
      });

      target.dispatchEvent(pointerEvent);
    }

    document.addEventListener(
      'mousedown',
      (event) => {
        if (
          touchState.active ||
          event.button !== 0 ||
          event.isTrusted === false
        ) {
          return;
        }

        const target = getCanvasAtPoint(event);
        if (!target) {
          return;
        }

        touchState.active = true;
        touchState.id += 1;
        touchState.target = target;
        dispatchPointer('pointerdown', event);
        dispatchTouch('touchstart', event);
      },
      true
    );

    document.addEventListener(
      'pointerdown',
      (event) => {
        if (
          touchState.active ||
          event.pointerType !== 'mouse' ||
          event.button !== 0 ||
          event.isTrusted === false
        ) {
          return;
        }

        const target = getCanvasAtPoint(event);
        if (!target) {
          return;
        }

        touchState.active = true;
        touchState.id += 1;
        touchState.target = target;
        dispatchPointer('pointerdown', event);
        dispatchTouch('touchstart', event);
      },
      true
    );

    document.addEventListener(
      'mousemove',
      (event) => {
        if (!touchState.active) {
          return;
        }

        dispatchPointer('pointermove', event);
        dispatchTouch('touchmove', event);
      },
      true
    );

    document.addEventListener(
      'pointermove',
      (event) => {
        if (!touchState.active || event.pointerType !== 'mouse') {
          return;
        }

        dispatchPointer('pointermove', event);
        dispatchTouch('touchmove', event);
      },
      true
    );

    document.addEventListener(
      'mouseup',
      (event) => {
        if (!touchState.active) {
          return;
        }

        dispatchPointer('pointerup', event);
        dispatchTouch('touchend', event);
        touchState.active = false;
        touchState.target = null;
      },
      true
    );

    document.addEventListener(
      'pointerup',
      (event) => {
        if (!touchState.active || event.pointerType !== 'mouse') {
          return;
        }

        dispatchPointer('pointerup', event);
        dispatchTouch('touchend', event);
        touchState.active = false;
        touchState.target = null;
      },
      true
    );

    console.log('[crawler-touch-bridge] installed');
  });
}

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

const mobileDevice = { ...devices['iPhone 13'] };
delete mobileDevice.defaultBrowserType;

const context = await browser.newContext({
  ...mobileDevice,
  serviceWorkers: 'allow',
});

await installMouseToTouchBridge(context);

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

    // Keep every URL in the log, but only write duplicate content once.
    const existingFile = savedByContentHash.get(contentHash);

    const filename =
      existingFile?.filename || makeSafeFilename(url, contentType, buffer);
    const filepath = existingFile?.filepath || path.join(filesDir, filename);
    const duplicateOf = existingFile?.filename || null;

    if (!existingFile) {
      fs.writeFileSync(filepath, buffer);
      savedByContentHash.set(contentHash, {
        filename,
        filepath,
      });
    }

    const item = {
      filename,
      filepath,
      url,
      status,
      resourceType,
      contentType,
      size: buffer.length,
      contentHash,
      duplicateOf,
      fromServiceWorker:
        typeof response.fromServiceWorker === 'function'
          ? response.fromServiceWorker()
          : false,
      time: new Date().toISOString(),
    };

    assetLogs.push(item);
    writeLog();

    if (!duplicateOf) {
      console.log(
        `[saved] ${filename} | ${(buffer.length / 1024).toFixed(1)} KB | ${resourceType}`
      );
    }
  } catch (err) {
    console.warn(`[skip] ${url}`);
    console.warn(`       ${err.message}`);
  }
});

page.on('console', (msg) => {
  const text = msg.text();
  if (
    /error|warn/i.test(msg.type()) ||
    text.includes('[crawler-preload]') ||
    text.includes('[crawler-touch-bridge]')
  ) {
    console.log(`[browser:${msg.type()}] ${text}`);
  }
});

console.log('开始打开页面：');
console.log(startUrl);
console.log('');
console.log('项目目录：');
console.log(projectRoot);
console.log('本次保存目录：');
console.log(saveRoot);
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

if (shouldPreloadCocosResources) {
  preloadCocosResourcesWhenReady(page).catch((err) => {
    console.warn(`[preload] ${err.message}`);
  });
} else {
  console.log('[preload] Cocos resource preload is disabled.');
}

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
