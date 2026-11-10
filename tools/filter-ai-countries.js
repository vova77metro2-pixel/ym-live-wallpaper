'use strict';
// Фильтр AI-узлов по списку разрешённых стран.
// Оставляет только те, чья страна есть в allow-списке.

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(process.env.TEMP || '.', 'links-named.txt');
const OUT = process.argv[3] || path.join(process.env.TEMP || '.', 'links-filtered.txt');

// Разрешённые страны (из присланного списка)
const ALLOWED = new Set([
  'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla',
  'Antarctica', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba',
  'Australia', 'Austria', 'Azerbaijan', 'The Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belgium', 'Belize', 'Benin', 'Bermuda',
  'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil',
  'British Indian Ocean Territory', 'British Virgin Islands', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Caribbean Netherlands', 'Cayman Islands',
  'Central African Republic', 'Chad', 'Chile', 'Christmas Island',
  'Cocos (Keeling) Islands', 'Colombia', 'Comoros', 'Cook Islands',
  'Costa Rica', "Côte d'Ivoire", 'Croatia', 'Curaçao', 'Czech Republic',
  'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador',
  'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Falkland Islands (Islas Malvinas)', 'Faroe Islands', 'Fiji', 'Finland',
  'France', 'French Guiana', 'Gabon', 'The Gambia', 'Georgia', 'Germany',
  'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guam',
  'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti',
  'Heard Island and McDonald Islands', 'Honduras', 'Hungary', 'Iceland',
  'India', 'Indonesia', 'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati',
  'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho',
  'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
  'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Montserrat', 'Morocco',
  'Mozambique', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Caledonia',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island',
  'North Macedonia', 'Northern Mariana Islands', 'Norway', 'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea',
  'Paraguay', 'Peru', 'Philippines', 'Pitcairn Islands', 'Poland',
  'Portugal', 'Puerto Rico', 'Qatar', 'Republic of Cyprus',
  'Republic of the Congo', 'Romania', 'Rwanda', 'Réunion',
  'Saint Barthélemy', 'Saint Helena, Ascension and Tristan da Cunha',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Pierre and Miquelon',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
  'Solomon Islands', 'Somalia', 'South Africa',
  'South Georgia and the South Sandwich Islands', 'South Korea', 'South Sudan',
  'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
  'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkmenistan',
  'Turks and Caicos Islands', 'Tuvalu', 'Türkiye', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States',
  'United States Minor Outlying Islands', 'Uruguay', 'U.S. Virgin Islands',
  'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Wallis and Futuna', 'Western Sahara', 'Yemen', 'Zambia', 'Zimbabwe',
  'Åland Islands'
]);

// Синонимы из моего конвертера -> официальное название
const ALIAS = {
  'Netherlands': 'Netherlands', 'Germany': 'Germany', 'France': 'France',
  'UK': 'United Kingdom', 'USA': 'United States', 'Poland': 'Poland',
  'Finland': 'Finland', 'Estonia': 'Estonia', 'Sweden': 'Sweden',
  'Latvia': 'Latvia', 'Lithuania': 'Lithuania', 'Turkey': 'Türkiye',
  'Kazakhstan': 'Kazakhstan', 'Moldova': 'Moldova', 'Russia': 'Russia',
  'Romania': 'Romania', 'Bulgaria': 'Bulgaria', 'Albania': 'Albania',
  'Austria': 'Austria', 'Spain': 'Spain', 'Italy': 'Italy',
  'Switzerland': 'Switzerland', 'Norway': 'Norway', 'Denmark': 'Denmark',
  'Belgium': 'Belgium', 'Czechia': 'Czech Republic', 'Hungary': 'Hungary',
  'Serbia': 'Serbia', 'Ukraine': 'Ukraine', 'Japan': 'Japan',
  'Singapore': 'Singapore', 'Hong Kong': 'Hong Kong', 'Korea': 'South Korea',
  'Canada': 'Canada', 'Brazil': 'Brazil', 'India': 'India',
  'UAE': 'United Arab Emirates', 'Israel': 'Israel', 'Armenia': 'Armenia',
  'Georgia': 'Georgia', 'Seychelles': 'Seychelles', 'Mexico': 'Mexico',
  'Australia': 'Australia', 'S.Africa': 'South Africa', 'Iran': 'Iran',
  'Node': null
};

const lines = fs.readFileSync(SRC, 'utf8').split('\n').filter(l => l.trim());
const kept = [];
const removed = [];

for (const line of lines) {
  const m = line.match(/#(.+)$/);
  if (!m) { removed.push({ line, why: 'no name' }); continue; }
  const name = decodeURIComponent(m[1]);

  // Имя вида "🇳🇱 Netherlands | AI #2" -> "Netherlands"
  const parts = name.split('|');
  let country = '';
  if (parts.length > 0) {
    // Убираем флаг и пробелы
    country = parts[0].replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/[\u{FE00}-\u{FE0F}]/gu, '').trim();
  }

  const official = ALIAS[country];
  if (official === undefined) {
    // Неизвестное имя -> убираем
    removed.push({ name, why: 'unknown country' });
    continue;
  }
  if (official === null) {
    removed.push({ name, why: 'node without country' });
    continue;
  }
  if (!ALLOWED.has(official)) {
    removed.push({ name, why: 'not in allow list: ' + official });
    continue;
  }
  kept.push(line);
}

fs.writeFileSync(OUT, kept.join('\n') + '\n', 'utf8');

console.log('Всего: ' + lines.length);
console.log('Оставлено: ' + kept.length);
console.log('Убрано: ' + removed.length);
console.log('');
if (removed.length) {
  console.log('Убраны:');
  removed.forEach(r => console.log('  - ' + (r.name || '?') + '  (' + r.why + ')'));
}
console.log('');
console.log('Оставлены:');
kept.forEach(l => {
  const m = l.match(/#(.+)$/);
  if (m) console.log('  + ' + decodeURIComponent(m[1]));
});
console.log('');
console.log('Файл: ' + OUT);
