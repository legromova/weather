import { writeFile, mkdir } from 'node:fs/promises';
const url = process.env.MCP_SERVER_URL || 'https://weather.chukai.io/mcp';
let session, id = 0;
const report = { date: new Date().toISOString(), url, transport: 'Streamable HTTP', calls: [] };
async function rpc(method, params, notification = false) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': report.protocolVersion } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id: ++id } : {}), method, params }), signal: AbortSignal.timeout(25000) });
  session = r.headers.get('mcp-session-id') || session;
  const body = await r.text();
  if (!r.ok) throw Error(`HTTP ${r.status}: ${body}`);
  if (notification) return;
  const messages = body.startsWith('event:') || body.startsWith('data:') ? body.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))) : [JSON.parse(body)];
  const result = messages.find(m => m.id === id);
  report.calls.push({ method, params, response: result });
  if (result?.error) throw Error(JSON.stringify(result.error));
  return result.result;
}
try {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'weather-preflight', version: '1.0.0' } });
  report.protocolVersion = init.protocolVersion;
  await rpc('notifications/initialized', {}, true);
  report.tools = [];
  let cursor;
  do { const page = await rpc('tools/list', cursor ? { cursor } : {}); report.tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
  console.log('Tools:', report.tools.map(t => t.name).join(', '));
  function data(r) { return r.structuredContent || JSON.parse(r.content.filter(c => c.type === 'text').map(c => c.text).join('\n')); }
  report.samples = [];
  for (const name of ['Екатеринбург', 'Казань']) {
    const geo = await rpc('tools/call', { name: 'geocode_location', arguments: { name, count: 5, language: 'ru' } });
    console.log(name, JSON.stringify(geo));
    const location = data(geo).results?.[0];
    if (!location) throw Error('Location not found');
    const weather = await rpc('tools/call', { name: 'get_weather_forecast', arguments: { latitude: location.latitude, longitude: location.longitude, timezone: location.timezone, current_weather: true, forecast_days: 3, wind_speed_unit: 'ms', daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', hourly: 'temperature_2m,precipitation_probability,precipitation' } });
    report.samples.push({ name, location, weather });
    console.log(name, JSON.stringify(weather).slice(0,1800));
    if (weather.isError) throw Error('Weather tool returned isError');
  }
} catch (e) { report.error = e.message; process.exitCode = 1; }
await mkdir('diagnostics', { recursive: true });
await writeFile('diagnostics/preflight.json', JSON.stringify(report, null, 2));
