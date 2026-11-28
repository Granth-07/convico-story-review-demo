import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildDirector,directorMessage,enforceSpeakers,placeCharacterActions,revision} from './story-director.mjs';
import {canonicalCharacter} from './story-world.mjs';
import {trainPack} from './train-engine.mjs';

const page=new URL('./story.html',import.meta.url);
const prompt=await readFile(new URL('./story-prompt.txt',import.meta.url),'utf8');
const modelFamily='google/gemma-4-26b-a4b-it';

export function config(env=process.env){
 const provider=(env.DEMO_PROVIDER||'openrouter').toLowerCase();
 if(!['openrouter','deepinfra'].includes(provider))throw Error('DEMO_PROVIDER must be openrouter or deepinfra.');
 const model=env.DEMO_MODEL||(provider==='deepinfra'?'google/gemma-4-26B-A4B-it':modelFamily);
 if(model.toLowerCase()!==modelFamily)throw Error('This demo is configured for the requested Gemma 26B model only.');
 return {provider,model,key:(provider==='openrouter'?env.OPENROUTER_API_KEY:env.DEEPINFRA_API_KEY)?.trim()||'',
 endpoint:provider==='openrouter'?'https://openrouter.ai/api/v1/chat/completions':'https://api.deepinfra.com/v1/openai/chat/completions'};
}

export function validateStory(value,{canonical=canonicalCharacter,checkBoundary=true}={}){
 const strings=(items,min,max)=>Array.isArray(items)&&items.length>=min&&items.length<=max&&
 items.every(s=>typeof s==='string'&&s.trim()&&s.length<=2000);
 if(!value||!strings(value.narration,0,6)||!Array.isArray(value.dialogue)||value.dialogue.length>8||
 !value.dialogue.every(d=>d&&typeof d.character==='string'&&d.character.trim()&&d.character.length<=80&&typeof d.text==='string'&&d.text.trim()&&d.text.length<=2000&&
 (d.actions===undefined||strings(d.actions,0,3)))||
 (value.character_actions!==undefined&&(!Array.isArray(value.character_actions)||value.character_actions.length>8||
 !value.character_actions.every(a=>a&&typeof a.character==='string'&&typeof a.text==='string'&&a.text.trim()&&a.text.length<=2000)))||
 !strings(value.suggested_replies,1,3)){
 throw Error('The model returned an incomplete scene. It was not added to the story.');
 }
 const visible=[...value.narration,...value.dialogue.flatMap(d=>[d.text,...(d.actions||[])]),...(value.character_actions||[]).map(a=>a.text),
 typeof value.episode_hook==='string'?value.episode_hook:''].join(' ');
 if(checkBoundary&&/local demo|system prompt|api key|connect.*gemma|gemma.*connect/i.test(visible))throw Error('The model put setup instructions inside the story. The reply was rejected.');
 const suggestions=[...new Set(value.suggested_replies.map(s=>s.trim()))];
 for(const option of ['Main agla pal dekhta hoon.','Main poochta hoon ki ab kya hoga.','Main thoda waqt leta hoon.'])if(suggestions.length<3&&!suggestions.includes(option))suggestions.push(option);
 const dialogue=value.dialogue.map(d=>({character:canonical(d.character),text:d.text,actions:d.actions||[]})).filter(d=>d.character);
 const actions=(value.character_actions||[]).map(a=>({character:canonical(a.character),text:a.text})).filter(a=>a.character);
 if(!value.narration.length&&!dialogue.length&&!actions.length)throw Error('No valid scene content was returned. Your draft is kept.');
 return {narration:value.narration,dialogue,character_actions:actions,suggested_replies:suggestions,
  episode_hook:typeof value.episode_hook==='string'?value.episode_hook.slice(0,350):null};
}

export function validateHistory(messages){
 if(!Array.isArray(messages)||messages.length<2||messages.length>120||messages.length%2!==0||
 !messages.every((m,i)=>m&&m.role===(i%2===0?'assistant':'user')&&typeof m.content==='string'&&m.content.trim()&&m.content.length<=12000)||
 messages.reduce((sum,m)=>sum+m.content.length,0)>60000||messages.at(-1).content.length>1500){
 throw Error('Invalid history or pilot context limit reached. Export your chat before starting a new story.');
 }
 return messages.map(m=>({role:m.role,content:m.content}));
}

// Parse the provider's token stream once. Never combine token events with display bubbles.
export async function readProvider(stream,started){
 const reader=stream.getReader(),decoder=new TextDecoder();
 let pending='',text='',usage=null,reportedModel=null,finishReason=null,done=false,firstToken=null;
 function line(value){
 if(!value.startsWith('data:'))return;
 const raw=value.slice(5).trim();if(!raw)return;
 if(raw==='[DONE]'){done=true;return;}
 const data=JSON.parse(raw);
 if(data.error)throw Error('The provider reported a streaming error. Usage may still have been charged.');
 reportedModel=data.model||reportedModel;
 usage=data.usage||usage;
 for(const choice of data.choices||[]){
 finishReason=choice.finish_reason||finishReason;
 const fragment=choice.delta?.content;
 if(typeof fragment==='string'&&fragment){
 if(firstToken===null)firstToken=Date.now()-started;
 text+=fragment;if(text.length>30000)throw Error('The provider response exceeded the demo limit.');
 }
 }
 }
 try{
 while(true){
 const chunk=await reader.read();if(chunk.done)break;
 pending+=decoder.decode(chunk.value,{stream:true});
 let end;
 while((end=pending.indexOf('\n'))!==-1){line(pending.slice(0,end).replace(/\r$/,''));pending=pending.slice(end+1);}
 }
 pending+=decoder.decode();if(pending.trim())line(pending.replace(/\r$/,''));
 }finally{reader.releaseLock();}
 return {text,usage,reportedModel,finishReason,done,firstToken};
}

function reply(res,code,data){
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(JSON.stringify(data));
}
export function createDemoServer({settings=config(),fetcher=fetch,port=8789,publicOrigin,reserveRequest=()=>true,requestTimeoutMs=120000,storyPack=null,workGate}={}){
 const origin=publicOrigin||'http://127.0.0.1:'+port;
 const expectedHost=new URL(origin).host;
 const gate=workGate||{busy:false};
 const engine=storyPack||{buildDirector,directorMessage,enforceSpeakers,placeCharacterActions};
 const requests=new Map();
 return http.createServer(async(req,res)=>{
 let telemetry=null,ownsRequest=false,job=null;
 const respond=(code,data)=>{
  if(job&&!job.completed){job.completed=true;job.result={code,data};job.resolve(job.result);}
  if(!res.writableEnded&&!res.destroyed)reply(res,code,data);
 };
 try{
 if(req.headers.host!==expectedHost)return respond(403,{error:'Open '+origin});
 if(req.method==='GET'&&req.url==='/'){
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
 const profile=JSON.stringify(storyPack?.publicProfile||null).replace(/</g,'\\u003c');
 res.end((await readFile(page,'utf8')).replace('/*__STORY_PROFILE__*/ null',profile));return;
 }
 if(req.method==='GET'&&req.url==='/api/status')return respond(200,{revision:storyPack?.revision||revision,story:storyPack?.id||'cafe',configured:Boolean(settings.key),model:settings.model,provider:settings.provider,
 error:settings.key?null:'Set '+(settings.provider==='openrouter'?'OPENROUTER_API_KEY':'DEEPINFRA_API_KEY')+' to a funded test key in PowerShell, then restart this demo.'});
 if(req.method!=='POST'||req.url!=='/api/story')return respond(404,{error:'Page not found.'});
 if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return respond(403,{error:'Use the demo page at '+origin});
 if(!settings.key)return respond(503,{error:'A funded provider key is required. Set it in PowerShell and restart the demo.'});
 const pieces=[];let size=0;
 for await(const piece of req){size+=piece.length;if(size>500000)return respond(413,{error:'Conversation too large. Export it before restarting.'});pieces.push(piece);}
 let messages,requestId;
 try{
  const input=JSON.parse(Buffer.concat(pieces).toString('utf8'));
  messages=validateHistory(input.messages);requestId=input.request_id;
  if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)))throw Error('Invalid request identifier.');
 }
 catch(error){return respond(400,{error:error.message});}
 const digest=createHash('sha256').update(JSON.stringify(messages)).digest('hex');
 for(const [id,entry] of requests)if(entry.completed&&Date.now()-entry.created>15*60000)requests.delete(id);
 if(requestId&&requests.has(requestId)){
  const existing=requests.get(requestId);
  if(existing.digest!==digest)return respond(409,{error:'This request identifier belongs to another message. Edit the draft and send again.'});
  const result=existing.result||await existing.promise;
  return respond(result.code,{...result.data,replayed:true});
 }
 // Recheck after reading the body to prevent two simultaneous uploads acquiring the lock.
 if(gate.busy)return respond(429,{error:'A story request is already running. Your draft is kept; retry when it finishes.'});
 if(!reserveRequest())return respond(429,{error:'This review instance reached its model request limit. Contact Granth.'});
 if(requestId){
  while(requests.size>=128){const oldest=[...requests].find(([,entry])=>entry.completed);if(!oldest)break;requests.delete(oldest[0]);}
  job={digest,created:Date.now(),completed:false};job.promise=new Promise(resolve=>{job.resolve=resolve;});requests.set(requestId,job);
 }
 gate.busy=true;ownsRequest=true;
 const director=engine.buildDirector(messages);
 const started=Date.now();
 const generation=storyPack?.requestOptions?.(director,settings)||{max_tokens:1100,temperature:0.65};
 const response=await fetcher(settings.endpoint,{method:'POST',headers:{Authorization:'Bearer '+settings.key,'Content-Type':'application/json'},
 body:JSON.stringify({model:settings.model,...generation,messages:[{role:'system',content:(storyPack?.prompt||prompt)+'\n\n'+engine.directorMessage(director).content},...messages],
 stream:true,stream_options:{include_usage:true}}),signal:AbortSignal.timeout(requestTimeoutMs),redirect:'error'});
 if(!response.ok){
 await response.body?.cancel();
 const errors={401:'The provider rejected this API key.',402:'This provider account needs credits or active billing.',429:'Provider rate limit reached. Wait before retrying.',404:'The provider could not find the configured 26B model. Confirm the model ID with Akash.'};
 return respond(response.status,{error:errors[response.status]||'Provider returned HTTP '+response.status+'. No automatic retry was made.'});
 }
 const result=await readProvider(response.body,started);
 const providerCost=result.usage?.cost;
 telemetry={configured_model:settings.model,reported_model:result.reportedModel,provider:settings.provider,
 usage:result.usage,usage_source:result.usage?'provider':'unavailable',
 cost_usd:typeof providerCost==='number'&&Number.isFinite(providerCost)?providerCost:null,
 cost_source:typeof providerCost==='number'&&Number.isFinite(providerCost)?'provider':'unavailable',
 first_token_ms:result.firstToken,total_duration_ms:Date.now()-started};
 if(result.reportedModel&&result.reportedModel.toLowerCase()!==settings.model.toLowerCase())return respond(502,{error:'The provider reported a different model. Review the configuration before continuing.',telemetry});
 if(!result.done||result.finishReason!=='stop')return respond(502,{error:'The provider did not complete the scene normally. Usage may still have been charged.',telemetry});
 let story,recovery=null,immersionCorrected=false;
 try{
  let parsed;
  if(engine.parseScene)parsed=engine.parseScene(result.text);
  else{
   let content=result.text.trim();
   if(content.startsWith('```'))content=content.slice(3).replace(/^json\s*/i,'').replace(/```\s*$/,'').trim();
   parsed={value:JSON.parse(content),repaired:false};
  }
  story=validateStory(parsed.value,{canonical:storyPack?.canonical||canonicalCharacter,checkBoundary:!engine.protectScene});
  if(parsed.repaired)recovery={kind:'local_format_repair',extra_model_calls:0};
 }catch(error){
  const grounded=storyPack?.recoverScene?.(director,messages);
  if(!grounded){
   if(!engine.parseScene)return respond(502,{error:error instanceof SyntaxError?'The model returned invalid JSON. Your message is kept for retry.':error.message,telemetry});
   return respond(502,{code:'scene_format',error:'Is baar jawab theek se taiyaar nahi ho paaya. Tumhara message draft mein safe hai; dobara bhej sakte ho.',
    diagnostic:error instanceof SyntaxError?'invalid_json':'invalid_scene_shape',telemetry});
  }
  story=validateStory(grounded,{canonical:storyPack.canonical});
  recovery={kind:'grounded_inspection',extra_model_calls:0};
 }
 if(engine.protectScene){const protectedScene=engine.protectScene(story);story=protectedScene.story;immersionCorrected=protectedScene.corrected;}
 story=engine.placeCharacterActions(engine.enforceSpeakers(story,director));
 if(director.episode_turn===18)story.episode_end={episode:director.episode,
  hook:story.episode_hook||'Yahin ek viraam. Agle episode mein isi kahani ko aage badha sakte ho.'};
 // Return public controls only; private director/backstory notes stay on the server.
 return respond(200,{story,...(engine.parseScene?{recovery,quality:{immersion_corrected:immersionCorrected}}:{}),story_id:storyPack?.id||'cafe',director:{revision:director.revision,turn:director.turn,episode:director.episode,episode_turn:director.episode_turn,speaking:director.speaking,phase:director.world.phase,
  ...(storyPack?.publicDirector?.(director)||{})},configured_model:settings.model,model:result.reportedModel,telemetry});
 }catch(error){
 respond(502,{error:error.name==='TimeoutError'?'The model timed out. Your message is kept; usage may still have been charged.':'Could not complete the model request. Your message is kept for retry.',telemetry});
 }finally{if(ownsRequest)gate.busy=false;}
 });
}

export function createStoryCollection(options={}){
 const workGate={busy:false};
 const cafe=createDemoServer({...options,workGate});
 const train=createDemoServer({...options,workGate,storyPack:trainPack});
 return http.createServer((req,res)=>{
  if(req.url==='/last-train'){res.writeHead(302,{Location:'/last-train/'});res.end();return;}
  if(req.url.startsWith('/last-train/')){req.url=req.url.slice('/last-train'.length);train.emit('request',req,res);}
  else cafe.emit('request',req,res);
 });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const settings=config();const server=createStoryCollection({settings});
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port 8789 is in use. Stop the previous demo with Ctrl+C.':error.message);process.exitCode=1;});
 server.listen(8789,'127.0.0.1',()=>{
 console.log('Kal Phir Miloge? Standalone demo: http://127.0.0.1:8789/');
 console.log('The Last Train: http://127.0.0.1:8789/last-train/');
 console.log('Provider: '+settings.provider+' | Configured model: '+settings.model);
 console.log(settings.key?'Key is configured; billing and generation are checked on your first send.':'Missing funded API key. See START-HERE.txt.');
 console.log('No Convico application endpoint is called. Ctrl+C stops this demo.');
 });
}
