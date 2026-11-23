import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readResult, windToMs, weatherFacts, describeCode } from '../server/weather.js';
import { AppError, errorDiagnostics, publicError, unavailable, safeData } from '../server/errors.js';

test('ветер переводится из км/ч в м/с программно', () => { assert.equal(windToMs(36, 'kmh'), 10); assert.equal(windToMs(18, 'km/h'), 5); assert.equal(windToMs(3, 'ms'), 3); });
test('ноль и штиль сохраняются, отсутствующие данные не становятся нулями', () => {
  const f = weatherFacts({ current_weather: { temperature: 0, windspeed: 0, weathercode: 0, time: '2026-01-01T12:00' }, timezone: 'Europe/Moscow' }, { wind_speed_unit: 'ms' });
  assert.equal(f.current?.temperatureC, 0); assert.equal(f.current?.windMs, 0); assert.equal(f.current?.conditions, 'Ясно'); assert.equal(f.usable, true); assert.deepEqual(f.missing, []);
  const partial = weatherFacts({ current_weather: { temperature: -4 } }, {});
  assert.equal(partial.current?.windMs, null); assert.ok(partial.missing.includes('Сервис не вернул скорость ветра.')); assert.equal(partial.usable, true);
});
test('неизвестные единицы и нечисловые значения не трактуются как погода', () => {
  assert.equal(windToMs(4, 'unknown'), null); assert.equal(windToMs(null, 'ms'), null); assert.equal(windToMs(NaN, 'ms'), null);
  assert.equal(weatherFacts({ current_weather: { temperature: null, windspeed: null } }, {}).usable, false);
  assert.equal(weatherFacts({ hourly: { time: ['2026-01-01'], temperature_2m: [null] } }, {}).usable, false);
});
test('единицы ответа имеют приоритет над аргументами', () => { assert.equal(weatherFacts({ current_weather: { windspeed: 36 }, current_weather_units: { windspeed: 'km/h' } }, { wind_speed_unit: 'ms' }).current?.windMs, 10); });
test('isError, пустой ответ и некорректный JSON отклоняются', () => {
  for (const r of [{ isError: true, content: [{ type: 'text', text: '{"temperature":20}' }] }, { content: [] }, { content: [{ type: 'text', text: 'not json' }] }, { structuredContent: {} }, { structuredContent: { error: true } }]) assert.throws(() => readResult(r));
});
test('JSON и structuredContent корректно разбираются', () => {
  assert.deepEqual(readResult({ content: [{ type: 'text', text: '{"x":0}' }] }), { x: 0 }); assert.deepEqual(readResult({ structuredContent: { x: 0 } }), { x: 0 });
});
test('таблица WMO и неизвестный код', () => { assert.equal(describeCode(61), 'Небольшой дождь'); assert.match(describeCode(999)!, /Неизвестный/); assert.equal(describeCode(null), null); });
test('ошибки не раскрывают провайдерский ответ и ключ', () => {
  assert.match(publicError({ status: 401 }), /ключ/); assert.match(publicError({ status: 429 }), /лимит/); assert.match(publicError({}, true), /90 секун/);
  assert.equal(publicError(new AppError('MCP_UNAVAILABLE', unavailable)), unavailable);
  assert.doesNotMatch(publicError(new Error('sk-private-value-12345')), /sk-private/);
  assert.equal(safeData({ text: 'sk-test-secret-12345' }).text, '[СКРЫТО]');
});
test('причины TLS, сети и недоступной модели различаются без вывода секретов', () => {
  const tls = new Error('Connection error', { cause: new TypeError('fetch failed', { cause: Object.assign(new Error('secret text'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) }) });
  assert.match(publicError(tls), /сертификат/);
  assert.deepEqual(errorDiagnostics(tls).causes, ['SELF_SIGNED_CERT_IN_CHAIN']);
  assert.doesNotMatch(JSON.stringify(errorDiagnostics(tls)), /secret text/);
  assert.match(publicError(new Error('Connection error', { cause: { code: 'ECONNRESET' } })), /HTTPS-соединение/);
  assert.match(publicError({ status: 404 }), /OPENAI_MODEL/);
  assert.match(publicError({ status: 400 }), /параметры запроса/);
  assert.equal(typeof publicError(null), 'string');
});
