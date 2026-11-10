// Откат мода: node tools/unpatch.js
// Возвращает оригинальные app.asar и exe из бэкапов
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// Закрываем запущенную Яндекс Музыку, иначе её файлы заняты (EBUSY)
{
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

const CANDIDATES = [
  path.join(process.env.LOCALAPPDATA, 'Programs', 'YandexMusic', 'resources'),
  path.join(process.env.LOCALAPPDATA, 'YandexMusic', 'resources'),
  path.join(process.env.LOCALAPPDATA, 'Programs', 'yandex-music', 'resources')
];

const custom = process.argv[2];
const roots = custom ? [custom] : CANDIDATES;

const res = roots.find(r =>
  fs.existsSync(path.join(r, 'original.asar')) ||
  fs.existsSync(path.join(r, 'app.asar.original')));
if (!res) {
  console.error('Бэкап asar не найден — мод не установлен или путь другой.');
  process.exit(1);
}

const appAsar = path.join(res, 'app.asar');
const original = fs.existsSync(path.join(res, 'original.asar'))
  ? path.join(res, 'original.asar')
  : path.join(res, 'app.asar.original');

if (fs.existsSync(appAsar)) fs.rmSync(appAsar, { force: true });
fs.renameSync(original, appAsar);
console.log('app.asar восстановлен.');

// Восстановление exe
const appDir = path.dirname(res);
const exeBackup = fs.readdirSync(appDir).find(f => /\.exe\.original$/i.test(f));
if (exeBackup) {
  const exePath = path.join(appDir, exeBackup.replace(/\.original$/i, ''));
  fs.copyFileSync(path.join(appDir, exeBackup), exePath);
  fs.rmSync(path.join(appDir, exeBackup), { force: true });
  console.log('exe восстановлен из бэкапа: ' + exeBackup);
} else {
  console.log('Бэкап exe не найден — exe не трогали или уже восстановлен.');
}

console.log('Мод полностью удалён.');
