import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appPort = 14_300 + (process.pid % 500);
const debugPort = appPort + 700;
const appUrl = `http://127.0.0.1:${appPort}/web.html`;
const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function executable() {
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; }
    catch { /* try next */ }
  }
  throw new Error("Chrome/Chromium not found; set CHROME_PATH");
}

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* server/browser is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function cdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close: () => socket.close(),
  };
}

const profile = await mkdtemp(join(tmpdir(), "lucent-browser-smoke-"));
const vite = spawn(join(process.cwd(), "node_modules/.bin/vite"), [
  "--host", "127.0.0.1", "--port", String(appPort), "--strictPort",
], { stdio: "ignore" });
let chrome;
try {
  await waitFor(appUrl);
  chrome = spawn(await executable(), [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    appUrl,
  ], { stdio: "ignore" });
  const tabs = await (await waitFor(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = tabs.find((tab) => tab.type === "page" && tab.url === appUrl) ?? tabs.find((tab) => tab.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("Chrome page target not found");
  const client = cdp(page.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__smokeErrors=[];addEventListener('error',e=>window.__smokeErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__smokeErrors.push(String(e.reason)))",
  });
  await client.send("Page.navigate", { url: appUrl });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const expression = String.raw`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 10000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Timed out: ' + label + '; banner=' + document.querySelector('#banner')?.textContent + '; tabs=' + document.querySelector('#tabbar')?.textContent);
    };
    // A cold Vite server may need to transform the full Mermaid/CodeMirror
    // dependency graph before the application module can run.
    await waitFor(() => document.querySelector('.welcome'), 'app initialization', 60000);
    const markdown = new File(['# Browser smoke\n\nInitial text\n\n![pixel](../assets/pixel.png)'], 'smoke.md', { type: 'text/markdown' });
    const image = new File([new Uint8Array([1, 2, 3])], 'pixel.png', { type: 'image/png' });
    const fileEntry = (fullPath, file) => ({
      isFile: true, isDirectory: false, fullPath,
      file: (success) => success(file),
    });
    const children = [
      fileEntry('/project/docs/smoke.md', markdown),
      fileEntry('/project/assets/pixel.png', image),
    ];
    let read = false;
    const root = {
      isFile: false, isDirectory: true, fullPath: '/project',
      createReader: () => ({ readEntries: (success) => { success(read ? [] : children); read = true; } }),
    };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { items: [{ webkitGetAsEntry: () => root }] } });
    document.dispatchEvent(drop);
    await waitFor(() => document.querySelector('#content h1')?.textContent === 'Browser smoke', 'folder import');
    await waitFor(() => document.querySelector('#content img')?.src.startsWith('blob:'), 'relative folder image');

    document.querySelector('#btn-edit').click();
    const textarea = await waitFor(() => document.querySelector('.split-textarea'), 'editor');
    textarea.value = '# Updated in browser\n\nDurable';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => document.querySelector('.split-preview h1')?.textContent === 'Updated in browser', 'preview update');

    let downloaded = '';
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
    document.querySelector('#btn-save').click();
    await waitFor(() => downloaded, 'save download');
    HTMLAnchorElement.prototype.click = originalClick;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    await waitFor(() => !document.querySelector('#searchbar').hidden, 'keyboard search');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
    await waitFor(() => !document.querySelector('#quick-switcher').hidden, 'quick switch');
    document.querySelector('.quick-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (document.activeElement !== document.querySelector('#search-input')) throw new Error('Quick switch did not restore focus');
    return { heading: document.querySelector('.split-preview h1').textContent, downloaded };
  })()`;
  const evaluated = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (evaluated.exceptionDetails) {
    const pageState = await client.send("Runtime.evaluate", {
      expression: "({ url: location.href, ready: document.readyState, body: document.body?.innerText.slice(0, 120), errors: window.__smokeErrors })",
      returnByValue: true,
    });
    console.error("Browser page state:", pageState.result?.value);
    client.close();
    throw new Error(evaluated.exceptionDetails.exception?.description ?? "Browser smoke failed");
  }
  const result = evaluated.result?.value;
  if (result?.heading !== "Updated in browser" || result?.downloaded !== "smoke.md") {
    throw new Error(`Unexpected browser result: ${JSON.stringify(result)}`);
  }
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: false,
  });
  const responsive = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const select = document.querySelector('#sel-theme');
      for (const theme of ['light', 'sepia', 'dark']) {
        select.value = theme;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (document.querySelector('#content').dataset.theme !== theme) return false;
      }
      return document.documentElement.scrollWidth <= window.innerWidth;
    })()`,
    returnByValue: true,
  });
  client.close();
  if (responsive.result?.value !== true) throw new Error("Theme or narrow-layout smoke check failed");
  console.log("Browser smoke passed:", result);
} finally {
  chrome?.kill("SIGTERM");
  vite.kill("SIGTERM");
  if (chrome?.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
