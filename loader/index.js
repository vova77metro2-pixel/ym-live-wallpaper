// YM Live Wallpaper — загрузчик main-процесса.
// Ставится на место resources\app.asar, патчит BrowserWindow и подгружает
// оригинальное приложение из app.asar.original.
'use strict';

// --- аварийный лог: пишет каждый шаг, чтобы диагностировать падение ---
const LOG_PATH = require('path').join(require('os').tmpdir(), 'ymwp-loader.log');
function logstep(msg) {
  try { require('fs').appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
process.on('uncaughtException', (e) => {
  logstep('UNCAUGHT: ' + (e && e.stack || e));
});
logstep('loader start');

const path = require('path');
const fs = require('fs');
const electron = require('electron');
const { pathToFileURL } = require('url');

const { app, ipcMain, protocol, net, dialog } = electron;
const OriginalBrowserWindow = electron.BrowserWindow;
logstep('electron required, app=' + typeof app + ', BW=' + typeof OriginalBrowserWindow);

// ---------- Пути и конфиг ----------
const MOD_DIR = path.join(app.getPath('appData'), 'ym-live-wallpaper');
const WALLPAPER_DIR = path.join(MOD_DIR, 'wallpapers');
const CONFIG_PATH = path.join(MOD_DIR, 'config.json');
const USER_CSS_PATH = path.join(MOD_DIR, 'wallpaper.css');

const DEFAULT_CSS = `/* YM Live Wallpaper — переопределения стилей приложения.
   Файл подхватывается автоматически при сохранении (без перезапуска). */

/* Прозрачные контейнеры: у корня лейаута фон — чёрный linear-gradient,
   поэтому сбрасываем и background-color, и background-image */
div, main, section, aside, header, footer, nav {
  background-color: transparent !important;
  background-image: none !important;
}

/* Скрываем фирменный анимированный фон «Моей волны» — его заменяют живые обои */
[class*="VibePage"] canvas,
[class*="vibe"] canvas {
  display: none !important;
}
`;

function ensureDirs() {
  fs.mkdirSync(WALLPAPER_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      file: null,        // явный путь к видео; null = брать самый свежий из wallpapers/
      pauseOnBlur: false, // true = пауза при потере фокуса окном
      dim: 0.35,         // затемнение видео 0..0.9 (читаемость интерфейса)
      volume: 0          // громкость видео 0..1 (0 = muted, autoplay гарантирован)
    }, null, 2));
  }
  if (!fs.existsSync(USER_CSS_PATH)) {
    fs.writeFileSync(USER_CSS_PATH, DEFAULT_CSS);
  }
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function resolveWallpaper() {
  const cfg = readConfig();
  if (cfg.file && fs.existsSync(cfg.file)) return cfg.file;
  try {
    const files = fs.readdirSync(WALLPAPER_DIR)
      .filter(f => /\.(mp4|webm|mov)$/i.test(f))
      .map(f => ({ f, m: fs.statSync(path.join(WALLPAPER_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) return path.join(WALLPAPER_DIR, files[0].f);
  } catch {}
  return null;
}

// ---------- Привилегированная схема ymwp:// ----------
// Должна быть зарегистрирована ДО app.ready. bypassCSP решает проблему
// с Content-Security-Policy страницы music.yandex.ru, stream — потоковое видео.
protocol.registerSchemesAsPrivileged([{
  scheme: 'ymwp',
  privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: false }
}]);

// ---------- Патч BrowserWindow ----------
// Экспорты electron — неконфигурируемые геттеры, defineProperty не сработает.
// Поэтому перехватываем Module._load: код оригинального приложения получает
// прокси, в котором BrowserWindow — наш подкласс.
class PatchedBrowserWindow extends OriginalBrowserWindow {
  constructor(options = {}) {
    options.webPreferences = options.webPreferences || {};
    const wp = options.webPreferences;
    if (!wp.__ymwp) {
      wp.__ymwp = true;
      // передаём путь к оригинальному preload через argv —
      // наш preload подгрузит его синхронно, до скриптов страницы
      wp.additionalArguments = [
        ...(wp.additionalArguments || []),
        `--ymwp-original-preload=${wp.preload || ''}`
      ];
      wp.preload = path.join(__dirname, 'preload.js');
      wp.sandbox = false; // иначе require() оригинального preload невозможен
    }
    // Окно показывается как обычно (без скрытия и паузы). Чёрный вырез
    // убираем не через отложенный показ, а прозрачным фоном окна и
    // прозрачным сплэш-скрином: приложение сразу рисует главный экран.
    if (options.backgroundColor === undefined) options.backgroundColor = '#00000000';

    super(options);
    logstep('BrowserWindow created, preload=' + wp.preload);

    trackedWindows.add(this);
    this.on('closed', () => trackedWindows.delete(this));
    hookWindow(this);
  }
}

// Свой реестр окон (getAllWindows через прокси может не совпадать с реестром рантайма)
const trackedWindows = new Set();

const electronProxy = new Proxy(electron, {
  get(target, prop) {
    if (prop === 'BrowserWindow') return PatchedBrowserWindow;
    return Reflect.get(target, prop);
  }
});

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  const exports = originalLoad.call(this, request, ...rest);
  if (request === 'electron') return electronProxy;
  return exports;
};
logstep('Module._load hooked');

// ---------- Трекинг видимости окна -> пауза/продолжение видео ----------
function computeVisible(win) {
  if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) return false;
  // isOccluded(): окно полностью перекрыто или рабочий стол переключён
  // (Windows/macOS, Electron 24+)
  if (typeof win.isOccluded === 'function' && win.isOccluded()) return false;
  return true;
}

function hookWindow(win) {
  const sendPlay = (play) => {
    if (!win.isDestroyed()) win.webContents.send('ymwp:play', play);
  };
  const update = () => sendPlay(computeVisible(win));

  win.webContents.on('did-start-navigation', (_e, url) => logstep('did-start-navigation: ' + url));
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) =>
    logstep(`did-fail-load: code=${code} "${desc}" url=${url} main=${isMainFrame}`));

  win.on('minimize', () => sendPlay(false));
  win.on('restore', update);
  win.on('hide', () => sendPlay(false));
  win.on('show', update);
  win.on('focus', update);
  win.on('blur', () => { if (readConfig().pauseOnBlur) sendPlay(false); });

  // У Electron нет события окклюзии — опрашиваем раз в секунду
  const timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    update();
  }, 1000);
}

// ---------- Готовность приложения ----------
app.whenReady().then(() => {
  ensureDirs();

  protocol.handle('ymwp', () => {
    const file = resolveWallpaper();
    if (!file) return new Response('no wallpaper', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ipcMain.handle('ymwp:get-config', () => ({
    ...readConfig(),
    wallpaper: resolveWallpaper()
  }));

  ipcMain.handle('ymwp:get-user-css', () => {
    try { return fs.readFileSync(USER_CSS_PATH, 'utf8'); } catch { return ''; }
  });

  // Нативный диалог выбора видео (вызывается из DevTools: ymwp.pick())
  ipcMain.handle('ymwp:pick-wallpaper', async (e) => {
    const win = PatchedBrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите видео для живых обоев',
      filters: [{ name: 'Видео', extensions: ['mp4', 'webm', 'mov'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const cfg = readConfig();
    cfg.file = r.filePaths[0];
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    broadcastReload();
    return cfg.file;
  });

  // Авто-перезагрузка видео при смене файла в папке или правке конфига/css
  fs.watch(WALLPAPER_DIR, { persistent: false }, debounce(() => { logstep('wallpapers dir changed'); broadcastReload(); }, 300));
  fs.watch(MOD_DIR, { persistent: false }, debounce(() => { logstep('mod dir changed'); broadcastReload(); }, 300));
});

function broadcastReload() {
  logstep('broadcastReload to ' + trackedWindows.size + ' windows');
  for (const win of trackedWindows) {
    if (!win.isDestroyed()) win.webContents.send('ymwp:reload');
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Запуск оригинальной Яндекс Музыки ----------
// Бэкап называется original.asar: Node распознаёт asar-архивы только по
// расширению .asar, поэтому app.asar.original не загрузился бы.
const originalPath = path.join(__dirname, '..', 'original.asar');

// Оригинальное приложение ищет свои ресурсы (renderer для music-application://
// и т.п.) через app.getAppPath() — перенаправляем его на original.asar.
try {
  app.setAppPath(originalPath);
  logstep('app.setAppPath -> ' + app.getAppPath());
} catch (e) {
  logstep('setAppPath FAILED: ' + (e && e.stack || e));
}
logstep('loading original: ' + originalPath + ' exists=' + fs.existsSync(originalPath));
try {
  require(originalPath);
  logstep('original loaded ok');
} catch (e) {
  logstep('original load FAILED: ' + (e && e.stack || e));
  throw e;
}

// ============ YM Live Wallpaper: хоткей настроек ============
// Ctrl+Alt+W открывает панель настроек в окне приложения. Трей не делаем,
// чтобы не мешать родной иконке Яндекс Музыки.
try {
  const { globalShortcut } = require('electron');
  app.whenReady().then(() => {
    try {
      const ok = globalShortcut.register('CommandOrControl+Alt+W', () => {
        logstep('hotkey Ctrl+Alt+W');
        for (const win of trackedWindows) {
          if (!win.isDestroyed()) win.webContents.send('ymwp:open-settings');
        }
      });
      logstep('hotkey registered: ' + ok);
    } catch (e) {
      logstep('hotkey failed: ' + (e && e.message));
    }
  });
} catch (e) {
  logstep('hotkey module failed: ' + (e && e.message));
}
// ============ Отключение автообновления ============
// Надёжнее, чем правка app-update.yml: подменяем модуль electron-updater,
// чтобы приложение физически не могло проверить и скачать обновление.
// Обновление перезаписало бы app.asar и exe — мод бы слетел.
try {
  const Module2 = require('module');
  const origLoad2 = Module2._load;
  const BLOCKED = /electron-updater|electron-updater\/out\/main/;
  Module2._load = function (request, ...rest) {
    if (BLOCKED.test(String(request))) {
      logstep('BLOCKED electron-updater: ' + request);
      const noop = () => {};
      return {
        autoUpdater: {
          on: noop, once: noop, removeAllListeners: noop,
          checkForUpdates: () => Promise.resolve(null),
          checkForUpdatesAndNotify: () => Promise.resolve(null),
          downloadUpdate: () => Promise.resolve([]),
          quitAndInstall: noop,
          autoDownload: false, autoInstallOnAppQuit: false,
          forceDevUpdateConfig: false,
          allowPrerelease: false,
          allowDowngrade: false,
          logger: { info: noop, warn: noop, error: noop, debug: noop }
        },
        CancellationToken: class { cancel() {} dispose() {} },
        Provider: class {},
        isUpdaterActive: () => false
      };
    }
    return origLoad2.call(this, request, ...rest);
  };
  logstep('electron-updater blocked');
} catch (e) {
  logstep('updater block failed: ' + (e && e.message));
}