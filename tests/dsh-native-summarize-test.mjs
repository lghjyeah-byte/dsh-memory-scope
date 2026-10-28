import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../store.js';
import { summarizeSession, collectStream } from '../summarize.js';
const root = path.resolve('tests/dsh-native-memory-fixture'); fs.mkdirSync(root, { recursive: true });
const file = path.join(root, 'summary-test.json'); if (fs.existsSync(file)) fs.unlinkSync(file);
const store = new MemoryStore(file); store.create('office', '办公'); store.bind('session-a', 'office');
const agent = { id: 'session-a', model: { current: () => ({ provider: 'test', model: 'test' }) }, session: { events: [
  { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我喜欢用表格做计划' }] } },
  { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '以后用表格。' }] } } },
] } };
let llm = { async *stream() { yield { type: 'text-delta', text: '{"summary":"用户喜欢用表格做计划","evidence":["喜欢用表格做计划"]}' }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
await summarizeSession({ store, agent, llm, scope: 'office' });
assert.equal(store.read().profiles.office.summary, '用户喜欢用表格做计划');
assert.equal(store.read().checkpoints['session-a'].seq, 2);
agent.session.events.push({ seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我喜欢蓝色' }] } });
llm = { async *stream() { yield { type: 'text-delta', text: '{"summary":"被编造","evidence":["不在原文里的证据"]}' }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
await assert.rejects(summarizeSession({ store, agent, llm, scope: 'office' }), /依据/);
assert.equal(store.read().profiles.office.summary, '用户喜欢用表格做计划');
assert.equal(store.read().checkpoints['session-a'].seq, 2);
await assert.rejects(summarizeSession({ store, agent, llm, scope: 'friends' }), /绑定/);
llm = { async *stream() { yield { type: 'text-delta', text: '{\"summary\":\"用户喜欢蓝色\",\"evidence\":[\"我喜欢蓝色\"]}' }; yield { type: 'finish', reason: { kind: 'max-tokens' } }; } };
await assert.rejects(summarizeSession({ store, agent, llm, scope: 'office' }), /未完成/);
assert.equal(store.read().profiles.office.summary, '用户喜欢用表格做计划');
const controller = new AbortController();
const stalled = { [Symbol.asyncIterator]() { return { next() { return new Promise(() => {}); }, return() { return Promise.resolve({ done: true }); } }; } };
const pending = collectStream(stalled, controller.signal);
controller.abort();
await assert.rejects(pending, /超时/);
console.log('摘要生成、错误依据保护、会话隔离、模型超时：通过');
