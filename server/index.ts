import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Location, ServerEvent } from '../src/shared.js';
import { WeatherMcp } from './mcp.js';
import { runAgent } from './agent.js';
import { errorDiagnostics, publicError, safeData } from './errors.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { res.status(403).json({ error: 'Доступ разрешён только локальному приложению.' }); return; }
  next();
});
type Session = { history: ChatCompletionMessageParam[]; locations: Location[]; updated: number; busy: boolean };
const sessions = new Map<string, Session>();
setInterval(() => { for (const [id, s] of sessions) if (!s.busy && Date.now() - s.updated > 3600000) sessions.delete(id); }, 60000).unref();
app.get('/api/health', (_req, res) => res.json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL), source: 'Open-Meteo через MCP' }));
app.post('/api/chat/new', (_req, res) => {
  if (sessions.size >= 100) { res.status(429).json({ error: 'Слишком много открытых чатов. Перезапустите сервер.' }); return; }
  const id = randomUUID(); sessions.set(id, { history: [], locations: [], updated: Date.now(), busy: false }); res.json({ sessionId: id });
});
app.delete('/api/chat/:id', (req, res) => { sessions.delete(req.params.id); res.sendStatus(204); });
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body ?? {};
  const s = sessions.get(sessionId);
  if (!s) { res.status(404).json({ error: 'Чат не найден или истёк. Нажмите «Новый чат».' }); return; }
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) { res.status(400).json({ error: 'Введите сообщение длиной от 1 до 4000 символов.' }); return; }
  if (s.busy) { res.status(409).json({ error: 'Дождитесь завершения предыдущего запроса.' }); return; }
  // Bound memory without silently dropping the chosen city from an active dialog.
  if (JSON.stringify(s.history).length > 350000) { res.status(413).json({ error: 'Достигнут предел длины чата. Начните новый чат.' }); return; }
  s.busy = true; s.updated = Date.now();
  const requestId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  const emit = (event: ServerEvent) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(safeData(event)) + '\n'); };
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const mcp = new WeatherMcp(process.env.MCP_SERVER_URL || 'https://weather.chukai.io/mcp', requestId, controller.signal, emit, s.locations);
  try {
    const answer = await runAgent(mcp, s.history, message.trim(), controller.signal);
    s.history = answer.history; s.locations = mcp.locations;
    emit({ type: 'done', text: answer.text, receivedAt: new Date().toISOString(), requestId });
  } catch (e) {
    const text = publicError(e, controller.signal.aborted);
    console.error(JSON.stringify(safeData({ event: 'request_error', requestId, text, diagnostics: errorDiagnostics(e) })));
    emit({ type: 'error', text, requestId });
  } finally {
    clearTimeout(timer); s.busy = false; s.updated = Date.now();
    res.end(); await mcp.close();
  }
});
app.use(express.static('dist'));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: 'Некорректный запрос.' }); });
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`API: http://127.0.0.1:${port}`));
