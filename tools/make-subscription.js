'use strict';
// Создаёт локальную подписку для NetShift из кэша XPNet.
// Чинит XHTTP-узлы: добавляет x_padding_bytes (без него sing-box падает).
// Результат — sing-box JSON, отдаётся по http://192.168.1.1/mysub.json

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(process.env.TEMP || '.', 'sub-cache.json');
const OUT = process.argv[3] || path.join(process.env.TEMP || '.', 'mysub.json');

const cfg = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// Проходим по всем outbound'ам
let fixedXhttp = 0;
let fixedGrpc = 0;

for (const ob of (cfg.outbounds || [])) {
  const tr = ob.transport;
  if (!tr) continue;

  // XHTTP требует x_padding_bytes (иначе sing-box: "x_padding_bytes cannot be disabled")
  if (tr.type === 'xhttp') {
    if (!tr.x_padding_bytes) {
      tr.x_padding_bytes = '100-1000';
      fixedXhttp++;
    }
  }

  // gRPC иногда требует multiMode
  if (tr.type === 'grpc') {
    if (tr.multi_mode === undefined) {
      // не трогаем, просто считаем
      fixedGrpc++;
    }
  }
}

// Убираем tun/mixed inbounds — NetShift создаёт свои
// (оставляем только то, что нужно NetShift: route + outbounds)
const clean = {
  log: { level: 'info' },
  dns: cfg.dns || {},
  route: cfg.route || {},
  outbounds: cfg.outbounds || []
};

fs.writeFileSync(OUT, JSON.stringify(clean, null, 2), 'utf8');

console.log('Outbounds: ' + clean.outbounds.length);
console.log('Исправлено XHTTP (добавлен x_padding_bytes): ' + fixedXhttp);
console.log('gRPC узлов: ' + fixedGrpc);
console.log('Размер: ' + Math.round(fs.statSync(OUT).size / 1024) + ' КБ');
console.log('Файл: ' + OUT);
