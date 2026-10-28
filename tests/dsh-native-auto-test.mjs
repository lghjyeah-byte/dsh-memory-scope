import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {MemoryStore} from '../store.js';import {apply} from '../index.js';
const root=path.resolve('tests/dsh-native-memory-fixture');fs.mkdirSync(root,{recursive:true});const file=path.join(root,'auto.json');if(fs.existsSync(file))fs.unlinkSync(file);
const store=new MemoryStore(file);store.create('chat','聊天');store.bind('auto-session','chat');
const events=Array.from({length:30},(_,i)=>({seq:i+1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:i===0?'我喜欢吃橙子':'随便聊聊'}]}}));
const listeners={};const agent={id:'auto-session',status:'idle',session:{header:{},events},model:{current:()=>({provider:'fake',model:'fake'})},ctx:{on(name,fn){listeners[name]=fn;return ()=>{};}}};
let calls=0;const llm={async *stream(){calls++;yield {type:'text-delta',text:'{"summary":"喜欢吃橙子","evidence":["我喜欢吃橙子"]}'};yield {type:'finish',reason:{kind:'stop'}};}};
const ctx={get:name=>name==='dshHomePath'?()=>file:name==='llm'?llm:undefined,agents:{roots:()=>[agent],get:()=>agent},webServer:{register:()=>()=>{}},on:()=>()=>{},effect:fn=>fn()};
const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let task;
globalThis.setTimeout=(fn,ms,...args)=>{if(ms===30000){task=fn;return {unref(){}};}return originalSet(fn,ms,...args);};globalThis.clearTimeout=x=>{if(typeof x==='object'&&x?.unref) return;return originalClear(x);};
try {apply(ctx);listeners['session/event'](agent.session,{type:'turn/end'});await task();assert.equal(calls,0);store.setAuto('chat',true);listeners['session/event'](agent.session,{type:'turn/end'});await task();assert.equal(calls,1);assert.equal(store.read().profiles.chat.summary,'喜欢吃橙子');console.log('自动整理默认关闭、启用后批量整理：通过（模拟环境）');}
finally {globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
