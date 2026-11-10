// Установка мода: node tools/patch.js [путь к resources]
// 1. Находит resources\ Яндекс Музыки
// 2. app.asar -> original.asar (одноразовый бэкап, с ретраями на EBUSY)
//    Имя именно original.asar: Node распознаёт asar-архивы по расширению .asar
// 3. Пакует loader\ в новый app.asar
// 4. Вычисляет SHA256 заголовков ОБОИХ asar и обновляет ресурс
//    INTEGRITY/ELECTRONASAR в exe (фьюз EnableEmbeddedAsarIntegrityValidation):
//    Electron проверяет каждый читаемый asar, поэтому original.asar тоже
//    должен быть в списке. Перед правкой exe бэкапится в <имя>.original
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const asar = require('@electron/asar');
const resedit = require('resedit');

// Закрываем запущенную Яндекс Музыку, иначе её файлы заняты (EBUSY)
function killYmProcesses() {
  const script = `
for ($i = 0; $i -lt 6; $i++) {
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*YandexMusic*' };
  if (-not $p) { exit 0 }
  $p | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
exit 1`;
  const r = cp.spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  if (r.status !== 0) {
    console.error('Не удалось закрыть Яндекс Музыку. Закройте её вручную (и в трее) и повторите.');
    process.exit(1);
  }
}
killYmProcesses();

const CANDIDATES = [
  path.join(process.env.LOCALAPPDATA, 'Programs', 'YandexMusic', 'resources'),
  path.join(process.env.LOCALAPPDATA, 'YandexMusic', 'resources'),
  path.join(process.env.LOCALAPPDATA, 'Programs', 'yandex-music', 'resources')
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function renameWithRetry(from, to, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (e.code === 'EBUSY' && i < attempts - 1) {
        console.log(`Файл занят (антивирус?), повтор через 5 сек... [${i + 1}/${attempts}]`);
        await sleep(5000);
      } else throw e;
    }
  }
}

function findAppExe(appDir) {
  const exes = fs.readdirSync(appDir)
    .filter(f => /\.exe$/i.test(f) && !/uninstall|elevate|update/i.test(f) && !/^YM\.exe$/i.test(f))
    .map(f => ({ f, size: fs.statSync(path.join(appDir, f)).size }))
    .sort((a, b) => b.size - a.size);
  if (!exes.length) throw new Error('Не найден exe приложения в ' + appDir);
  return path.join(appDir, exes[0].f);
}

async function asarHeaderHash(asarPath) {
  const raw = await asar.getRawHeader(asarPath);
  return crypto.createHash('sha256').update(raw.headerString, 'utf8').digest('hex');
}

function patchExeIntegrity(exePath, entries) {
  const data = fs.readFileSync(exePath);
  const exe = resedit.NtExecutable.from(data, { ignoreCert: true });
  const res = resedit.NtExecutableResource.from(exe);
  const json = JSON.stringify(entries);
  const bin = Buffer.from(json, 'utf8');

  const entry = res.entries.find(e =>
    String(e.type).toUpperCase() === 'INTEGRITY' &&
    String(e.id).toUpperCase() === 'ELECTRONASAR');
  if (entry) {
    entry.bin = bin;
  } else {
    res.entries.push({ type: 'INTEGRITY', id: 'ELECTRONASAR', lang: 1033, codepage: 65001, bin });
  }
  res.outputResource(exe);
  return { json, bin: Buffer.from(exe.generate()) };
}

async function writeWithRetry(file, data, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.writeFileSync(file, data);
      return;
    } catch (e) {
      if (e.code === 'EBUSY' && i < attempts - 1) {
        console.log(`exe занят (антивирус?), повтор через 5 сек... [${i + 1}/${attempts}]`);
        await sleep(5000);
      } else throw e;
    }
  }
}

(async () => {
  const custom = process.argv[2];
  const roots = custom ? [custom] : CANDIDATES;
  const res = roots.find(r =>
    fs.existsSync(path.join(r, 'app.asar')) ||
    fs.existsSync(path.join(r, 'original.asar')) ||
    fs.existsSync(path.join(r, 'app.asar.original')));
  if (!res) {
    console.error('resources не найден. Проверенные пути:');
    roots.forEach(r => console.error('  ' + r));
    console.error('Передайте путь вручную: node tools/patch.js "<путь к resources>"');
    process.exit(1);
  }
  console.log('Найден resources: ' + res);

  const appAsar = path.join(res, 'app.asar');
  const original = path.join(res, 'original.asar');
  const legacyBackup = path.join(res, 'app.asar.original');

  // Миграция со старого имени бэкапа
  if (fs.existsSync(legacyBackup) && !fs.existsSync(original)) {
    fs.renameSync(legacyBackup, original);
    console.log('app.asar.original переименован в original.asar');
  }

  if (!fs.existsSync(original)) {
    await renameWithRetry(appAsar, original);
    console.log('Оригинал сохранён как original.asar');
  } else {
    console.log('original.asar уже существует — бэкап пропущен');
  }

  // loader лежит рядом (dist-пакет) или на уровень выше (репозиторий, tools/)
  const loaderDir = [
    path.join(__dirname, '..', 'loader'),
    path.join(__dirname, 'loader')
  ].find(d => fs.existsSync(path.join(d, 'package.json')));
  if (!loaderDir) throw new Error('Папка loader не найдена рядом с patch.js');

  // Синхронизируем name/version загрузчика с оригинальным приложением
  try {
    const pkg = JSON.parse(asar.extractFile(original, 'package.json').toString());
    const loaderPkgPath = path.join(loaderDir, 'package.json');
    const loaderPkg = JSON.parse(fs.readFileSync(loaderPkgPath, 'utf8'));
    loaderPkg.name = pkg.name;
    loaderPkg.version = pkg.version;
    fs.writeFileSync(loaderPkgPath, JSON.stringify(loaderPkg, null, 2));
    console.log(`package.json загрузчика: ${pkg.name}@${pkg.version}`);
  } catch (e) {
    console.log('Не удалось синхронизировать package.json: ' + e.message);
  }

  await asar.createPackage(loaderDir, appAsar);
  console.log('Загрузчик упакован в app.asar');

  // --- Пересчёт хэшей целостности (оба asar читаются рантаймом) ---
  const entries = [
    { file: 'resources\\app.asar', alg: 'SHA256', value: await asarHeaderHash(appAsar) },
    { file: 'resources\\original.asar', alg: 'SHA256', value: await asarHeaderHash(original) }
  ];
  entries.forEach(e => console.log(`${e.file}: ${e.value}`));

  const exePath = findAppExe(path.dirname(res));
  const exeBackup = exePath + '.original';
  if (!fs.existsSync(exeBackup)) {
    fs.copyFileSync(exePath, exeBackup);
    console.log('Бэкап exe: ' + path.basename(exeBackup));
  }
  const patched = patchExeIntegrity(exePath, entries);
  await writeWithRetry(exePath, patched.bin);
  console.log('Ресурс INTEGRITY/ELECTRONASAR обновлён: ' + patched.json);

  console.log('\nГотово! Перезапустите Яндекс Музыку.');
  console.log('Видео кладите в: %APPDATA%\\ym-live-wallpaper\\wallpapers\\');
})().catch(e => { console.error(e); process.exit(1); });
