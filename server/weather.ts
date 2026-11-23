// WMO codes documented by Open-Meteo: https://open-meteo.com/en/docs
const codes: Record<number, string> = {
  0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
  45: 'Туман', 48: 'Туман с изморозью', 51: 'Слабая морось', 53: 'Умеренная морось', 55: 'Сильная морось',
  56: 'Слабая переохлаждённая морось', 57: 'Сильная переохлаждённая морось',
  61: 'Небольшой дождь', 63: 'Умеренный дождь', 65: 'Сильный дождь', 66: 'Слабый ледяной дождь', 67: 'Сильный ледяной дождь',
  71: 'Небольшой снег', 73: 'Умеренный снег', 75: 'Сильный снег', 77: 'Снежные зёрна',
  80: 'Слабый ливень', 81: 'Умеренный ливень', 82: 'Сильный ливень', 85: 'Слабый снежный ливень', 86: 'Сильный снежный ливень',
  95: 'Гроза', 96: 'Гроза со слабым градом', 99: 'Гроза с сильным градом',
};
export function describeCode(code: unknown) { return typeof code === 'number' ? codes[code] ?? `Неизвестный код погоды: ${code}` : null; }
export function windToMs(value: unknown, unit: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (unit === 'kmh' || unit === 'km/h') return value / 3.6;
  if (unit === 'ms' || unit === 'm/s') return value;
  if (unit === 'mph') return value * 0.44704;
  if (unit === 'kn') return value * 0.514444;
  return null;
}
export function readResult(result: any): Record<string, any> {
  if (result?.isError) throw Error('Инструмент MCP сообщил об ошибке.');
  let data = result?.structuredContent;
  if (!data) {
    const text = result?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    if (!text) throw Error('MCP вернул пустой результат.');
    try { data = JSON.parse(text); } catch { throw Error('MCP вернул некорректный JSON.'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) throw Error('MCP вернул пустые или некорректные данные.');
  if (data.error) throw Error('Погодный сервис сообщил об ошибке.');
  return data;
}
const number = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : null;
export function weatherFacts(data: Record<string, any>, args: Record<string, unknown>) {
  const c = data.current_weather ?? data.current;
  const current = c ? {
    temperatureC: args.temperature_unit === 'fahrenheit' ? (number(c.temperature ?? c.temperature_2m) === null ? null : ((c.temperature ?? c.temperature_2m) - 32) / 1.8) : number(c.temperature ?? c.temperature_2m),
    windMs: windToMs(c.windspeed ?? c.wind_speed_10m, data.current_weather_units?.windspeed ?? data.current_units?.wind_speed_10m ?? args.wind_speed_unit ?? 'kmh'),
    conditions: describeCode(c.weathercode ?? c.weather_code),
    observedAt: typeof c.time === 'string' ? c.time : null,
    timezone: data.timezone ?? null,
  } : null;
  const seriesUsable = (series: any) => Array.isArray(series?.time) && series.time.length > 0 && Object.entries(series).some(([k, v]) => k !== 'time' && Array.isArray(v) && v.some(x => typeof x === 'number' && Number.isFinite(x)));
  const usable = Boolean(current && [current.temperatureC, current.windMs, current.conditions].some(v => v !== null)) || seriesUsable(data.hourly) || seriesUsable(data.daily);
  const missing = current ? [current.temperatureC === null && 'Сервис не вернул температуру.', current.windMs === null && 'Сервис не вернул скорость ветра.', current.conditions === null && 'Сервис не вернул погодные условия.', !current.observedAt && 'Сервис не вернул время погодных данных.'].filter(Boolean) : [];
  return { usable, current, missing, hourly: data.hourly ?? null, daily: data.daily ?? null, timezone: data.timezone ?? null };
}
