import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { MemoryStore } from './store.js';
import { summarizeSession } from './summarize.js';
export const name = 'dsh-memory-scope';
export const inject = ['agents', 'webServer', 'llm'];
const reply = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const trustedPost = req => {
  const host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (host && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return false;
  if (!req.headers?.origin) return true;
  try { return new URL(req.headers.origin).host === host; } catch { return false; }
};
const read = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 16384) { reject(new Error('输入过长')); req.destroy(); } });
  req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('输入无效')); } });
  req.on('error', reject);
});
export function apply(ctx) {
  const homeService = ctx.get('dshHomePath');
  const file = typeof homeService === 'function' ? homeService('memory-scope', 'memory.json') : path.join(os.homedir(), '.dsh', 'memory-scope', 'memory.json');
  const store = new MemoryStore(file);
  const hooked = new Map(), timers = new Map(), running = new Set();
  async function summarize(agent, scope) {
    if (running.has(scope)) throw new Error('该范围正在整理，请稍后重试');
    running.add(scope);
    try { return await summarizeSession({ store, agent, llm: ctx.get('llm'), scope }); }
    finally { running.delete(scope); }
  }
  function install(agent) {
    if (!agent?.id || !agent.ctx || hooked.has(agent)) return;
    let lastText = '';
    const dispose = agent.ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next();
      if (payload.step !== 1 || decision.kind !== 'enter' || payload.signal?.aborted || !Array.isArray(decision.messages)) return decision;
      let memory;
      try {
        const scope = store.scopeForSession(agent.id, agent.session?.header?.cwd);
        memory = scope ? store.read().profiles[scope] : null;
        if (scope && memory?.summary && !store.read().owners?.[agent.id]) store.claim(agent.id, scope);
      }
      catch (error) { console.error('[dsh-memory-scope] 读取记忆失败，跳过注入：', error.message); return decision; }
      const text = memory?.summary?.trim() || '';
      if (!text) { lastText = ''; return decision; }
      if (text === lastText) return decision;
      lastText = text;
      return { ...decision, messages: [...decision.messages, { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: '【本会话已绑定的长期记忆，可能不完整或有误】\n' + text }], source: { kind: 'dsh-memory-scope', form: 'recall' } }] };
    }, { prepend: true });
    const offEvents = agent.ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event?.type !== 'turn/end') return;
      const old = timers.get(agent); if (old) clearTimeout(old);
      const timer = setTimeout(async () => {
        timers.delete(agent);
        try {
          if (agent.status !== 'idle') return;
          const scope = store.scopeForSession(agent.id, agent.session?.header?.cwd);
          const data = store.read();
          if (!scope || data.profiles[scope]?.auto !== true) return;
          const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events;
          if (!Array.isArray(events)) return;
          const after = data.checkpoints?.[agent.id]?.scope === scope ? Number(data.checkpoints[agent.id].seq || 0) : 0;
          const count = events.filter(e => e.type === 'user/message' && e.seq > after && e.data?.source?.kind === 'user').length;
          if (count >= 30) await summarize(agent, scope);
        } catch (error) { console.error('[dsh-memory-scope] 自动整理失败，旧记忆保留：', error.message); }
      }, 30000);
      timer.unref?.(); timers.set(agent, timer);
    });
    hooked.set(agent, () => { dispose(); offEvents(); const timer = timers.get(agent); if (timer) clearTimeout(timer); timers.delete(agent); });
  }
  ctx.effect(() => {
    const off = ctx.on('agent/created', ({ agent }) => install(agent));
    for (const agent of ctx.agents.roots()) install(agent);
    return () => { off(); for (const dispose of hooked.values()) dispose(); hooked.clear(); };
  }, 'dsh-memory-scope lifecycle');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/dsh-memory-scope', handler: async (req, res) => {
    try {
      if (!['GET', 'POST'].includes(req.method)) return reply(res, 405, { ok: false, error: '不支持的操作' });
      let newSessionId;
      if (req.method === 'POST') {
        if (!trustedPost(req)) return reply(res, 403, { ok: false, error: '不允许的请求来源' });
        const input = await read(req);
        if (input.action === 'create') store.create(input.id, input.label);
        else if (input.action === 'bind') { if (!ctx.agents.get(input.sessionId)) throw new Error('会话不在线，请先打开会话'); store.bind(input.sessionId, input.id); }
        else if (input.action === 'unbind') store.unbind(input.sessionId);
        else if (input.action === 'bindWorkspace') store.bindWorkspace(input.root, input.id);
        else if (input.action === 'unbindWorkspace') store.unbindWorkspace(input.root);
        else if (input.action === 'save') store.setSummary(input.id, input.summary);
        else if (input.action === 'auto') store.setAuto(input.id, input.enabled);
        else if (input.action === 'summarize') {
          const agent = ctx.agents.get(input.sessionId);
          if (!agent) throw new Error('会话不在线，请先打开会话');
          await summarize(agent, input.id);
        }
        else if (input.action === 'newSession') {
          const agent = ctx.agents.get(input.sessionId);
          if (!agent || agent.status !== 'idle') throw new Error('原会话不存在或仍在运行，请稍后重试');
          if (store.scopeForSession(agent.id, agent.session?.header?.cwd) !== input.id) throw new Error('请先把会话绑定到该记忆范围');
          try { await summarize(agent, input.id); }
          catch (error) { if (!String(error.message).includes('没有找到需要整理的新消息')) throw error; }
          const events = typeof agent.session.snapshotEvents === 'function' ? agent.session.snapshotEvents() : agent.session.events;
          if (!Array.isArray(events)) throw new Error('无法确认近期会话记录，未创建新会话');
          const current = store.read(), mark = current.checkpoints?.[agent.id];
          const through = mark?.scope === input.id ? Number(mark.seq) || 0 : 0;
          if (agent.status !== 'idle' || events.some(e => Number.isSafeInteger(e.seq) && e.seq > through && ((e.type === 'user/message' && e.data?.source?.kind === 'user') || e.type === 'assistant/message'))) throw new Error('整理期间出现新消息，未创建新会话，请重试');
          const controller = ctx.get('sessionController'), registry = ctx.get('workspaceRegistry');
          if (!controller?.create || !registry?.list) throw new Error('此版本不支持创建工作区会话');
          const workspace = registry.list().find(w => Array.isArray(w.sessionIds) && w.sessionIds.includes(agent.id));
          if (!workspace) throw new Error('原会话未关联工作区，无法自动创建新会话');
          const preset = agent.session?.header?.agentPreset;
          const created = await controller.create({ workspaceId: workspace.id, ...(preset ? { agentPreset: preset } : {}) });
          if (!created?.sessionId) throw new Error('大肥鱼未返回新会话编号');
          if (agent.status !== 'idle') throw new Error('已创建新会话，但原会话出现新消息；请重新整理后手动绑定：' + created.sessionId);
          try { store.bind(created.sessionId, input.id); }
          catch (error) { throw new Error('已创建新会话但绑定失败，请手动绑定：' + created.sessionId); }
          newSessionId = created.sessionId;
        }
        else throw new Error('未知操作');
      }
      const data = store.read();
      const sessions = ctx.agents.roots().filter(agent => agent?.id).map(agent => ({ id: agent.id, cwd: agent.session?.header?.cwd || '', status: agent.status || '' }));
      return reply(res, 200, { ok: true, profiles: data.profiles, bindings: data.bindings, workspaces: data.workspaces || {}, sessions, newSessionId });
    } catch (error) { return reply(res, 400, { ok: false, error: String(error?.message || '操作失败') }); }
  }}), 'dsh-memory-scope control');
}
