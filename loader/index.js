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

// Node-стрим -> ReadableStream для Response
function streamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        try { controller.enqueue(new Uint8Array(chunk)); } catch {}
      });
      nodeStream.on('end', () => { try { controller.close(); } catch {} });
      nodeStream.on('error', (e) => {
        logstep('stream error: ' + e.message);
        try { controller.error(e); } catch {}
      });
    },
    cancel() {
      try { nodeStream.destroy(); } catch {}
    }
  });
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

  // Отдача видеофайла.
  // net.fetch(file://) ломался на путях с кириллицей и пробелами
  // (FFmpegDemuxer: data source error) и не поддерживал Range-запросы,
  // без которых Chromium не грузит длинные видео. Поэтому читаем файл
  // сами и отдаём стримом с поддержкой Range.
  protocol.handle('ymwp', async (request) => {
    const file = resolveWallpaper();
    if (!file) return new Response('no wallpaper', { status: 404 });
    try {
      if (!fs.existsSync(file)) {
        logstep('wallpaper missing: ' + file);
        return new Response('not found', { status: 404 });
      }
      const stat = fs.statSync(file);
      const total = stat.size;
      const range = request.headers.get('range');

      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.webm' ? 'video/webm'
        : ext === '.mov' ? 'video/quicktime'
        : 'video/mp4';

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': 'bytes */' + total }
          });
        }
        return new Response(streamToWeb(fs.createReadStream(file, { start, end })), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
          }
        });
      }

      return new Response(streamToWeb(fs.createReadStream(file)), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      });
    } catch (e) {
      logstep('protocol ympw FAILED: ' + (e && e.stack || e));
      return new Response('error', { status: 500 });
    }
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
    const srcFile = r.filePaths[0];

    // Готовим видео: если оно 4K/HEVC/большое — пережимаем в 1080p H.264.
    // Без этого Chromium падал с PIPELINE_ERROR_READ и обои не появлялись.
    const prepared = await prepareWallpaper(srcFile);

    const cfg = readConfig();
    cfg.file = prepared;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    broadcastReload();
    return cfg.file;
  });

  // Подготовка видеофайла.
  // 1) Проверяем, в порядке ли оно (1080p H.264, не больше 60 МБ).
  // 2) Если нет — при необходимости скачиваем ffmpeg (один раз, ~80 МБ)
  //    и пережимаем в 1080p в папку wallpapers.
  // 3) Если скачать/пережать не удалось — отдаём как есть.
  async function prepareWallpaper(file) {
    const path2 = require('path');
    const sizeMb = (() => { try { return fs.statSync(file).size / 1048576; } catch { return 0; } })();

    // Куда положим результат
    const base = path2.basename(file, path2.extname(file)).replace(/[^\w\-. ]+/g, '_');
    const out = path2.join(WALLPAPER_DIR, base + '_1080.mp4');

    // Читаем РЕАЛЬНЫЕ параметры видео.
    // Опираться только на размер нельзя: 4K-ролик на 24 МБ проиграться
    // не сможет (Chromium не декодирует 4K/60fps), а 1080p на 80 МБ —
    // вполне. Поэтому смотрим разрешение и кодек.
    let info = probeVideo(file);
    logstep('video probe: ' + JSON.stringify(info) + ' size=' + Math.round(sizeMb) + 'MB');

    let tooBig = sizeMb > 60;
    let is4k = info.width >= 2560 || info.height >= 1440;
    let isHevc = info.codec === 'hevc' || info.codec === 'h265';

    // Если встроенный разбор не дал размеров — уточняем через ffmpeg.
    // Он всё равно нужен для пережатия, поэтому качаем заранее.
    if (!info.ok && (tooBig || true)) {
      const ff = await ensureFfmpeg();
      if (ff) {
        const probed = await ffprobeVideo(ff, file);
        if (probed) {
          info = probed;
          logstep('video probe (ffmpeg): ' + JSON.stringify(info));
          is4k = info.width >= 2560 || info.height >= 1440;
          isHevc = info.codec === 'hevc' || info.codec === 'h265';
        }
      }
    }

    if (!tooBig && !is4k && !isHevc) {
      // Файл подходит как есть — копируем в папку обоев
      try {
        const target = path2.join(WALLPAPER_DIR, path2.basename(file));
        if (path2.resolve(target) !== path2.resolve(file)) {
          fs.copyFileSync(file, target);
        }
        logstep('wallpaper copied (ok as is): ' + path2.basename(target));
        return target;
      } catch (err) {
        logstep('copy failed: ' + err.message);
        return file;
      }
    }

    // Тяжёлый файл — нужен ffmpeg
    logstep('wallpaper needs convert (' + Math.round(sizeMb) + ' MB)');
    const ffmpeg = await ensureFfmpeg();
    if (!ffmpeg) {
      logstep('ffmpeg unavailable, falling back to original');
      return file;
    }

    const converted = await new Promise((resolve) => {
      try {
        const { execFile } = require('child_process');
        execFile(ffmpeg, [
          '-y', '-i', file,
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
          '-an', '-movflags', '+faststart',
          out
        ], { windowsHide: true, timeout: 600000 }, (err) => {
          if (err || !fs.existsSync(out)) {
            logstep('convert FAILED: ' + (err && err.message));
            resolve(null);
          } else {
            logstep('convert OK: ' + path2.basename(out));
            resolve(out);
          }
        });
      } catch (err) {
        logstep('convert spawn FAILED: ' + err.message);
        resolve(null);
      }
    });

    return converted || file;
  }

  // Чтение параметров видео из заголовка файла.
  // Разбираем MP4-боксы вручную: ищем 'moov'/'trak'/'tkhd' с размерами
  // и 'avc1'/'hvc1' с кодеком. Не требует ffmpeg и работает мгновенно.
  function probeVideo(file) {
    const result = { width: 0, height: 0, codec: '', ok: false };
    try {
      const fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      // Читаем первые 2 МБ — moov обычно в начале (faststart) или в конце
      const headLen = Math.min(size, 2 * 1024 * 1024);
      const head = Buffer.alloc(headLen);
      fs.readSync(fd, head, 0, headLen, 0);

      // Ищем 'moov' — если в конце, дочитываем хвост
      let buf = head;
      if (head.indexOf(Buffer.from('moov')) < 0) {
        try {
          const tailLen = Math.min(size, 8 * 1024 * 1024);
          const tail = Buffer.alloc(tailLen);
          fs.readSync(fd, tail, 0, tailLen, Math.max(0, size - tailLen));
          buf = Buffer.concat([head, tail]);
        } catch {}
      }
      fs.closeSync(fd);

      // Кодек: avc1 = H.264, hvc1/hev1 = H.265/HEVC, vp09 = VP9, av01 = AV1
      if (buf.indexOf(Buffer.from('hvc1')) >= 0 || buf.indexOf(Buffer.from('hev1')) >= 0) {
        result.codec = 'hevc';
      } else if (buf.indexOf(Buffer.from('avc1')) >= 0) {
        result.codec = 'h264';
      } else if (buf.indexOf(Buffer.from('vp09')) >= 0) {
        result.codec = 'vp9';
      } else if (buf.indexOf(Buffer.from('av01')) >= 0) {
        result.codec = 'av1';
      }

      // Размеры ищем в Sample Description (stsd): после 'avc1'/'hvc1'
      // идут width/height (по 2 байта) на смещении +24 от начала бокса.
      // Это надёжнее tkhd: там встречаются и аудио-дорожки, и матрицы.
      const codecs = ['avc1', 'hvc1', 'hev1', 'vp09', 'av01'];
      for (const cc of codecs) {
        let p = 0;
        while (true) {
          p = buf.indexOf(Buffer.from(cc), p);
          if (p < 0) break;
          // width/height — два uint16 BE на +24 и +26 от начала бокса
          if (p + 28 <= buf.length) {
            const w = buf.readUInt16BE(p + 24);
            const h = buf.readUInt16BE(p + 26);
            if (w > 16 && w < 20000 && h > 16 && h < 20000) {
              result.width = w;
              result.height = h;
              if (cc === 'hvc1' || cc === 'hev1') result.codec = 'hevc';
              break;
            }
          }
          p += 4;
        }
        if (result.width) break;
      }
      result.ok = result.width > 0 && result.height > 0;
    } catch (e) {
      logstep('probeVideo failed: ' + e.message);
    }
    return result;
  }

  // Определение параметров видео через ffmpeg (если встроенный разбор
  // не справился). ffmpeg печатает строку вида:
  //   Stream #0:0: Video: h264 (Main), yuv420p, 3840x2160, 60 fps
  function ffprobeVideo(ffmpeg, file) {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      try {
        execFile(ffmpeg, ['-i', file], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
          const text = String(stdout || '') + String(stderr || '');
          const m = text.match(/Video:\s*([a-zA-Z0-9]+)[^\n]*?(\d{2,5})x(\d{2,5})/);
          if (!m) { resolve(null); return; }
          const codec = m[1].toLowerCase();
          resolve({
            width: parseInt(m[2], 10),
            height: parseInt(m[3], 10),
            codec: (codec === 'hevc' || codec === 'h265') ? 'hevc' : codec,
            ok: true
          });
        });
      } catch { resolve(null); }
    });
  }

  // Поиск или скачивание ffmpeg.
  // Ищем: рядом с приложением, в папке мода, в PATH. Если нигде нет —
  // скачиваем статическую сборку с GitHub в %APPDATA%\ym-live-wallpaper\ffmpeg\
  // и распаковываем через PowerShell Expand-Archive.
  async function ensureFfmpeg() {
    const path2 = require('path');
    const ffDir = path2.join(MOD_DIR, 'ffmpeg');
    const ffLocal = path2.join(ffDir, 'ffmpeg.exe');

    // 1. Уже скачан
    if (fs.existsSync(ffLocal)) {
      logstep('ffmpeg found (cached): ' + ffLocal);
      return ffLocal;
    }
    // 2. Рядом с приложением (если пользователь положил сам)
    const beside = [
      path2.join(__dirname, '..', '..', 'ffmpeg.exe'),
      path2.join(__dirname, 'ffmpeg.exe')
    ];
    for (const c of beside) {
      if (fs.existsSync(c)) { logstep('ffmpeg found (beside): ' + c); return c; }
    }
    // 3. В PATH
    try {
      const { execFileSync } = require('child_process');
      execFileSync('ffmpeg', ['-version'], { windowsHide: true, timeout: 5000 });
      logstep('ffmpeg found (PATH)');
      return 'ffmpeg';
    } catch {}

    // 4. Скачиваем
    logstep('ffmpeg not found, downloading...');
    const ok = await downloadFfmpeg(ffDir);
    if (ok && fs.existsSync(ffLocal)) return ffLocal;
    return null;
  }

  // Скачивание и распаковка ffmpeg.
  // Нужна СТАТИЧЕСКАЯ сборка (один exe без DLL). Обычная сборка тянет
  // рядом 180 МБ библиотек, что для "по требованию" слишком много.
  function downloadFfmpeg(targetDir) {
    const path2 = require('path');
    const { execFile } = require('child_process');
    const os = require('os');
    // essentials build: один статический ffmpeg.exe (~80 МБ)
    const zipUrl = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip';
    const zipPath = path2.join(os.tmpdir(), 'ymwp-ffmpeg.zip');

    // Скачиваем через PowerShell (curl в Windows может не быть)
    const psDownload = `
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri '${zipUrl}' -OutFile '${zipPath}' -UseBasicParsing -TimeoutSec 600
`;
    return new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-Command', psDownload],
        { windowsHide: true, timeout: 660000 }, (err) => {
          if (err || !fs.existsSync(zipPath)) {
            logstep('ffmpeg download FAILED: ' + (err && err.message));
            return resolve(false);
          }
          logstep('ffmpeg downloaded: ' + Math.round(fs.statSync(zipPath).size / 1048576) + ' MB');

          // Распаковываем, оставляя только ffmpeg.exe
          const extractDir = path2.join(require('os').tmpdir(), 'ymwp-ffmpeg-x');
          try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
          const psExtract = `
$ProgressPreference = 'SilentlyContinue'
Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force
New-Item -ItemType Directory -Force -Path '${targetDir}' | Out-Null
Get-ChildItem -Path '${extractDir}' -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1 | Copy-Item -Destination '${path2.join(targetDir, 'ffmpeg.exe')}' -Force
Get-ChildItem -Path '${extractDir}' -Recurse -Filter '*.dll' | Copy-Item -Destination '${targetDir}' -Force
Remove-Item '${zipPath}' -Force -ErrorAction SilentlyContinue
Remove-Item '${extractDir}' -Recurse -Force -ErrorAction SilentlyContinue
`;
          execFile('powershell', ['-NoProfile', '-Command', psExtract],
            { windowsHide: true, timeout: 180000 }, (err2) => {
              const target = path2.join(targetDir, 'ffmpeg.exe');
              if (err2 || !fs.existsSync(target)) {
                logstep('ffmpeg extract FAILED: ' + (err2 && err2.message));
                return resolve(false);
              }
              logstep('ffmpeg extracted: ' + target);
              resolve(true);
            });
        });
    });
  }

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