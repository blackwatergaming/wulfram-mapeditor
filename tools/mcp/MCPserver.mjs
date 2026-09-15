import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {listSessions,requestEditor} from './editor-client.mjs';
import {createMapArchive} from '../../lib/map-package.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'outputs','mcp-exports');
const sessionId=z.string().regex(/^[a-f0-9]{32}$/),expectedRevision=z.string().min(1);
const server=new McpServer({name:'wulfram-forge',version:'0.1.0'});
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function register(name,description,inputSchema,readOnly,handler){server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}},async args=>{try{return await handler(args);}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});}
register('list_editor_sessions','List MCP-enabled local Wulfram Forge editors. Select an explicit session ID for subsequent tools.',{},true,async()=>text({sessions:await listSessions()}));
for(const action of ['get_editor_state','inspect_map','validate_map'])register(action,`${action}: read the selected live editor. Inspect returns entity IDs and world-unit coordinates.`,{sessionId},true,async a=>text(await requestEditor(a.sessionId,{action})));
register('edit_entities','Atomically add, move or remove ground structures. Coordinates are absolute world units; yaw is radians. mirror:true resolves the unique rotational opponent and applies the opposite transform. New validation errors reject the whole batch. One undo step.',{sessionId,expectedRevision,edits:z.array(z.object({operation:z.enum(['add','move','remove']),id:z.string().optional(),token:z.string().optional(),subtype:z.string().optional(),team:z.number().int().min(1).max(2).optional(),x:z.number().finite().optional(),y:z.number().finite().optional(),yaw:z.number().finite().optional(),mirror:z.boolean().optional()}).strict()).min(1).max(128)},false,async({sessionId,...command})=>text(await requestEditor(sessionId,{action:'edit_entities',...command})));
register('edit_terrain','Apply one circular terrain brush, optionally rotationally mirrored. Radius/coordinates/heights use world units. Raise/lower value is a nonnegative amount; flatten value is target elevation. Resnaps ground structures and rejects new validation errors. One undo step.',{sessionId,expectedRevision,brush:z.object({operation:z.enum(['raise','lower','flatten','smooth','texture']),x:z.number().finite(),y:z.number().finite(),radius:z.number().positive(),value:z.number().finite().optional(),texture:z.string().optional(),mirror:z.boolean().optional()}).strict()},false,async({sessionId,...command})=>text(await requestEditor(sessionId,{action:'edit_terrain',...command})));
register('undo','Undo the selected editor’s last change, including manual changes. Inspect state first; requires current revision.',{sessionId,expectedRevision},false,async({sessionId,...command})=>text(await requestEditor(sessionId,{action:'undo',...command})));
register('capture_view','Capture the actual current editor viewport and interface as PNG. Does not move the camera.',{sessionId},true,async a=>{const r=await requestEditor(a.sessionId,{action:'capture_view'});return {content:[{type:'image',mimeType:r.mimeType,data:r.data}]};});
for(const action of ['save_copy','export_map'])register(action,`${action==='save_copy'?'Save a JSON copy':'Export a map ZIP'} of the exact live revision to a NEW file under outputs/mcp-exports. Does not overwrite files or mark the editor saved.`,{sessionId,expectedRevision,name:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)},false,async a=>{
  const snapshot=await requestEditor(a.sessionId,{action:'get_snapshot',expectedRevision:a.expectedRevision});
  const bytes=action==='save_copy'?Buffer.from(JSON.stringify(snapshot.project)):Buffer.from(await createMapArchive(snapshot.project));
  await fs.mkdir(output,{recursive:true});const file=path.join(output,`${a.name}.${action==='save_copy'?'json':'zip'}`);
  await fs.writeFile(file,bytes,{flag:'wx'});
  return text({path:file,revision:snapshot.revision,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
});
await server.connect(new StdioServerTransport());
