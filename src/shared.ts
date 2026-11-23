export type Location = { name: string; latitude: number; longitude: number; timezone?: string; country?: string; admin1?: string; id?: number };
export type CallLog = { id: string; requestId: string; tool: string; city: string; arguments: Record<string, unknown>; state: 'running' | 'success' | 'error'; startedAt: string; durationMs?: number; result?: unknown; error?: string; usable?: boolean };
export type ChatMessage = { role: 'user' | 'assistant'; text: string; calls?: CallLog[]; receivedAt?: string; requestId?: string };
export type ServerEvent = { type: 'phase'; text: string } | { type: 'call'; call: CallLog } | { type: 'done'; text: string; receivedAt: string; requestId: string } | { type: 'error'; text: string; requestId: string };
