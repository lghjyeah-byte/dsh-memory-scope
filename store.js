import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const scopeId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);
const sessionId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);
export class MemoryStore {
  constructor(file) { this.file = file; }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, profiles: {}, bindings: {}, owners: {}, workspaces: {} };
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (value?.version !== 1 || !value.profiles || !value.bindings) throw new Error('记忆文件格式不正确，未覆盖');
    return value;
  }
  update(fn) {
    const data = this.read();
    fn(data);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, this.file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return data;
  }
  create(id, label) {
    if (!scopeId(id) || typeof label !== 'string' || !label.trim() || label.length > 80) throw new Error('记忆范围名称无效');
    return this.update(data => { if (data.profiles[id]) throw new Error('记忆范围已存在'); data.profiles[id] = { label: label.trim(), summary: '', auto: false, updatedAt: Date.now() }; });
  }
  bind(session, id) {
    if (!sessionId(session) || !scopeId(id)) throw new Error('会话或记忆范围无效');
    return this.update(data => { if (!Object.hasOwn(data.profiles, id)) throw new Error('记忆范围不存在'); data.owners ||= {}; const original = data.owners[session] || data.bindings[session]; if (original && original !== id) throw new Error('这个会话曾使用其他记忆范围，请在新会话中绑定'); data.owners[session] = id; data.bindings[session] = id; if (data.suppressed) delete data.suppressed[session]; });
  }
  unbind(session) {
    if (!sessionId(session)) throw new Error('会话无效');
    return this.update(data => { delete data.bindings[session]; data.suppressed ||= {}; data.suppressed[session] = true; });
  }
  setAuto(id, enabled) {
    if (!scopeId(id) || typeof enabled !== 'boolean') throw new Error('自动整理设置无效');
    return this.update(data => { if (!Object.hasOwn(data.profiles, id)) throw new Error('记忆范围不存在'); data.profiles[id].auto = enabled; });
  }
  setSummary(id, summary) {
    if (!scopeId(id) || typeof summary !== 'string' || summary.length > 4000) throw new Error('摘要无效或超过 4000 字');
    return this.update(data => { if (!Object.hasOwn(data.profiles, id)) throw new Error('记忆范围不存在'); data.profiles[id].summary = summary.trim(); data.profiles[id].updatedAt = Date.now(); });
  }
  bindWorkspace(root, id) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || !scopeId(id)) throw new Error('请填写有效的工作区绝对路径');
    const normalized = path.resolve(root);
    return this.update(data => { if (!Object.hasOwn(data.profiles, id)) throw new Error('记忆范围不存在'); data.workspaces ||= {}; data.workspaces[normalized] = id; });
  }
  unbindWorkspace(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('工作区路径无效');
    return this.update(data => { if (data.workspaces) delete data.workspaces[path.resolve(root)]; });
  }
  scopeForSession(session, cwd = '') {
    const data = this.read();
    let id = data.bindings[session];
    if (!id && data.suppressed?.[session]) return null;
    if (!id && typeof cwd === 'string' && path.isAbsolute(cwd)) {
      const current = path.resolve(cwd);
      const matches = Object.entries(data.workspaces || {}).filter(([root]) => {
        const relative = path.relative(root, current);
        return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
      }).sort((a, b) => b[0].length - a[0].length);
      id = matches[0]?.[1];
    }
    if (data.owners?.[session] && data.owners[session] !== id) return null;
    return id && Object.hasOwn(data.profiles, id) ? id : null;
  }
  claim(session, id) {
    if (!sessionId(session) || !scopeId(id)) throw new Error('会话或范围无效');
    return this.update(data => { data.owners ||= {}; if (data.owners[session] && data.owners[session] !== id) throw new Error('会话已属于其他记忆范围'); data.owners[session] = id; });
  }
  forSession(session, cwd = '') {
    const id = this.scopeForSession(session, cwd);
    return id ? this.read().profiles[id] : null;
  }
}
