export class AppError extends Error { constructor(public code: string, message: string) { super(message); } }
export function errorDiagnostics(e: unknown) {
  const err = e as { status?: number; code?: string; param?: string; request_id?: string } | null;
  const causes: string[] = [];
  let cause: any = e;
  for (let depth = 0; cause && depth < 6; depth++, cause = cause.cause) {
    if (typeof cause.code === 'string') causes.push(cause.code);
  }
  return { status: err?.status, code: err?.code, param: err?.param, providerRequestId: err?.request_id, causes };
}
export function publicError(e: unknown, aborted = false): string {
  const err = (e ?? {}) as { code?: string; status?: number; name?: string; constructor?: { name?: string } };
  const { causes } = errorDiagnostics(e);
  if (aborted || err.name === 'AbortError' || err.code === 'TIMEOUT' || err.constructor?.name === 'APIConnectionTimeoutError') return 'Время ожидания истекло. Запрос ограничен 90 секундами. Попробуйте ещё раз.';
  if (e instanceof AppError) return e.message;
  if (causes.some(c => ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED'].includes(c))) return 'Не удалось проверить HTTPS-сертификат OpenAI. Запускайте приложение через npm run dev или npm start на Node.js 24+: эти команды используют доверенные сертификаты системы.';
  if (causes.some(c => ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(c)) || err.constructor?.name === 'APIConnectionError') return 'Не удалось установить HTTPS-соединение с OpenAI. Проверьте доступ к api.openai.com и настройки сети или прокси.';
  if (err.status === 401 || err.status === 403) return 'OpenAI отклонил ключ или доступ к модели. Проверьте настройки .env.';
  if (err.status === 404) return 'Указанная OPENAI_MODEL не найдена или недоступна этому API-ключу. Проверьте имя модели и доступ в аккаунте OpenAI.';
  if (err.status === 400) return 'OpenAI отклонил параметры запроса. Проверьте, что выбранная модель поддерживает Chat Completions и вызов инструментов.';
  if (err.status === 429) return 'Превышен лимит OpenAI или закончился баланс. Проверьте квоту и повторите позже.';
  return 'Не удалось выполнить запрос к OpenAI. Проверьте подключение и доступность выбранной модели.';
}
export const unavailable = 'Не удалось получить погоду: погодный сервис сейчас недоступен. Попробуйте повторить запрос позже.';
export function safeData(value: unknown): any {
  const secret = process.env.OPENAI_API_KEY;
  return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'string' ? (secret ? v.split(secret).join('[СКРЫТО]') : v).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[СКРЫТО]') : v));
}
