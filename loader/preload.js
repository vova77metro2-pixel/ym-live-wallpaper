// YM Live Wallpaper — preload-скрипт (работает в изолированном мире страницы).
'use strict';

// --- аварийный лог в файл (sandbox выключен, fs доступен) ---
const LOG_PATH = require('path').join(require('os').tmpdir(), 'ymwp-preload.log');
function logstep(msg) {
  try { require('fs').appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
logstep('preload start, url=' + (typeof location !== 'undefined' ? location.href : 'n/a'));

const { ipcRenderer, contextBridge } = require('electron');

// ---------- 1. Цепочка: подгружаем оригинальный preload Яндекс Музыки ----------
// Путь передан из main-процесса через additionalArguments — доступен синхронно,
// до выполнения скриптов страницы. API приложения не ломается.
const PREFIX = '--ymwp-original-preload=';
const arg = (process.argv || []).find(a => a.startsWith(PREFIX));
logstep('original preload arg: ' + (arg || '(нет)'));
if (arg) {
  const originalPath = arg.slice(PREFIX.length);
  if (originalPath) {
    try { require(originalPath); logstep('original preload ok'); }
    catch (e) { logstep('original preload FAILED: ' + (e && e.stack || e)); }
  }
}

// ---------- 2. API для страницы ----------
// Открыть нативный диалог выбора видео: в DevTools-консоли ввести ymwp.pick()
contextBridge.exposeInMainWorld('ymwp', {
  pick: () => ipcRenderer.invoke('ymwp:pick-wallpaper')
});

// ---------- 3. Состояние воспроизведения ----------
let video = null;
let appVisible = true; // что сообщил main-процесс (свёрнуто / перекрыто / скрыто)

function shouldPlay() {
  return appVisible && !document.hidden;
}

function applyPlayback() {
  if (!video) return;
  if (shouldPlay()) video.play().catch(() => {});
  else video.pause(); // декодирование и рендер кадров останавливаются
}

// ---------- 4. Инъекция видеоплеера ----------
// Флаг защищает от гонки DOMContentLoaded + MutationObserver (иначе два видео)
let injecting = false;

async function inject() {
  if (injecting) return;
  if (!document.body || document.getElementById('ym-live-wallpaper')) return;
  if (location.href.startsWith('chrome-error')) return; // страница ошибки — не внедряем
  injecting = true;
  logstep('inject() start, url=' + location.href);
  try {
    const cfg = await ipcRenderer.invoke('ymwp:get-config');
    const userCss = await ipcRenderer.invoke('ymwp:get-user-css');
    const brightness = Math.max(0, Math.min(1, 1 - (cfg.dim ?? 0.35)));

    const style = document.createElement('style');
    style.id = 'ym-live-wallpaper-style';
    // z-index:-1 в Chromium уходит под фон webContents, поэтому «бутерброд»:
    // видео на z=0, корневые контейнеры приложения поднимаем на z=1.
    style.textContent = `
#ym-live-wallpaper{
  position:fixed !important;
  inset:0 !important;
  width:100vw !important;
  height:100vh !important;
  object-fit:cover !important;
  z-index:0 !important;
  pointer-events:none !important;
  filter:brightness(${brightness});
  transform:translateZ(0);
  will-change:transform;
}
html,body{
  background:transparent !important;
  background-image:none !important;
  background-color:transparent !important;
}
/* Чёрный вырез при запуске: убираем сплэш-скрин НАСОВСЕМ.
   Раньше гасили только фон — но элемент мог рисовать рамку/градиент
   на псевдоэлементах. display:none гарантированно убирает его из потока. */
[class*="SplashScreen"]{
  display:none !important;
  opacity:0 !important;
  visibility:hidden !important;
  background:transparent !important;
  background-color:transparent !important;
  background-image:none !important;
  backdrop-filter:none !important;
}
[class*="SplashScreen"] *{
  background:transparent !important;
  background-image:none !important;
}
[class*="SplashScreen"]::before,
[class*="SplashScreen"]::after{ display:none !important; }
/* Экран и корень — прозрачные, чтобы видео было видно с первого кадра */
html,body,#root{
  background:transparent !important;
  background-color:transparent !important;
  background-image:none !important;
}
[class*="CommonLayout_root"],
[class*="DefaultLayout_root"],
[class*="WithTopBanner_root"],
[class*="WithTopBanner_content"]{
  background-color:transparent !important;
  background-image:none !important;
}
/* Контентные области: у Яндекс Музыки серый фон у страниц, списков
   треков, поиска и панели плеера. Снимаем его, чтобы обои просвечивали. */
[class*="Content_root"],
[class*="Content_main"],
[class*="MainPage_"],
[class*="Page_root"],
[class*="Collection_root"],
[class*="PlaylistPage_"],
[class*="SearchPage_"],
[class*="Search_root"],
[class*="TrackList"],
[class*="TracksList"],
[class*="Playlist_root"]{
  background-color:transparent !important;
  background-image:none !important;
}
/* Панель плеера внизу и полоса текущего трека */
[class*="PlayerBar"],
[class*="playingBar"],
[class*="NowPlaying"],
[class*="TrackBar"],
[class*="Player_root"]{
  background-color:transparent !important;
  background-image:none !important;
}
/* body > * с z-index:1 РАНЬШЕ ломал стеклянные панели и цвет иконок:
   любой дочерний контейнер получал свой stacking context. Видео и так
   на z-index:0, а интерфейс лежит выше него по порядку документа. */
${userCss || ''}`;
    document.head.appendChild(style);

    video = document.createElement('video');
    video.id = 'ym-live-wallpaper';
    video.loop = true;                 // бесконечный цикл
    video.autoplay = true;
    video.playsInline = true;
    video.muted = !(cfg.volume > 0);   // muted обязателен для autoplay
    if (cfg.volume > 0) video.volume = Math.min(1, cfg.volume);
    video.setAttribute('disablepictureinpicture', '');
    // ?t= — сброс кэша при смене файла
    video.src = 'ymwp://wallpaper/current?t=' + Date.now();
    video.addEventListener('error', () => logstep('video error: ' + (video.error && video.error.code + '/' + video.error.message)));
    video.addEventListener('playing', () => logstep('video playing'));

    document.body.prepend(video);
    applyPlayback();

    // Контрольный замер: что реально получилось
    setTimeout(() => {
      try {
        const v = document.getElementById('ym-live-wallpaper');
        if (!v) { logstep('CHECK: видео исчезло из DOM!'); return; }
        const cs = getComputedStyle(v);
        const r = v.getBoundingClientRect();
        logstep(`CHECK video: ${Math.round(r.width)}x${Math.round(r.height)} z=${cs.zIndex} paused=${v.paused} videoW=${v.videoWidth}`);

        // Кто рисует чёрное: ВСЕ крупные элементы с любой непрозрачной заливкой
        const suspects = [];
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width * r.height < innerWidth * innerHeight * 0.3) continue;
          const s = getComputedStyle(el);
          const bg = s.backgroundColor;
          const img = s.backgroundImage;
          const sh = s.boxShadow;
          const opaque = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
                         (img && img !== 'none') ||
                         (sh && sh !== 'none');
          if (opaque) {
            suspects.push(`${el.tagName} cls="${String(el.className).slice(0, 60)}" ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)} bg=${bg} img=${String(img).slice(0, 50)} shadow=${String(sh).slice(0, 50)}`);
          }
          if (suspects.length >= 15) break;
        }
        logstep('large painted elements:\n' + (suspects.join('\n') || '(нет)'));
      } catch (e) { logstep('check failed: ' + e.message); }
    }, 3000);
  } catch (e) {
    logstep('inject FAILED: ' + (e && e.stack || e));
  } finally {
    injecting = false;
  }
}

// Полный сброс и повторная инъекция (используется и reload-ом, и observer-ом)
function reinject(reason) {
  logstep('reinject: ' + reason);
  document.querySelectorAll('#ym-live-wallpaper, #ym-live-wallpaper-style')
    .forEach(el => el.remove());
  video = null;
  inject();
}

// Повторная инъекция, если SPA перерисует body
function watchDom() {
  if (!document.body) return;
  new MutationObserver(() => {
    if (!document.getElementById('ym-live-wallpaper') && !injecting) inject();
  }).observe(document.body, { childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { inject(); watchDom(); });
} else {
  inject();
  watchDom();
}

// ---------- 5. Управление из main-процесса и от Chromium ----------
ipcRenderer.on('ymwp:play', (_e, visible) => {
  appVisible = visible;
  applyPlayback();
});

ipcRenderer.on('ymwp:reload', () => reinject('ipc'));

// Chromium сам шлёт visibilitychange при сворачивании и полном перекрытии окна
document.addEventListener('visibilitychange', applyPlayback);

// Первый жест пользователя — на случай автoplay-политики при включённом звуке
document.addEventListener('pointerdown', () => applyPlayback(), { once: true });

// ============ YM Live Wallpaper: панель настроек интерфейса ============
// Подключается отдельным модулем и рисует свой DOM. Ничего из логики обоев
// выше не меняет: инъекция видео, пауза и перерисовка работают как раньше.
let settingsMod = null;
try {
  settingsMod = require('./settings.js');
  logstep('settings module loaded');
} catch (e) {
  logstep('settings module FAILED: ' + (e && e.stack || e));
}

// Открыть панель: Ctrl+Alt+W (из main) или ymwpSettings.open() в консоли
ipcRenderer.on('ymwp:open-settings', () => {
  try { if (settingsMod) settingsMod.open(); } catch (e) { logstep('open settings: ' + e.message); }
});

// Применить сохранённые настройки, когда видео уже внедрено
setTimeout(() => {
  try { if (settingsMod) settingsMod.applyToDom(settingsMod.readSettings()); }
  catch (e) { logstep('apply settings: ' + e.message); }
}, 2000);