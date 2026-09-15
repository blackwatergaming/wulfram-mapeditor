import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
export const sessionDirectory=()=>process.env.WULFRAM_MCP_SESSION_DIR??path.join(process.env.LOCALAPPDATA??'', 'BlackwaterGaming','WulframForge','mcp-sessions');
export async function readSession(id) {
  if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid editor session ID.');
  const s=JSON.parse(await fs.readFile(path.join(sessionDirectory(),`${id}.json`),'utf8'));
  if(s.protocolVersion!==1||s.sessionId!==id||s.pipeName!==`WulframForge-${id}`||!/^[A-F0-9]{64}$/.test(s.token))throw new Error('Invalid editor session descriptor.');
  return s;
}
export async function requestEditor(id,command,timeout=30000) {
  const s=await readSession(id);
  return new Promise((resolve,reject)=>{
    const socket=net.connect(`\\\\.\\pipe\\${s.pipeName}`);let data='',done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('Editor request timed out. Re-inspect state before retrying a write.')),timeout);
    socket.setEncoding('utf8');socket.on('error',e=>finish(e));
    socket.on('connect',()=>socket.write(JSON.stringify({token:s.token,command})+'\n'));
    socket.on('data',chunk=>{data+=chunk;if(data.length>64*1024*1024){finish(new Error('Editor response exceeds limit.'));return;}if(data.includes('\n'))try{const r=JSON.parse(data.slice(0,data.indexOf('\n')));r.ok?finish(null,r.result):finish(new Error(r.error));}catch(e){finish(e);}});
    socket.on('end',()=>{if(!done)finish(new Error('Editor disconnected before acknowledging the request.'));});
  });
}
export async function listSessions() {
  const files=await fs.readdir(sessionDirectory()).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const sessions=[];
  for(const file of files.filter(f=>/^[a-f0-9]{32}\.json$/.test(f))) {
    const id=file.slice(0,-5);
    try {const state=await requestEditor(id,{action:'get_editor_state'},2000);sessions.push({sessionId:id,...state});}catch{/* Closed or loading editor: never guess a substitute. */}
  }
  return sessions;
}
