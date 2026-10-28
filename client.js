window.__ModuleLoader__.load({ id: 'dsh-memory-scope', factory: require => {
  const React = require('react'), h = React.createElement, ID = 'dsh-memory-scope';
  function Panel() {
    const [profiles, setProfiles] = React.useState({}), [bindings, setBindings] = React.useState({}), [sessions, setSessions] = React.useState([]);
    const [id, setId] = React.useState(''), [label, setLabel] = React.useState(''), [scope, setScope] = React.useState(''), [sessionId, setSession] = React.useState(''), [summary, setSummary] = React.useState(''), [workspace, setWorkspace] = React.useState(''), [workspaceRules, setWorkspaceRules] = React.useState({}), [notice, setNotice] = React.useState('正在读取…'), [busy, setBusy] = React.useState(false);
    async function call(body) {
      setBusy(true);
      try {
        const r = await fetch('/api/dsh-memory-scope', { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await r.json(); if (!r.ok || !data.ok) throw new Error(data.error || '请求失败');
        setProfiles(data.profiles); setBindings(data.bindings); setSessions(data.sessions); setWorkspaceRules(data.workspaces || {});
        if (scope && data.profiles[scope]) setSummary(data.profiles[scope].summary);
        if (data.newSessionId) setSession(data.newSessionId);
        setNotice(data.newSessionId ? '已创建并绑定新会话：' + data.newSessionId : '已更新。');
      } catch (error) { setNotice(error.message); } finally { setBusy(false); }
    }
    React.useEffect(() => { void call(); }, []);
    function choose(value) { setScope(value); setSummary(profiles[value]?.summary || ''); }
    return h('section', { style: { padding: 24, maxWidth: 750 } },
      h('h2', null, '长期记忆'), h('p', null, '为不同用途建立隔离的记忆范围；只有手动绑定的会话才会读取该范围。'), h('p', { role: 'status' }, notice),
      h('h3', null, '创建记忆范围'), h('input', { value: id, onChange: e => setId(e.target.value), placeholder: '英文标识，例如 office' }), ' ', h('input', { value: label, onChange: e => setLabel(e.target.value), placeholder: '名称，例如 办公' }), ' ', h('button', { disabled: busy, onClick: () => call({ action: 'create', id, label }) }, '创建'),
      h('h3', null, '选择范围与会话'), h('select', { value: scope, onChange: e => choose(e.target.value) }, h('option', { value: '' }, '选择记忆范围'), ...Object.entries(profiles).map(([k, v]) => h('option', { key: k, value: k }, v.label))), ' ',
      h('select', { value: sessionId, onChange: e => setSession(e.target.value) }, h('option', { value: '' }, '选择已打开的会话'), ...sessions.map(s => h('option', { key: s.id, value: s.id }, `${s.id} ${s.cwd}`))),
      h('p', null, '当前绑定：', bindings[sessionId] ? (profiles[bindings[sessionId]]?.label || bindings[sessionId]) : '无'),
      h('button', { disabled: busy || !scope || !sessionId, onClick: () => call({ action: 'bind', id: scope, sessionId }) }, '绑定会话'), ' ', h('button', { disabled: busy || !sessionId, onClick: () => call({ action: 'unbind', sessionId }) }, '解除绑定'),
      h('h3', null, '办公工作区记忆'),
      h('p', null, '把范围绑定到工作区后，该目录及其子目录的会话会读取此记忆。不要绑定包含群聊或他人聊天的目录。'),
      h('input', { value: workspace, onChange: e => setWorkspace(e.target.value), placeholder: '工作区绝对路径', style: { width: '70%' } }), ' ', h('button', { disabled: busy || !sessionId, onClick: () => setWorkspace(sessions.find(s => s.id === sessionId)?.cwd || '') }, '填入所选会话的工作区'), ' ',
      h('button', { disabled: busy || !scope || !workspace, onClick: () => { if (window.confirm('此目录和子目录的会话将共享该记忆。请确认这里没有群聊或其他人的私聊。')) void call({ action: 'bindWorkspace', id: scope, root: workspace }); } }, '绑定办公工作区'), ' ',
      h('button', { disabled: busy || !workspace, onClick: () => call({ action: 'unbindWorkspace', root: workspace }) }, '解除工作区绑定'),
      h('ul', null, Object.entries(workspaceRules).map(([root, id]) => h('li', { key: root }, root + ' → ' + (profiles[id]?.label || id)))),
      h('p', null, h('button', { disabled: busy || !scope || !sessionId, onClick: () => { if (window.confirm('先整理记忆，再在当前工作区创建新会话？旧会话会保留。')) void call({ action: 'newSession', id: scope, sessionId }); } }, '整理记忆并创建新会话')),
      h('h3', null, '记忆摘要'),
      h('label', null, h('input', { type: 'checkbox', checked: Boolean(profiles[scope]?.auto), disabled: busy || !scope, onChange: e => call({ action: 'auto', id: scope, enabled: e.target.checked }) }), ' 自动整理：累计约 30 条新消息后在空闲时整理，会调用模型并产生费用。'),
      h('textarea', { value: summary, onChange: e => setSummary(e.target.value), maxLength: 4000, style: { width: '100%', minHeight: 140 } }),
      h('p', null, h('button', { disabled: busy || !scope, onClick: () => call({ action: 'save', id: scope, summary }) }, '保存'), ' ', h('button', { disabled: busy || !scope || !sessionId, onClick: () => call({ action: 'summarize', id: scope, sessionId }) }, '整理已绑定会话并保存记忆')),
      h('p', null, '新会话需要重新绑定；解绑不会移除已进入当前会话上下文的记忆。压缩可能消耗模型额度。')
    );
  }
  return { inject: ['slots', 'layout'], apply(ctx) { const slots = ctx.get('slots');
    slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: ID, order: 29, label: '长期记忆' }, () => h(Panel)));
    slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: ID, order: 4, label: '长期记忆' }, () => h('span', { 'aria-hidden': true }, '🧠')));
    slots.inject('main', () => slots.register({ name: 'main', key: ID }, () => h(Panel)));
  }};
}});
