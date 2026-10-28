import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../store.js';
import { summarizeSession } from '../summarize.js';
import { apply } from '../index.js';
const root=path.resolve('tests/dsh-native-memory-fixture');fs.mkdirSync(root,{recursive:true});const file=path.join(root,'cross.json');if(fs.existsSync(file))fs.unlinkSync(file);
const store=new MemoryStore(file);store.create('office','办公');store.create('chat_a','聊天 A');store.create('chat_b','聊天 B');store.bindWorkspace(path.join(root,'office'),'office');store.bind('chat-a-old','chat_a');store.bind('chat-b','chat_b');
const events=[{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'我的办公报告喜欢使用蓝色表格'}]}}];
const old={id:'office-old',session:{header:{cwd:path.join(root,'office')},events},model:{current:()=>({provider:'test',model:'test'})}};
const llm={async *stream(){yield {type:'text-delta',text:'{"summary":"办公报告喜欢使用蓝色表格","evidence":["办公报告喜欢使用蓝色表格"]}'};yield {type:'finish',reason:{kind:'stop'}};}};
await summarizeSession({store,agent:old,llm,scope:'office'});
const listeners=new Map();function makeAgent(id,cwd){return {id,session:{header:{cwd}},ctx:{on(type,fn){listeners.set(id+type,fn);return ()=>{};}}};}
const agents=[makeAgent('office-new',path.join(root,'office','project')),makeAgent('chat-a-new',path.join(root,'chats')),makeAgent('chat-b',path.join(root,'chats'))];store.bind('chat-a-new','chat_a');store.setSummary('chat_a','A 喜欢音乐');store.setSummary('chat_b','B 喜欢绘画');
const ctx={get:k=>k==='dshHomePath'?()=>file:undefined,agents:{roots:()=>agents,get:id=>agents.find(a=>a.id===id)},webServer:{register:()=>()=>{}},on:()=>()=>{},effect:fn=>fn()};apply(ctx);
async function reply(id){return listeners.get(id+'agent/pre-step')({step:1,signal:new AbortController().signal},async()=>({kind:'enter',messages:[]}));}
assert.match(JSON.stringify(await reply('office-new')),/办公报告喜欢使用蓝色表格/);
const a=JSON.stringify(await reply('chat-a-new'));assert.match(a,/A 喜欢音乐/);assert.doesNotMatch(a,/B 喜欢绘画|办公报告/);
const b=JSON.stringify(await reply('chat-b'));assert.match(b,/B 喜欢绘画/);assert.doesNotMatch(b,/A 喜欢音乐|办公报告/);
console.log('办公新会话共享、聊天新会话绑定及不同聊天隔离：通过（模拟环境）');
