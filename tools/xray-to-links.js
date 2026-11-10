'use strict';
// Конвертер Xray-JSON в vless/trojan/ss ссылки для NetShift.
// Страна определяется по известным доменам подписки XPNet.

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'E:\\загрузки\\json.json';
const OUT = process.argv[3] || path.join(process.env.TEMP || '.', 'links-named.txt');

const cfg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const enc = (s) => encodeURIComponent(String(s));

// Флаги стран
const CN = {
  nl: '🇳🇱', de: '🇩🇪', fr: '🇫🇷', gb: '🇬🇧', us: '🇺🇸', pl: '🇵🇱',
  fi: '🇫🇮', ee: '🇪🇪', se: '🇸🇪', lv: '🇱🇻', lt: '🇱🇹', tr: '🇹🇷',
  kz: '🇰🇿', md: '🇲🇩', ru: '🇷🇺', ro: '🇷🇴', bg: '🇧🇬', al: '🇦🇱',
  at: '🇦🇹', es: '🇪🇸', it: '🇮🇹', ch: '🇨🇭', no: '🇳🇴', dk: '🇩🇰',
  be: '🇧🇪', cz: '🇨🇿', hu: '🇭🇺', rs: '🇷🇸', ua: '🇺🇦', jp: '🇯🇵',
  sg: '🇸🇬', hk: '🇭🇰', kr: '🇰🇷', ca: '🇨🇦', br: '🇧🇷', in: '🇮🇳',
  ae: '🇦🇪', il: '🇮🇱', am: '🇦🇲', ge: '🇬🇪', sc: '🇸🇨', mx: '🇲🇽',
  au: '🇦🇺', za: '🇿🇦', ir: '🇮🇷'
};

const NAMES = {
  nl: 'Netherlands', de: 'Germany', fr: 'France', gb: 'UK', us: 'USA',
  pl: 'Poland', fi: 'Finland', ee: 'Estonia', se: 'Sweden', lv: 'Latvia',
  lt: 'Lithuania', tr: 'Turkey', kz: 'Kazakhstan', md: 'Moldova', ru: 'Russia',
  ro: 'Romania', bg: 'Bulgaria', al: 'Albania', at: 'Austria', es: 'Spain',
  it: 'Italy', ch: 'Switzerland', no: 'Norway', dk: 'Denmark', be: 'Belgium',
  cz: 'Czechia', hu: 'Hungary', rs: 'Serbia', ua: 'Ukraine', jp: 'Japan',
  sg: 'Singapore', hk: 'Hong Kong', kr: 'Korea', ca: 'Canada', br: 'Brazil',
  in: 'India', ae: 'UAE', il: 'Israel', am: 'Armenia', ge: 'Georgia',
  sc: 'Seychelles', mx: 'Mexico', au: 'Australia', za: 'S.Africa', ir: 'Iran'
};

// ТОЧНЫЕ ПРАВИЛА для доменов этой подписки
const RULES = [
  [/t?fusq-ru|fluxnode777|jarvesitw|fade\.mom/, 'ru'],
  [/nl\d*\.luminox/, 'nl'],
  [/gb\d*\.luminox/, 'gb'],
  [/us\d*\.luminox/, 'us'],
  [/moldova\.fortelazavps/, 'md'],
  [/bulgaria\.fortelazavps/, 'bg'],
  [/albania\.fortelazavps/, 'al'],
  [/kz\.luna-nodes|kz-kazilik/, 'kz'],
  [/nrw\.okolotech/, 'nl'],
  [/po\d*\.hys\.braidx/, 'pl'],
  [/cook\.vanta-vpn/, 'nl'],
  [/ap\d*\.directly|stayup\.cloud/, 'nl'],
  [/okolo-connect/, 'tr'],
  [/fastly/, 'us'],
  [/ds-cdn/, 'de'],
  [/figmadownloader/, 'de']
];

function detectCountry(str) {
  const s = String(str || '').toLowerCase();
  for (const [re, code] of RULES) {
    if (re.test(s)) return code;
  }
  return null;
}

function base64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function streamToQuery(st) {
  const q = [];
  if (!st) return q;
  const net = st.network || 'tcp';
  q.push('type=' + enc(net));

  if (st.security === 'tls') {
    q.push('security=tls');
    const tls = st.tlsSettings || {};
    if (tls.serverName) q.push('sni=' + enc(tls.serverName));
    if (tls.fingerprint) q.push('fp=' + enc(tls.fingerprint));
    if (tls.alpn && tls.alpn.length) q.push('alpn=' + enc(tls.alpn.join(',')));
    if (tls.allowInsecure) q.push('allowInsecure=1');
  } else if (st.security === 'reality') {
    q.push('security=reality');
    const r = st.realitySettings || {};
    if (r.serverName) q.push('sni=' + enc(r.serverName));
    if (r.publicKey) q.push('pbk=' + enc(r.publicKey));
    if (r.shortId) q.push('sid=' + enc(r.shortId));
    if (r.fingerprint) q.push('fp=' + enc(r.fingerprint));
    if (r.spiderX) q.push('spx=' + enc(r.spiderX));
  } else {
    q.push('security=none');
  }

  if (net === 'ws') {
    const ws = st.wsSettings || {};
    if (ws.path) q.push('path=' + enc(ws.path));
    if (ws.headers && ws.headers.Host) q.push('host=' + enc(ws.headers.Host));
  } else if (net === 'grpc') {
    const g = st.grpcSettings || {};
    if (g.serviceName) q.push('serviceName=' + enc(g.serviceName));
    if (g.multiMode) q.push('mode=multi');
  } else if (net === 'xhttp') {
    const x = st.xhttpSettings || {};
    if (x.path) q.push('path=' + enc(x.path));
    if (x.host) q.push('host=' + enc(x.host));
    if (x.mode) q.push('mode=' + enc(x.mode));
  }
  return q;
}

const links = [];
let idx = 0;

for (const ob of (cfg.outbounds || [])) {
  const proto = ob.protocol;
  if (!['vless', 'trojan', 'shadowsocks', 'vmess'].includes(proto)) continue;
  idx++;

  let addr = '', sni = '', port = 0, cred = null;
  const st = ob.streamSettings || {};

  if (proto === 'vless' && ob.settings && ob.settings.vnext && ob.settings.vnext[0]) {
    const v = ob.settings.vnext[0];
    addr = v.address; port = v.port;
    cred = (v.users && v.users[0]) || {};
    if (st.tlsSettings && st.tlsSettings.serverName) sni = st.tlsSettings.serverName;
    if (st.realitySettings && st.realitySettings.serverName) sni = st.realitySettings.serverName;
  } else if ((proto === 'trojan' || proto === 'shadowsocks') && ob.settings && ob.settings.servers && ob.settings.servers[0]) {
    const s = ob.settings.servers[0];
    addr = s.address; port = s.port; cred = s;
    if (st.tlsSettings && st.tlsSettings.serverName) sni = st.tlsSettings.serverName;
  } else if (proto === 'vmess' && ob.settings && ob.settings.vnext && ob.settings.vnext[0]) {
    const v = ob.settings.vnext[0];
    addr = v.address; port = v.port;
    cred = (v.users && v.users[0]) || {};
    if (st.tlsSettings && st.tlsSettings.serverName) sni = st.tlsSettings.serverName;
  }

  if (!addr) continue;

  // Страна: сначала по адресу, потом по SNI
  const code = detectCountry(addr) || detectCountry(sni);
  const flag = code ? CN[code] : '🌐';
  const cname = code ? NAMES[code] : 'Node';
  const name = flag + ' ' + cname + ' | AI #' + idx;

  if (proto === 'vless' && cred) {
    const q = streamToQuery(st);
    if (cred.flow) q.push('flow=' + enc(cred.flow));
    q.push('encryption=' + enc(cred.encryption || 'none'));
    links.push('vless://' + cred.id + '@' + addr + ':' + port + '?' + q.join('&') + '#' + enc(name));
  } else if (proto === 'trojan' && cred) {
    const q = streamToQuery(st);
    links.push('trojan://' + enc(cred.password) + '@' + addr + ':' + port + '?' + q.join('&') + '#' + enc(name));
  } else if (proto === 'shadowsocks' && cred) {
    const c = base64url(cred.method + ':' + cred.password);
    links.push('ss://' + c + '@' + addr + ':' + port + '#' + enc(name));
  } else if (proto === 'vmess' && cred) {
    const obj = {
      v: '2', ps: name, add: addr, port: String(port), id: cred.id,
      aid: String(cred.alterId || 0), scy: cred.security || 'auto',
      net: st.network || 'tcp', type: 'none', host: '', path: '',
      tls: st.security === 'tls' ? 'tls' : '',
      sni: sni || ''
    };
    links.push('vmess://' + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'));
  }
}

fs.writeFileSync(OUT, links.join('\n') + '\n', 'utf8');

const detected = links.filter(l => !l.includes('%F0%9F%8C%90')).length;
console.log('Ссылок: ' + links.length + ' (страна определена: ' + detected + ')');
console.log('Файл: ' + OUT);
console.log('');
console.log('Имена:');
links.forEach(l => {
  const m = l.match(/#(.+)$/);
  if (m) console.log('  ' + decodeURIComponent(m[1]));
});
