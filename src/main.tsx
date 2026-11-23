import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CallLog, ChatMessage, ServerEvent } from './shared';
import './style.css';

const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const states = { running: 'Выполняется', success: 'Успешно', error: 'Ошибка' };
function Calls({ calls }: { calls: CallLog[] }) {
  return <details className="calls"><summary>MCP-вызовы <span>{calls.length}</span></summary><div className="call-list">{calls.map(call => <section className="call" key={call.id}>
    <div className="call-title"><code>{call.tool}</code><span className={`state ${call.state}`}>{states[call.state]}</span></div>
    <p>{call.city}</p><p className="metadata">{time(call.startedAt)} · {call.durationMs === undefined ? 'В процессе' : `${call.durationMs} мс`}</p>
    {call.usable === false && <p className="warning">Пригодные погодные данные отсутствуют</p>}
    <details><summary>Аргументы</summary><pre>{JSON.stringify(call.arguments, null, 2)}</pre></details>
    {(call.result !== undefined || call.error) && <details><summary>Результат{call.error ? ' / ошибка' : ''}</summary>{call.error && <p className="warning">{call.error}</p>}<pre>{JSON.stringify(call.result ?? null, null, 2)}</pre></details>}
  </section>)}</div></details>;
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const session = useRef<string | null>(null);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { fetch('/api/health').then(r => r.json()).then(d => setConfigured(d.configured)).catch(() => setError('Нет соединения с локальным сервером. Проверьте npm run dev.')); return () => abort.current?.abort(); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, phase]);
  async function ensureSession(signal: AbortSignal) {
    if (session.current) return session.current;
    const response = await fetch('/api/chat/new', { method: 'POST', signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Не удалось создать чат.');
    session.current = data.sessionId; return data.sessionId;
  }
  async function newChat() {
    if (inFlight.current) return;
    const old = session.current; session.current = null;
    setMessages([]); setError(''); setInput(''); setPhase('');
    if (old) await fetch(`/api/chat/${old}`, { method: 'DELETE' }).catch(() => {});
    field.current?.focus();
  }
  async function send(text: string) {
    if (inFlight.current || !text.trim()) return;
    inFlight.current = true; setBusy(true); setError(''); setInput(''); setPhase('Подключение к локальному серверу');
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 95000);
    setMessages(prev => [...prev, { role: 'user', text: text.trim() }, { role: 'assistant', text: '', calls: [] }]);
    const update = (fn: (m: ChatMessage) => ChatMessage) => setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? fn(m) : m));
    let finished = false;
    function event(e: ServerEvent) {
      if (e.type === 'phase') setPhase(e.text);
      if (e.type === 'call') update(m => ({ ...m, calls: [...(m.calls ?? []).filter(c => c.id !== e.call.id), e.call] }));
      if (e.type === 'done') { finished = true; update(m => ({ ...m, text: e.text, receivedAt: e.receivedAt, requestId: e.requestId })); }
      if (e.type === 'error') { finished = true; update(m => ({ ...m, text: e.text, requestId: e.requestId })); }
    }
    try {
      const sessionId = await ensureSession(controller.signal);
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message: text.trim() }), signal: controller.signal });
      if (!response.ok) { const data = await response.json(); throw Error(data.error || 'Ошибка локального сервера.'); }
      const reader = response.body?.getReader(); if (!reader) throw Error('Не удалось открыть поток ответа.');
      const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) event(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) event(JSON.parse(buffer));
      if (!finished) throw Error('Соединение прервано до получения ответа. Повторите запрос.');
    } catch (e) {
      const text = controller.signal.aborted ? 'Истекло время ожидания ответа. Попробуйте ещё раз.' : e instanceof Error ? e.message : 'Соединение прервано.';
      update(m => ({ ...m, text, calls: m.calls?.map(c => c.state === 'running' ? { ...c, state: 'error', error: 'Соединение прервано; итог вызова неизвестен.' } : c) }));
    } finally { clearTimeout(timer); inFlight.current = false; setBusy(false); setPhase(''); abort.current = null; field.current?.focus(); }
  }
  return <div className="shell">
    <header><div className="brand"><div className="brand-icon" aria-hidden="true">☀</div><div><h1>Погодный AI-помощник</h1><p>Погода с пониманием контекста</p></div></div><button className="new-chat" disabled={busy} onClick={newChat}>＋ <span>Новый чат</span></button></header>
    <main>
      <div className="source"><span className="source-icon" aria-hidden="true">◈</span> Open-Meteo через MCP <span className="source-note">Реальные данные · Удалённый сервер</span></div>
      {configured === false && <div className="notice"><strong>Осталось подключить модель</strong><span>Укажите OPENAI_API_KEY и OPENAI_MODEL в серверном файле .env, затем перезапустите приложение.</span></div>}
      {error && <p role="alert" className="notice">{error}</p>}
      <div className="conversation" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? <div className="welcome"><div className="weather-symbol" aria-hidden="true"><span>☀</span><b>☁</b></div><div className="eyebrow">ВАШ ПЛАН НА ДЕНЬ НАЧИНАЕТСЯ ЗДЕСЬ</div><h2>Какая погода<br/>у вас на уме?</h2><p>Напишите название любого города<br/>и спросите о текущей погоде или прогнозе.</p><p className="welcome-note">Можно продолжить: «А завтра?» или «А какой там ветер?»</p></div> : messages.map((m, i) => <article key={i} className={`message ${m.role}`}><div className="avatar" aria-hidden="true">{m.role === 'assistant' ? '☀' : 'Вы'}</div><div className="message-body"><div className="message-label">{m.role === 'assistant' ? 'Погодный помощник' : 'Вы'}</div>{m.text && <div className="message-text">{m.text}</div>}{busy && i === messages.length - 1 && <div className="progress" role="status"><span className="spinner"/>{phase}</div>}{Boolean(m.calls?.length) && <Calls calls={m.calls!}/>}<div className="metadata">{m.receivedAt && `Ответ получен: ${time(m.receivedAt)} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}{m.requestId && <details><summary>ID запроса</summary><code>{m.requestId}</code></details>}</div></div></article>)}
        <div ref={bottom}/>
      </div>
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(input); }}><label htmlFor="message" className="sr-only">Вопрос о погоде</label><textarea id="message" ref={field} rows={2} value={input} maxLength={4000} disabled={busy} onChange={e => setInput(e.target.value)} placeholder="Спросите о погоде в любом городе…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}/><div className="composer-bottom"><span>Enter — отправить · Shift + Enter — новая строка</span><button className="send" disabled={busy || !input.trim()} type="submit">{busy ? 'Обработка…' : 'Отправить'}</button></div></form>
      <footer>Ответы основаны на данных сервиса. Прогноз может меняться.<span>Пользователь → AI → MCP → погода</span></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
