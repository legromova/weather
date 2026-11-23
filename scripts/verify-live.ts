import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { WeatherMcp } from '../server/mcp.js';
import { runAgent } from '../server/agent.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { CallLog } from '../src/shared.js';
import { publicError, safeData, unavailable } from '../server/errors.js';
const report: any = { date: new Date().toISOString(), transport: 'Streamable HTTP', checks: [] };
const mcp = new WeatherMcp(process.env.MCP_SERVER_URL || 'https://weather.chukai.io/mcp', 'live-sdk-check', AbortSignal.timeout(90000), () => {});
try {
  await mcp.connect();
  report.tools = mcp.tools.map(t => ({ name: t.name, inputSchema: t.inputSchema }));
  for (const name of ['Екатеринбург', 'Казань']) {
    const geo = await mcp.call('geocode_location', { name, count: 5, language: 'ru' });
    if ('error' in geo || !('candidates' in geo)) throw Error('Geocoding failed');
    const city = geo.candidates![0];
    const weather: any = await mcp.call('get_weather_forecast', { latitude: city.latitude, longitude: city.longitude, current_weather: true, wind_speed_unit: 'ms', timezone: city.timezone, forecast_days: 3, hourly: 'temperature_2m,precipitation_probability,precipitation', daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum' });
    assert.ok(weather.normalized?.usable); assert.equal(weather.normalized.timezone, city.timezone);
    assert.ok(weather.normalized.daily.time.length >= 3);
    report.checks.push({ name, kind: 'SDK integration (not AI dialog)', passed: true, location: city, facts: weather.normalized.current, forecastDates: weather.normalized.daily.time });
  }
  const bad = new WeatherMcp('http://127.0.0.1:1/mcp', 'live-unavailable-check', AbortSignal.timeout(5000), () => {});
  try { await assert.rejects(() => bad.connect(), e => e instanceof Error && e.message === unavailable); report.checks.push({ name: 'Unavailable server', passed: true }); } finally { await bad.close(); }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    let history: ChatCompletionMessageParam[] = []; let locations = [] as typeof mcp.locations;
    for (const question of ['Какая сейчас погода в Екатеринбурге?', 'А в Казани, Татарстан?', 'А завтра?', 'А какой там ветер?']) {
      const calls: CallLog[] = [];
      const client = new WeatherMcp(mcp.url, crypto.randomUUID(), AbortSignal.timeout(90000), e => { if (e.type === 'call') calls.push(e.call); }, locations);
      try {
        const answer = await runAgent(client, history, question, client.signal);
        assert.ok(client.weatherCount > 0, 'Expected fresh weather call');
        report.checks.push({ name: question, passed: true, answer: answer.text, calls });
        history = answer.history; locations = client.locations;
      } finally { await client.close(); }
    }
    report.agent = 'passed';
  } else report.agent = 'NOT VERIFIED: OPENAI_API_KEY / OPENAI_MODEL are not configured';
} catch (e) { report.error = publicError(e); process.exitCode = 1; }
finally { await mcp.close(); await writeFile('diagnostics/live-verification.json', JSON.stringify(safeData(report), null, 2)); }
console.log(JSON.stringify({ checks: report.checks.map((c: any) => ({ name: c.name, passed: c.passed })), agent: report.agent, error: report.error }, null, 2));
