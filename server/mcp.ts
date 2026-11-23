import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CallLog, Location, ServerEvent } from '../src/shared.js';
import { AppError, safeData, unavailable } from './errors.js';
import { readResult, weatherFacts } from './weather.js';
import { assessLocations } from './locations.js';

export class WeatherMcp {
  client = new Client({ name: 'weather-ai-assistant', version: '1.0.0' });
  tools: Tool[] = [];
  locations: Location[];
  attempts = 0;
  weatherCount = 0;
  ajv = new Ajv({ strict: false, allErrors: true });
  constructor(public url: string, public requestId: string, public signal: AbortSignal, public emit: (event: ServerEvent) => void, locations: Location[] = []) { this.locations = [...locations]; }
  async connect() {
    this.emit({ type: 'phase', text: 'Подключение к удалённому MCP' });
    try {
      await this.client.connect(new StreamableHTTPClientTransport(new URL(this.url)), { signal: this.signal, timeout: 20000 });
      let cursor: string | undefined;
      do {
        const page = await this.client.listTools(cursor ? { cursor } : {}, { signal: this.signal, timeout: 20000 });
        this.tools.push(...page.tools);
        cursor = page.nextCursor;
        if (this.tools.length > 200) throw Error('Too many tools');
      } while (cursor);
    } catch { throw new AppError('MCP_UNAVAILABLE', unavailable); }
  }
  async call(name: string, args: Record<string, unknown>) {
    const tool = this.tools.find(t => t.name === name);
    if (!tool) return { error: 'Неизвестный инструмент. Выберите инструмент из tools/list.' };
    const validate = this.ajv.compile(tool.inputSchema);
    if (!validate(args)) return { error: 'Аргументы не соответствуют схеме.', details: validate.errors };
    let location: Location | undefined;
    if ('latitude' in args || 'longitude' in args) {
      location = this.locations.find(l => l.latitude === args.latitude && l.longitude === args.longitude);
      if (!location) return { error: 'Сначала получите точные координаты через geocode_location. Координаты из памяти запрещены.' };
    }
    // Batch coordinates must also originate in actual geocoding results.
    if ('latitudes' in args || 'longitudes' in args) return { error: 'В этой версии используйте одиночные инструменты для каждого города: они позволяют однозначно проверить координаты.' };
    if (args.forecast_days !== undefined && (Number(args.forecast_days) < 1 || Number(args.forecast_days) > 16)) return { error: 'Этот MCP-сервер не предоставляет доступный прогноз на запрошенный период. Допустимо 1–16 дней.' };
    for (let retry = 0; retry < 2; retry++) {
      this.signal.throwIfAborted();
      if (this.attempts >= 8) throw new AppError('LIMIT', 'Достигнут предел: 8 MCP-вызовов на сообщение. Уточните запрос.');
      this.attempts++;
      const log: CallLog = { id: randomUUID(), requestId: this.requestId, tool: name, city: location ? [location.name, location.admin1, location.country].filter(Boolean).join(', ') : typeof args.name === 'string' ? args.name : 'Не применимо', arguments: args, state: 'running', startedAt: new Date().toISOString() };
      const started = Date.now();
      this.log(log);
      this.emit({ type: 'phase', text: `Выполнение инструмента ${name}` });
      let networkFailure = false;
      try {
        let raw;
        try { raw = await this.client.callTool({ name, arguments: args }, undefined, { signal: this.signal, timeout: 25000 }); }
        catch (e) { networkFailure = !('code' in Object(e)) || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', -32001].includes((e as any).code); throw e; }
        log.result = safeData(raw);
        const data = readResult(raw);
        if (name === 'geocode_location') {
          if (!Array.isArray(data.results) || !data.results.length) throw new AppError('CITY_NOT_FOUND', 'Город не найден. Уточните название, регион или страну.');
          const valid = data.results.filter((l: any) => typeof l.name === 'string' && Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
          if (!valid.length) throw new AppError('INVALID_LOCATION', 'Сервис не вернул пригодные координаты.');
          this.locations.push(...valid);
          log.usable = true;
          const candidates = valid.map((l: Location) => ({ ...l, localNow: l.timezone ? new Date().toLocaleString('sv-SE', { timeZone: l.timezone }) : null }));
          log.state = 'success'; log.durationMs = Date.now() - started; this.log(log);
          return { data, candidates, ...assessLocations(String(args.name), candidates) };
        }
        const isWeather = ['get_weather_forecast', 'get_historical_weather'].includes(name);
        const normalized = isWeather ? weatherFacts(data, args) : undefined;
        log.usable = isWeather ? normalized!.usable : true;
        if (isWeather && !normalized!.usable) throw new AppError('NO_WEATHER', 'Сервис не вернул пригодных погодных показателей.');
        if (isWeather) this.weatherCount++;
        log.state = 'success'; log.durationMs = Date.now() - started; this.log(log);
        return { data, normalized, location, localNow: location?.timezone ? new Date().toLocaleString('sv-SE', { timeZone: location.timezone }) : null };
      } catch (e) {
        log.state = 'error'; log.durationMs = Date.now() - started;
        log.error = e instanceof AppError ? e.message : networkFailure ? unavailable : 'Инструмент MCP вернул ошибку или некорректный результат.';
        this.log(log);
        if (this.signal.aborted) throw e;
        if (networkFailure && retry === 0 && this.attempts < 8) continue;
        if (networkFailure) throw new AppError('MCP_UNAVAILABLE', unavailable);
        return { error: log.error, result: log.result, ...(e instanceof AppError && e.code === 'CITY_NOT_FOUND' ? { searchAdvice: 'Повторите геопоиск с другим написанием: название в именительном падеже без региона, затем английское название или латиница. Сохраняйте ограничения исходного запроса; не подставляйте другой город.' } : {}), instruction: 'Не использовать результат как погоду. Не повторять идентичный запрос.' };
      }
    }
    return { error: unavailable };
  }
  log(call: CallLog) { const clean = safeData(call); this.emit({ type: 'call', call: clean }); console.log(JSON.stringify({ event: 'mcp_call', ...clean })); }
  async close() { await this.client.close().catch(() => {}); }
}
