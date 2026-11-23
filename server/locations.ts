import type { Location } from '../src/shared.js';

// A spelling check is a hint for the agent, not a substitute for geographic disambiguation.
const normalizeName = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
export function assessLocations(query: string, candidates: Location[]) {
  const cityName = query.split(',')[0].trim();
  const exactNameMatches = candidates.filter(l => normalizeName(l.name) === normalizeName(cityName));
  const searchAdvice = exactNameMatches.length === 0
    ? 'Нет точного совпадения названия. Похожие названия не означают неоднозначность искомого города. Не выбирайте их координаты. Повторите geocode_location с названием в именительном падеже без региона; если не помогло — с английским названием или латинским написанием. Сохраните исходные ограничения региона/страны. Только после проверки альтернативного написания можно сообщить, что город не найден.'
    : exactNameMatches.length === 1
      ? 'Найдено одно точное совпадение названия. Проверьте его регион/страну по запросу; аэропорты и другие похожие названия не делают этот город неоднозначным.'
      : 'Есть несколько точных совпадений. Выберите по явно указанному региону/стране; если их недостаточно, уточните у пользователя до погодного вызова.';
  return { exactNameMatches, searchAdvice };
}
