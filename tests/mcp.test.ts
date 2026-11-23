import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WeatherMcp } from '../server/mcp.js';
import type { ServerEvent } from '../src/shared.js';

// Изолированные моки SDK; сервер MCP в тестах не создаётся и не запускается.
function fixture() {
  const events: ServerEvent[] = [];
  const mcp = new WeatherMcp('https://weather.chukai.io/mcp', 'unit-test', new AbortController().signal, e => events.push(e), [{ name: 'Тест', latitude: 0, longitude: 0 }]);
  mcp.tools = [{ name: 'get_weather_forecast', inputSchema: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } }, required: ['latitude', 'longitude'] } }];
  return { mcp, events };
}
test('схема и неподтвержденные координаты проверяются до MCP-вызова', async () => {
  const { mcp, events } = fixture();
  assert.ok('error' in await mcp.call('get_weather_forecast', { latitude: 'wrong', longitude: 0 }));
  assert.ok('error' in await mcp.call('get_weather_forecast', { latitude: 12, longitude: 13 }));
  assert.equal(events.length, 0); assert.equal(mcp.attempts, 0);
});
test('реальный исполнитель помечает isError ошибкой', async () => {
  const { mcp, events } = fixture();
  mcp.client.callTool = async () => ({ isError: true, content: [{ type: 'text', text: 'failed' }] });
  const result = await mcp.call('get_weather_forecast', { latitude: 0, longitude: 0 });
  assert.ok('error' in result);
  const calls = events.filter(e => e.type === 'call'); assert.equal(calls.length, 2); assert.equal(calls[0].call.state, 'running'); assert.equal(calls[1].call.state, 'error'); assert.equal(mcp.weatherCount, 0);
});
test('технический успех без показателей не становится погодой', async () => {
  const { mcp, events } = fixture();
  mcp.client.callTool = async () => ({ content: [{ type: 'text', text: '{"timezone":"UTC"}' }] });
  assert.ok('error' in await mcp.call('get_weather_forecast', { latitude: 0, longitude: 0 }));
  assert.equal(events.filter(e => e.type === 'call').at(-1)?.call.usable, false);
});
test('временная сеть повторяется ровно один раз', async () => {
  const { mcp } = fixture(); let calls = 0;
  mcp.client.callTool = async () => { calls++; throw new TypeError('fetch failed'); };
  await assert.rejects(() => mcp.call('get_weather_forecast', { latitude: 0, longitude: 0 }), /погодный сервис сейчас недоступен/);
  assert.equal(calls, 2);
});
test('предел восьми MCP-вызовов исключает девятый', async () => {
  const { mcp } = fixture(); mcp.attempts = 8;
  await assert.rejects(() => mcp.call('get_weather_forecast', { latitude: 0, longitude: 0 }), /8 MCP-вызовов/);
});
test('отмена запроса не запускает MCP-инструмент', async () => {
  const { mcp, events } = fixture();
  mcp.signal = AbortSignal.abort();
  await assert.rejects(() => mcp.call('get_weather_forecast', { latitude: 0, longitude: 0 }), { name: 'AbortError' });
  assert.equal(mcp.attempts, 0); assert.equal(events.length, 0);
});
