// YM Live Wallpaper — панель настроек интерфейса.
// Живёт в изолированном мире preload и рисует в DOM страницы.
// Настройки применяются сразу, без перезапуска приложения.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const LOG_PATH = path.join(os.tmpdir(), 'ymwp-settings.log');
function logstep(msg) {
  try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

const { ipcRenderer } = require('electron');

const MOD_DIR = path.join(
  process.env.APPDATA ||
  (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config')),
  'ym-live-wallpaper'
);
const SETTINGS_PATH = path.join(MOD_DIR, 'settings.json');

// ---------- Схема ----------
// По умолчанию все подложки = 0, то есть панели полностью прозрачные.
// Это текущее рабочее состояние — настройки только ДОБАВЛЯЮТ эффекты.
const DEFAULTS = {
  // Обои
  dim: 0.35, brightness: 1, saturation: 1, contrast: 1,
  // Стиль
  uiScale: 100, panelOpacity: 0, panelBlur: 0, radius: 12,
  sidebarCompact: false, hideSidebar: false,
  // Шрифт
  fontScale: 100, fontWeight: 400, fontFamily: 'default',
  letterSpacing: 0, fontStyle: 'normal',
  // Плеер
  playerOpacity: 0, playerBlur: 0, hidePlayer: false,
  // Прочее
  hideSplash: true, textShadow: true, hideCovers: false, hideAccount: false, hideMainContent: false,
  vignette: 0, grain: 0,
  // Интерфейс
  iconScale: 100, rowGap: 0,
  grayscale: 0, sepia: 0, invert: false, hideScrollbars: false, smoothScroll: true,
};

const TABS = [
  {
    id: 'wallpaper', label: 'Обои', items: [
      { key: 'dim', type: 'range', min: 0, max: 0.9, step: 0.05, label: 'Затемнение', unit: '%', scale: 100 },
      { key: 'brightness', type: 'range', min: 0.3, max: 2, step: 0.05, label: 'Яркость', unit: '%', scale: 100 },
      { key: 'saturation', type: 'range', min: 0, max: 2, step: 0.05, label: 'Насыщенность', unit: '%', scale: 100 },
      { key: 'contrast', type: 'range', min: 0.5, max: 1.8, step: 0.05, label: 'Контраст', unit: '%', scale: 100 },
      { key: 'vignette', type: 'range', min: 0, max: 1, step: 0.05, label: 'Виньетка', unit: '%', scale: 100 },
      { key: 'grain', type: 'range', min: 0, max: 1, step: 0.05, label: 'Зерно', unit: '%', scale: 100 },
      { action: 'pick', label: 'Выбрать видео…' }
    ]
  },
  {
    id: 'style', label: 'Стиль', items: [
      { key: 'uiScale', type: 'range', min: 70, max: 150, step: 5, label: 'Масштаб интерфейса', unit: '%' },
      { key: 'panelOpacity', type: 'range', min: 0, max: 1, step: 0.05, label: 'Прозрачность панелей', unit: '%', scale: 100 },
      { key: 'panelBlur', type: 'range', min: 0, max: 40, step: 2, label: 'Размытие панелей', unit: ' px' },
      { key: 'radius', type: 'range', min: 0, max: 28, step: 2, label: 'Скругление карточек', unit: ' px' },
      { key: 'sidebarCompact', type: 'bool', label: 'Компактный сайдбар', hint: 'Только Поиск, Моя волна, Мне нравится' },
      { key: 'hideSidebar', type: 'bool', label: 'Скрыть сайдбар', hint: 'Виден только при наведении' },
      { key: 'hideAccount', type: 'bool', label: 'Убрать плашку аккаунта', hint: 'Прячет «Валера / Плюс» внизу сайдбара' },
      { key: 'hideMainContent', type: 'bool', label: 'Убрать контент главной', hint: 'Остаются только обои и панели — как в видео' },
      { key: 'hideCovers', type: 'bool', label: 'Убрать обложки', hint: 'Текст поверх обоев, без картинок' }
    ]
  },
  {
    id: 'font', label: 'Шрифт', items: [
      { key: 'fontScale', type: 'range', min: 80, max: 140, step: 5, label: 'Размер шрифта', unit: '%' },
      { key: 'fontWeight', type: 'range', min: 200, max: 900, step: 100, label: 'Толщина шрифта' },
      { key: 'letterSpacing', type: 'range', min: -2, max: 8, step: 0.5, label: 'Межбуквенное', unit: ' px' },
      {
        key: 'fontFamily', type: 'fontselect', label: 'Гарнитура',
        // Превью рисуется РЕАЛЬНЫМ шрифтом прямо в списке: слово "Моя волна"
        // и буквы "АаБбВв", чтобы выбор был наглядным.
        options: [
          { value: 'default', label: 'Как в Яндекс Музыке', css: '', weight: '' },

          // --- тонкие, светлые (стиль видео) ---
          { value: 'sev dl', label: 'Segoe UI Variable Display Light', css: '"Segoe UI Variable Display Light"', weight: 300 },
          { value: 'sev tl', label: 'Segoe UI Variable Text Light', css: '"Segoe UI Variable Text Light"', weight: 300 },
          { value: 'seg light', label: 'Segoe UI Light', css: '"Segoe UI Light"', weight: 300 },
          { value: 'seg semilight', label: 'Segoe UI Semilight', css: '"Segoe UI Semilight"', weight: 350 },
          { value: 'bahn light', label: 'Bahnschrift Light', css: '"Bahnschrift Light"', weight: 300 },
          { value: 'bahn semilight', label: 'Bahnschrift SemiLight', css: '"Bahnschrift SemiLight"', weight: 350 },
          { value: 'calibri light', label: 'Calibri Light', css: '"Calibri Light"', weight: 300 },
          { value: 'candara light', label: 'Candara Light', css: '"Candara Light"', weight: 300 },
          { value: 'corbel light', label: 'Corbel Light', css: '"Corbel Light"', weight: 300 },

          // --- обычные гротески ---
          { value: 'seg', label: 'Segoe UI', css: '"Segoe UI"', weight: 400 },
          { value: 'sev', label: 'Segoe UI Variable', css: '"Segoe UI Variable Display"', weight: 400 },
          { value: 'inter', label: 'Inter', css: '"Inter"', weight: 400 },
          { value: 'calibri', label: 'Calibri', css: 'Calibri', weight: 400 },
          { value: 'candara', label: 'Candara', css: 'Candara', weight: 400 },
          { value: 'corbel', label: 'Corbel', css: 'Corbel', weight: 400 },
          { value: 'trebuchet', label: 'Trebuchet MS', css: '"Trebuchet MS"', weight: 400 },
          { value: 'tahoma', label: 'Tahoma', css: 'Tahoma', weight: 400 },
          { value: 'verdana', label: 'Verdana', css: 'Verdana', weight: 400 },
          { value: 'bahn', label: 'Bahnschrift', css: 'Bahnschrift', weight: 400 },
          { value: 'gill', label: 'Gill Sans MT', css: '"Gill Sans MT"', weight: 400 },
          { value: 'century', label: 'Century Gothic', css: '"Century Gothic"', weight: 400 },
          { value: 'franklin', label: 'Franklin Gothic', css: '"Franklin Gothic Book"', weight: 400 },
          { value: 'yu', label: 'Yu Gothic UI', css: '"Yu Gothic UI"', weight: 400 },
          { value: 'leelawadee', label: 'Leelawadee UI', css: '"Leelawadee UI"', weight: 400 },

          // --- жирные ---
          { value: 'seg bold', label: 'Segoe UI Bold', css: '"Segoe UI"', weight: 700 },
          { value: 'seg black', label: 'Segoe UI Black', css: '"Segoe UI Black"', weight: 900 },
          { value: 'bahn semibold', label: 'Bahnschrift SemiBold', css: '"Bahnschrift SemiBold"', weight: 600 },
          { value: 'franklin heavy', label: 'Franklin Gothic Heavy', css: '"Franklin Gothic Heavy"', weight: 900 },
          { value: 'gill ultra', label: 'Gill Sans Ultra Bold', css: '"Gill Sans Ultra Bold"', weight: 900 },

          // --- узкие ---
          { value: 'bahn cond', label: 'Bahnschrift Condensed', css: '"Bahnschrift Condensed"', weight: 400 },
          { value: 'bahn light cond', label: 'Bahnschrift Light Condensed', css: '"Bahnschrift Light Condensed"', weight: 300 },
          { value: 'franklin cond', label: 'Franklin Gothic Condensed', css: '"Franklin Gothic Demi Cond"', weight: 400 },

          // --- курсив и рукописные ---
          { value: 'seg italic', label: 'Segoe UI Italic', css: '"Segoe UI"', weight: 400, style: 'italic' },
          { value: 'seg light italic', label: 'Segoe UI Light Italic', css: '"Segoe UI Light"', weight: 300, style: 'italic' },
          { value: 'segoe script', label: 'Segoe Script', css: '"Segoe Script"', weight: 400 },
          { value: 'segoe print', label: 'Segoe Print', css: '"Segoe Print"', weight: 400 },
          { value: 'eras light', label: 'Eras Light ITC', css: '"Eras Light ITC"', weight: 300 },

          // --- с засечками ---
          { value: 'georgia', label: 'Georgia', css: 'Georgia', weight: 400 },
          { value: 'cambria', label: 'Cambria', css: 'Cambria', weight: 400 },
          { value: 'palatino', label: 'Palatino Linotype', css: '"Palatino Linotype"', weight: 400 },
          { value: 'constantia', label: 'Constantia', css: 'Constantia', weight: 400 },
          { value: 'book antiqua', label: 'Book Antiqua', css: '"Book Antiqua"', weight: 400 },

          // --- моно ---
          { value: 'consolas', label: 'Consolas', css: 'Consolas', weight: 400 },
          { value: 'cascadia', label: 'Cascadia Mono', css: '"Cascadia Mono"', weight: 400 },
          { value: 'courier', label: 'Courier New', css: '"Courier New"', weight: 400 }
        ]
      },
      {
        key: 'fontStyle', type: 'select', label: 'Начертание', options: [
          { value: 'normal', label: 'Обычное' },
          { value: 'italic', label: 'Курсив' }
        ]
      }
    ]
  },
  {
    id: 'player', label: 'Плеер', items: [
      { key: 'playerOpacity', type: 'range', min: 0, max: 1, step: 0.05, label: 'Прозрачность плеера', unit: '%', scale: 100 },
      { key: 'playerBlur', type: 'range', min: 0, max: 40, step: 2, label: 'Размытие плеера', unit: ' px' },
      { key: 'hidePlayer', type: 'bool', label: 'Скрыть плеер', hint: 'Появится при наведении' }
    ]
  },
  {
    id: 'interface', label: 'Интерфейс', items: [
      { key: 'iconScale', type: 'range', min: 80, max: 130, step: 5, label: 'Размер иконок', unit: '%' },
      { key: 'rowGap', type: 'range', min: 0, max: 24, step: 2, label: 'Отступ между строками', unit: ' px' },
      { key: 'grayscale', type: 'range', min: 0, max: 1, step: 0.1, label: 'Обесцвечивание ОБОЕВ', unit: '%', scale: 100 },
      { key: 'sepia', type: 'range', min: 0, max: 1, step: 0.1, label: 'Сепия ОБОЕВ', unit: '%', scale: 100 },
      { key: 'invert', type: 'bool', label: 'Инверсия ОБОЕВ' },
      { key: 'hideScrollbars', type: 'bool', label: 'Скрыть полосы прокрутки' },
      { key: 'smoothScroll', type: 'bool', label: 'Плавная прокрутка' }
    ]
  },
  {
    id: 'misc', label: 'Прочее', items: [
      { key: 'hideSplash', type: 'bool', label: 'Прятать чёрный сплэш' },
      { key: 'textShadow', type: 'bool', label: 'Тень у текста' }
    ]
  }
];

const KEYS = [];
for (const t of TABS) for (const it of t.items) if (it.key) KEYS.push(it.key);

function readSettings() {
  const out = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    for (const k of KEYS) if (raw[k] !== undefined) out[k] = raw[k];
  } catch {}
  return out;
}

function writeSettings(obj) {
  const clean = { ...DEFAULTS };
  for (const k of KEYS) if (obj && obj[k] !== undefined) clean[k] = obj[k];
  fs.mkdirSync(MOD_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(clean, null, 2));
  return clean;
}

// ---------- Применение настроек к странице ----------
function applyToDom(s) {
  const video = document.getElementById('ym-live-wallpaper');
  if (video) {
    // Все визуальные фильтры — ТОЛЬКО на видео. На <html> вешать нельзя:
    // это ломает цвет иконок и рисует чёрный вырез вместо сплэша.
    video.style.filter = [
      `brightness(${(1 - Number(s.dim)).toFixed(2)})`,
      `saturate(${Number(s.saturation)})`,
      `contrast(${Number(s.contrast)})`,
      `brightness(${Number(s.brightness)})`,
      Number(s.grayscale) > 0 ? `grayscale(${Number(s.grayscale)})` : '',
      Number(s.sepia) > 0 ? `sepia(${Number(s.sepia)})` : '',
      s.invert ? 'invert(1) hue-rotate(180deg)' : ''
    ].filter(Boolean).join(' ');
  }

  const root = document.documentElement;
  root.classList.toggle('ymwp-text-shadow', !!s.textShadow);

  root.classList.toggle('ymwp-compact-sidebar', !!s.sidebarCompact);
  root.classList.toggle('ymwp-hide-sidebar', !!s.hideSidebar);
  root.classList.toggle('ymwp-hide-player', !!s.hidePlayer);
  root.classList.toggle('ymwp-hide-covers', !!s.hideCovers);
  root.classList.toggle('ymwp-hide-account', !!s.hideAccount);
  root.classList.toggle('ymwp-hide-main', !!s.hideMainContent);

  // Гарнитура: css/вес/стиль берём из выбранной опции fontselect
  let family = '', optWeight = '', optStyle = '';
  const fontDef = findItem('fontFamily');
  if (fontDef && fontDef.options) {
    const opt = fontDef.options.find(o => o.value === s.fontFamily);
    if (opt) {
      family = opt.css || '';
      optWeight = opt.weight ? String(opt.weight) : '';
      optStyle = opt.style || '';
    }
  }
  // Итоговый вес/стиль: если у шрифта свой (например Segoe UI Black = 900),
  // используем его, иначе — значение из слайдеров.
  const finalWeight = Number(s.fontWeight);
  const finalStyle = s.fontStyle === 'italic' ? 'italic' : 'normal';
  const useOptWeight = optWeight && finalWeight === 400; // слайдер не трогали
  const weightCss = useOptWeight ? optWeight : String(finalWeight);
  const styleCss = optStyle || finalStyle;

  let st = document.getElementById('ymwp-settings-vars');
  if (!st) {
    st = document.createElement('style');
    st.id = 'ymwp-settings-vars';
    document.head.appendChild(st);
  }

  // Виньетка и зерно — отдельные слои над видео, но под интерфейсом
  let ov = document.getElementById('ymwp-overlay-layers');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ymwp-overlay-layers';
    ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;';
    document.body.appendChild(ov);
  }
  const vig = Number(s.vignette);
  const grain = Number(s.grain);
  ov.innerHTML =
    (vig > 0 ? `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,${vig}) 100%);"></div>` : '') +
    (grain > 0 ? `<div style="position:absolute;inset:0;opacity:${grain};background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22/></filter><rect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.5%22/></svg>');"></div>` : '');

  st.textContent = `
/* --- панели: заливка и размытие ТОЛЬКО если выкручены ---
   ВАЖНО: backdrop-filter даже с нулевыми значениями создаёт stacking
   context. Из-за этого цветные иконки Яндекса становились белыми.
   Поэтому правило вообще не выводится, пока пользователь не включил
   прозрачность/размытие панелей. */
${Number(s.panelOpacity) > 0 || Number(s.panelBlur) > 0 ? `
aside[class*="Navbar_root"]{
  background-color:rgba(10,12,16,${Number(s.panelOpacity)}) !important;
  ${Number(s.panelBlur) > 0 ? `backdrop-filter:blur(${Number(s.panelBlur)}px) saturate(120%);
  -webkit-backdrop-filter:blur(${Number(s.panelBlur)}px) saturate(120%);` : ''}
}` : ''}
${Number(s.playerOpacity) > 0 || Number(s.playerBlur) > 0 ? `
[class*="VibePlayerBar_root"],
[class*="PlayerBar_root"]{
  background-color:rgba(8,10,14,${Number(s.playerOpacity)}) !important;
  ${Number(s.playerBlur) > 0 ? `backdrop-filter:blur(${Number(s.playerBlur)}px) saturate(125%);
  -webkit-backdrop-filter:blur(${Number(s.playerBlur)}px) saturate(125%);` : ''}
}` : ''}
/* --- скругление карточек --- */
[class*="Card_root"]:not([class*="CardTitle"]),
[class*="EntityCard_root"]{
  border-radius:${Number(s.radius)}px;
}
/* --- масштаб и типографика --- */
html{ zoom:${(Number(s.uiScale) / 100).toFixed(2)}; }
html{ font-size:calc(16px * ${(Number(s.fontScale) / 100).toFixed(2)}); }
${family ? `
/* Применяем шрифт ко всему интерфейсу. Яндекс задаёт шрифты через свои
   правила и CSS-переменные, поэтому перекрываем и переменные, и свойства. */
:root{
  --ym-font-family:${family};
  --ym-font-family-text:${family};
}
body, body *, body *::before, body *::after{
  font-family:${family} !important;
  font-weight:${weightCss} !important;
  font-style:${styleCss} !important;
  letter-spacing:${Number(s.letterSpacing)}px !important;
}
/* Исключаем иконки: у них шрифт-глиф, смена ломает отображение */
[class*="Icon"] svg, svg, [class*="icon"]{
  font-family:inherit;
}
` : `
body, body *{
  font-weight:${weightCss} !important;
  font-style:${styleCss} !important;
  letter-spacing:${Number(s.letterSpacing)}px;
}
`}
/* --- компактный сайдбар: оставляем Поиск, Моя волна, плейлисты --- */
.ymwp-compact-sidebar [class*="NavbarDesktop_navigation"] li{ display:none; }
.ymwp-compact-sidebar [class*="NavbarDesktop_navigation"] li:nth-child(1),
.ymwp-compact-sidebar [class*="NavbarDesktop_navigation"] li:nth-child(2){ display:block; }
.ymwp-compact-sidebar [class*="PinsList_root"]{ display:block; }
/* --- скрыть сайдбар, показывать при наведении --- */
.ymwp-hide-sidebar aside[class*="Navbar_root"]{ opacity:0; transition:opacity .18s; }
.ymwp-hide-sidebar aside[class*="Navbar_root"]:hover{ opacity:1; }
/* --- скрыть плеер, показать при наведении --- */
.ymwp-hide-player [class*="VibePlayerBar_root"]{ opacity:0; transition:opacity .18s; }
.ymwp-hide-player [class*="VibePlayerBar_root"]:hover{ opacity:1; }
/* --- без обложек --- */
.ymwp-hide-covers [class*="Card_cover"],
.ymwp-hide-covers [class*="EntityCard_image"],
.ymwp-hide-covers [class*="CardImage"]{ display:none !important; }
/* --- убрать плашку аккаунта внизу сайдбара ---
   Классы Яндекса обфусцированы, поэтому ловим по нескольким признакам:
   UserProfile, Account, Footer, PinsList в конце навбара. */
.ymwp-hide-account [class*="UserProfile"],
.ymwp-hide-account [class*="Account"],
.ymwp-hide-account [class*="NavbarDesktop_user"],
.ymwp-hide-account [class*="NavbarDesktop_account"],
.ymwp-hide-account [class*="NavbarDesktop_bottom"],
.ymwp-hide-account [class*="NavbarDesktop_footer"],
.ymwp-hide-account [class*="UserInfo"],
.ymwp-hide-account [class*="ProfileCard"]{
  display:none !important;
}
/* --- тень текста --- */
.ymwp-text-shadow h1,.ymwp-text-shadow h2,.ymwp-text-shadow h3{
  text-shadow:0 1px 3px rgba(0,0,0,.55);
}


/* Настройка прозрачности текста — только для текстовых узлов.
   Раньше правило красило ВСЕ элементы через body *,
   из-за чего SVG-иконки (рисуются currentColor) становились белыми. */
${Number(s.textOpacity) < 100 ? `
h1,h2,h3,h4,h5,h6,p,span,a,button,li,label,div[class*="Text"]{
  color:rgba(255,255,255,${(Number(s.textOpacity) / 100).toFixed(2)}) !important;
}
` : ''}
[class*="Card_root"],[class*="EntityCard_root"]{ margin-bottom:${Number(s.rowGap)}px; }
${s.hideScrollbars ? '::-webkit-scrollbar{display:none !important;} html{scrollbar-width:none;}' : ''}
${s.smoothScroll ? 'html,body{scroll-behavior:smooth;}' : ''}
/* --- размер иконок --- */
[class*="Icon"]{ transform:scale(${(Number(s.iconScale) / 100).toFixed(2)}); }
/* --- сплэш-скрин --- */
${s.hideSplash ? `
[class*="SplashScreen"]{background:transparent !important;background-color:transparent !important;background-image:none !important;backdrop-filter:none !important;}
[class*="SplashScreen"] *{background:transparent !important;background-image:none !important;}
[class*="SplashScreen"]::before,[class*="SplashScreen"]::after{display:none !important;}
` : ''}
/* Корневой контейнер не должен рисовать чёрный градиент */
[class*="CommonLayout_root"],
[class*="DefaultLayout_root"]{
  background-color:transparent !important;
  background-image:none !important;
}
`;
  // Прячем карусель «Моя волна» точечно через JS.
  // Скрытие вынесено в hideCarousel() и дополнительно вызывается по
  // MutationObserver: SPA Яндекса пересоздаёт DOM при навигации, и без
  // повторного применения карусель возвращалась при переходе назад.
  try {
    hideCarousel(s.hideMainContent);
  } catch (e) { logstep('carousel hide failed: ' + e.message); }
  logstep('applyToDom ok');
}

// Скрывает/показывает карусель. Проверяет, что элемент на главной:
// ищет предка с классом MainPage — на других страницах VibePage тоже
// встречается, поэтому одного класса недостаточно.
function hideCarousel(hide) {
  const isOnMainPage = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.className && typeof n.className === 'string' && /MainPage/.test(n.className)) return true;
      n = n.parentElement;
    }
    return false;
  };

  // Скрываем ТОЛЬКО саму карусель (WheelDesktop + её анимацию).
  // VibePage_root сюда НЕ входит: это корень всей страницы «Моя волна»,
  // вместе с ним скрывался и плеер VibePlayerBar.
  const candidates = document.querySelectorAll(
    '[class*="WheelDesktop"], [class*="VibeWidgetAnimation"]'
  );

  let hidden = 0;
  for (const el of candidates) {
    if (hide && isOnMainPage(el)) {
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      hidden++;
    } else {
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
    }
  }
  return { hidden, total: candidates.length };
}

// ---------- Разметка ----------
function buildHtml(s, activeTab) {
  const tabBtns = TABS.map(t =>
    `<button class="ymwp-tab${t.id === activeTab ? ' is-active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');

  const tab = TABS.find(t => t.id === activeTab) || TABS[0];
  const rows = tab.items.map(it => {
    if (it.action === 'pick') {
      return `<button class="ymwp-pick" data-action="pick">${it.label}</button>`;
    }
    if (it.type === 'range') {
      const shown = it.scale ? Math.round(Number(s[it.key]) * it.scale) : s[it.key];
      return `<div class="ymwp-row">
        <div class="ymwp-row-top"><span>${it.label}</span><output>${shown}${it.unit || ''}</output></div>
        <input type="range" data-key="${it.key}" data-type="range"
               min="${it.min}" max="${it.max}" step="${it.step}" value="${s[it.key]}">
      </div>`;
    }
    if (it.type === 'bool') {
      return `<label class="ymwp-row ympw-toggle-row">
        <div class="ymwp-label">${it.label}</div>
        <span class="ymwp-switch"><input type="checkbox" data-key="${it.key}" data-type="bool" ${s[it.key] ? 'checked' : ''}><span></span></span>
      </label>`;
    }
    if (it.type === 'fontselect') {
      // Кастомный список: нативный <select> на Windows рисует БЕЛЫЙ список,
      // который не стилизуется. Каждый пункт показывается СВОИМ шрифтом
      // на реальном тексте — видно, как будет выглядеть интерфейс.
      const cur = it.options.find(o => o.value === s[it.key]) || it.options[0];
      const curCss = cur.css ? `font-family:${cur.css};` : '';
      const curW = cur.weight ? `font-weight:${cur.weight};` : '';
      const curI = cur.style ? `font-style:${cur.style};` : '';

      const items = it.options.map(o => {
        const css = o.css ? `font-family:${o.css};` : '';
        const w = o.weight ? `font-weight:${o.weight};` : '';
        const st = o.style ? `font-style:${o.style};` : '';
        const active = o.value === s[it.key] ? ' is-active' : '';
        // Для "по умолчанию" превью системным шрифтом
        return `<button class="ymwp-font-item${active}" data-fontpick="${it.key}:${o.value}">
          <span class="ymwp-fi-main" style="${css}${w}${st}">Моя волна</span>
          <span class="ymwp-fi-sub" style="${css}${w}${st}">АаБбВвГг 0123</span>
          <span class="ymwp-fi-name">${o.label}</span>
        </button>`;
      }).join('');

      return `<div class="ymwp-row ympw-font-row">
        <div class="ymwp-label">${it.label}</div>
        <button class="ymwp-font-btn" data-fontopen="${it.key}" style="${curCss}${curW}${curI}">
          <span class="ymwp-fb-text">Моя волна · АаБб</span>
          <span class="ymwp-caret">▾</span>
        </button>
        <div class="ymwp-font-list" data-fontlist="${it.key}" style="display:none">${items}</div>
      </div>`;
    }
    if (it.type === 'select') {
      const opts = it.options.map(o =>
        `<option value="${o.value}"${s[it.key] === o.value ? ' selected' : ''}>${o.label}</option>`
      ).join('');
      return `<div class="ymwp-row">
        <div class="ymwp-label">${it.label}</div>
        <select class="ymwp-select" data-key="${it.key}" data-type="select">${opts}</select>
      </div>`;
    }
    return '';
  }).join('');

  return `
<div class="ymwp-overlay" id="ymwp-overlay">
  <div class="ymwp-panel" role="dialog">
    <header>
      <div>
        <div class="ymwp-title">Настройки обоев</div>
        <div class="ymwp-ver">YM Live Wallpaper</div>
      </div>
      <button class="ymwp-x" data-action="close">✕</button>
    </header>
    <nav class="ymwp-tabs">${tabBtns}</nav>
    <div class="ymwp-body">${rows}</div>
    <footer>
      <button class="ymwp-btn ghost" data-action="reset">Сбросить</button>
      <button class="ymwp-btn" data-action="close">Готово</button>
    </footer>
  </div>
</div>`;
}

const PANEL_CSS = `
#ymwp-overlay{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#ymwp-overlay.open{display:flex}
.ymwp-panel{width:min(420px,92vw);max-height:82vh;display:flex;flex-direction:column;background:rgba(18,20,26,.94);backdrop-filter:blur(30px) saturate(130%);border:1px solid rgba(255,255,255,.1);border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.55);color:#fff;overflow:hidden}
.ymwp-panel header{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px 14px}
.ymwp-title{font-size:17px;font-weight:700}
.ymwp-ver{font-size:11px;opacity:.4;margin-top:2px}
.ymwp-x{background:rgba(255,255,255,.08);border:0;color:#fff;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:14px}
.ymwp-x:hover{background:rgba(255,255,255,.16)}
.ymwp-tabs{display:flex;gap:4px;padding:0 16px 12px;flex-wrap:wrap}
.ymwp-tab{background:transparent;border:0;color:rgba(255,255,255,.55);cursor:pointer;font-size:12.5px;padding:7px 12px;border-radius:9px;font-family:inherit}
.ymwp-tab:hover{background:rgba(255,255,255,.07);color:#fff}
.ymwp-tab.is-active{background:rgba(255,255,255,.13);color:#fff;font-weight:600}
.ymwp-body{padding:4px 20px 14px;overflow-y:auto;flex:1}
.ymwp-row{padding:11px 0;border-top:1px solid rgba(255,255,255,.06)}
.ymwp-row:first-child{border-top:0}
.ymwp-row-top{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:7px}
.ymwp-row-top output{opacity:.55;font-variant-numeric:tabular-nums;font-size:12.5px}
.ymwp-row input[type=range]{width:100%;accent-color:#ffcc00;cursor:pointer}
.ymwp-toggle-row{display:flex;justify-content:space-between;align-items:center;gap:14px}
.ymwp-label{font-size:13.5px}
.ymwp-switch{position:relative;width:40px;height:23px;flex-shrink:0}
.ymwp-switch input{opacity:0;width:0;height:0}
.ymwp-switch span{position:absolute;inset:0;background:rgba(255,255,255,.14);border-radius:999px;cursor:pointer;transition:background-color .16s}
.ymwp-switch span::before{content:'';position:absolute;left:3px;top:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:transform .16s}
.ymwp-switch input:checked + span{background:#ffcc00}
.ymwp-switch input:checked + span::before{transform:translateX(17px)}
.ymwp-select{width:100%;margin-top:6px;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:8px 10px;font-size:13px;font-family:inherit}
.ymwp-pick{width:100%;margin:10px 0;background:rgba(255,255,255,.1);color:#fff;border:0;padding:11px;border-radius:11px;font-size:13.5px;cursor:pointer;font-family:inherit;font-weight:500}
.ymwp-pick:hover{background:rgba(255,255,255,.18)}
.ymwp-panel footer{display:flex;gap:10px;justify-content:flex-end;padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.07)}
.ymwp-btn{background:#ffcc00;color:#111;border:0;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.ymwp-btn:hover{filter:brightness(1.08)}
.ymwp-btn.ghost{background:rgba(255,255,255,.08);color:#fff}
.ymwp-btn.ghost:hover{background:rgba(255,255,255,.15)}
/* кастомный список шрифтов — нативный <select> на Windows даёт белый дропдаун */
.ymwp-font-btn{width:100%;margin-top:6px;display:flex;justify-content:space-between;align-items:center;
  background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.12);
  border-radius:9px;padding:11px 14px;font-size:16px;cursor:pointer;font-family:inherit}
.ymwp-font-btn:hover{background:rgba(255,255,255,.14)}
.ymwp-fb-text{font-size:16px}
.ymwp-caret{opacity:.5;font-size:11px;margin-left:8px}
/* список: высокий, прокручивается, каждый пункт — превью своего шрифта */
.ymwp-font-list{margin-top:6px;max-height:420px;overflow-y:auto;
  background:rgba(12,14,18,.98);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px}
.ymwp-font-list::-webkit-scrollbar{width:8px}
.ymwp-font-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:4px}
.ymwp-font-item{display:grid;grid-template-columns:1fr;gap:1px;width:100%;
  background:transparent;border:0;color:#fff;text-align:left;
  padding:10px 12px;border-radius:9px;cursor:pointer;margin-bottom:2px;
  border-left:2px solid transparent}
.ymwp-font-item:hover{background:rgba(255,255,255,.1)}
.ymwp-font-item.is-active{background:rgba(255,204,0,.15);border-left-color:#ffcc00}
.ymwp-fi-main{font-size:22px;line-height:1.15;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ymwp-fi-sub{font-size:13px;opacity:.55;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ymwp-fi-name{font-size:10.5px;opacity:.4;display:block;margin-top:3px;
  font-family:system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase}
/* плавающая кнопка настроек в сайдбаре */
#ymwp-gear{
  position:fixed;z-index:999999;
  width:28px;height:28px;border-radius:8px;
  display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.07);
  border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.65);
  cursor:pointer;padding:0;
  transition:background-color .15s, color .15s, transform .15s;
}
#ymwp-gear:hover{
  background:rgba(255,255,255,.16);
  color:#fff;
  transform:rotate(25deg);
}
`;

// ---------- Монтаж ----------
let mounted = false;
let currentTab = 'wallpaper';

function findItem(key) {
  for (const t of TABS) for (const it of t.items) if (it.key === key) return it;
  return null;
}

function renderInto(holder) {
  // Сохраняем состояние «открыта», иначе после смены вкладки createElement
  // создаёт overlay без класса .open и панель мгновенно прячется.
  const prev = document.getElementById('ymwp-overlay');
  const wasOpen = !!(prev && prev.classList.contains('open'));
  holder.innerHTML = buildHtml(readSettings(), currentTab);
  if (wasOpen) {
    const ov = document.getElementById('ymwp-overlay');
    if (ov) ov.classList.add('open');
  }
}

// Перерисовать, сохранив открытое состояние (для кликов внутри панели)
function reopen() {
  const holder = document.getElementById('ymwp-panel-root');
  if (holder) renderInto(holder);
}

function mount() {
  if (mounted || !document.body) return;  const css = document.createElement('style');
  css.id = 'ymwp-panel-css';
  css.textContent = PANEL_CSS;
  document.head.appendChild(css);

  let holder = document.getElementById('ymwp-panel-root');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'ymwp-panel-root';
    document.body.appendChild(holder);
  }

  renderInto(holder);
  mounted = true;

  holder.addEventListener('click', (e) => {
    // сначала проверяем выбор шрифта — он внутри списка
    const fp = e.target.closest('[data-fontpick]');
    if (fp) {
      const raw = fp.getAttribute('data-fontpick');
      const idx = raw.indexOf(':');
      const key = raw.slice(0, idx);
      const val = raw.slice(idx + 1);
      const cur = readSettings();
      cur[key] = val;
      writeSettings(cur);
      applyToDom(cur);
      renderInto(holder);
      reopen(); // держим панель открытой
      return;
    }
    // раскрыть/закрыть список шрифтов
    const fo = e.target.closest('[data-fontopen]');
    if (fo) {
      const list = holder.querySelector(`[data-fontlist="${fo.getAttribute('data-fontopen')}"]`);
      if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
      return;
    }

    const t = e.target.closest('[data-action],[data-tab]');
    if (!t) return;
    const tabId = t.getAttribute('data-tab');
    if (tabId) { currentTab = tabId; renderInto(holder); return; }
    const action = t.getAttribute('data-action');
    if (action === 'close') return close();
    if (action === 'reset') return resetAll();
    if (action === 'pick') {
      // Показываем статус: большое видео пережимается в 1080p, это не мгновенно.
      const btn = e.target.closest('.ymwp-pick');
      if (btn) {
        btn.disabled = true;
        btn.dataset.orig = btn.textContent;
        btn.textContent = 'Готовлю видео…';
        btn.style.opacity = '0.6';
      }
      ipcRenderer.invoke('ymwp:pick-wallpaper')
        .then((res) => {
          if (btn) {
            btn.textContent = res ? 'Готово!' : (btn.dataset.orig || 'Выбрать видео…');
            setTimeout(() => {
              if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = btn.dataset.orig || 'Выбрать видео…'; }
            }, 1500);
          }
        })
        .catch(() => {
          if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = btn.dataset.orig || 'Выбрать видео…'; }
        });
      return;
    }
  });

  holder.addEventListener('input', (e) => {
    const el = e.target;
    const key = el.getAttribute && el.getAttribute('data-key');
    if (!key) return;
    const type = el.getAttribute('data-type');
    const cur = readSettings();
    if (type === 'bool') cur[key] = !!el.checked;
    else if (type === 'range') cur[key] = Number(el.value);
    else cur[key] = el.value;

    writeSettings(cur);
    applyToDom(cur);

    if (type === 'range') {
      const row = el.closest('.ymwp-row');
      const out = row && row.querySelector('output');
      if (out) {
        const meta = findItem(key);
        const shown = meta && meta.scale ? Math.round(Number(el.value) * meta.scale) : el.value;
        out.textContent = shown + ((meta && meta.unit) || '');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  applyToDom(readSettings());
  startCarouselObserver();
  logstep('panel mounted');
}

// Автозапуск наблюдателя: он нужен сразу, даже если панель ни разу не
// открывали — иначе скрытие карусели теряется при навигации SPA.
(function bootObserver() {
  const tryStart = () => {
    if (!document.body) return false;
    startCarouselObserver();
    return true;
  };
  if (tryStart()) return;
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (tryStart() || tries > 100) clearInterval(iv);
  }, 300);
})();

// ---------- Кнопка настроек ----------
let gearObserver = null;

// ---------- Наблюдатель за SPA-навигацией ----------
// Яндекс пересоздаёт DOM при переходе между разделами. Без повторного
// применения скрытие карусели терялось: уходишь на другую вкладку и
// возвращаешься — карусель снова на месте. Следим за изменениями body
// и переприменяем настройки (с дебаунсом, чтобы не грузить CPU).
let carouselObserver = null;
let reapplyTimer = null;

function startCarouselObserver() {
  if (carouselObserver || !document.body) return;
  // Применяем СРАЗУ в следующем кадре, без debounce: задержка в 250 мс
  // была видна как «мелькание» карусели при переключении вкладок.
  let scheduled = false;
  const applyNow = () => {
    scheduled = false;
    try {
      const s = readSettings();
      hideCarousel(!!s.hideMainContent);
      const root = document.documentElement;
      root.classList.toggle('ymwp-hide-main', !!s.hideMainContent);
      root.classList.toggle('ymwp-hide-account', !!s.hideAccount);
      root.classList.toggle('ymwp-hide-covers', !!s.hideCovers);
    } catch (e) { logstep('reapply failed: ' + e.message); }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyNow);
  };
  carouselObserver = new MutationObserver(schedule);
  carouselObserver.observe(document.body, { childList: true, subtree: true });
  logstep('carousel observer started');
}

function mountGearButton() {
  if (document.getElementById('ymwp-gear')) return;

  const btn = document.createElement('button');
  btn.id = 'ymwp-gear';
  btn.title = 'Настройки обоев';
  btn.setAttribute('aria-label', 'Настройки обоев');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
    '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 ' +
    '1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9 ' +
    'a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9 ' +
    'a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  document.body.appendChild(btn);

  // Позиционируем кнопку ВНУТРИ сайдбара (position:absolute).
  // fixed не годился: сайдбар пересоздаётся при навигации, и кнопка
  // оказывалась вне видимой области.
  const place = () => {
    const nav = document.querySelector('aside[class*="Navbar_root"]');
    if (!nav) return;
    if (btn.parentElement !== nav) {
      try {
        if (getComputedStyle(nav).position === 'static') nav.style.position = 'relative';
      } catch {}
      nav.appendChild(btn);
      logstep('gear moved into aside');
    }
    btn.style.position = 'absolute';
    btn.style.right = '10px';
    btn.style.top = '10px';
    btn.style.left = 'auto';
    btn.style.zIndex = '100';
  };
  place();
  if (!gearObserver) {
    gearObserver = new MutationObserver(() => place());
    gearObserver.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('resize', place);
  setInterval(place, 1000);
  logstep('gear button mounted');
}

function open() {
  mount();
  const holder = document.getElementById('ymwp-panel-root');
  if (holder) renderInto(holder);
  const ov = document.getElementById('ymwp-overlay');
  if (ov) ov.classList.add('open');
  applyToDom(readSettings());
  logstep('panel opened');
}

function close() {
  const ov = document.getElementById('ymwp-overlay');
  if (ov) ov.classList.remove('open');
}

function resetAll() {
  const s = writeSettings({ ...DEFAULTS });
  applyToDom(s);
  const holder = document.getElementById('ymwp-panel-root');
  if (holder) renderInto(holder);
}

module.exports = { open, close, resetAll, applyToDom, readSettings };

// ============ Автозапуск кнопки настроек ============
// Кнопка должна появляться сразу при загрузке страницы, а не после
// первого открытия панели. Ждём появления сайдбара и вставляем шестерёнку.
(function bootGear() {
  const tryMount = () => {
    if (!document.body) return false;
    if (document.getElementById('ymwp-gear')) return true;
    if (!document.querySelector('aside[class*="Navbar_root"]')) return false;
    mountGearButton();
    logstep('gear mounted');
    return true;
  };
  if (tryMount()) return;
  // сайдбар рисуется позже — пробуем несколько раз и по MutationObserver
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (tryMount() || tries > 120) clearInterval(iv);
  }, 500);
  document.addEventListener('DOMContentLoaded', tryMount);
  try {
    new MutationObserver(() => { if (tryMount()) {} })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
})();