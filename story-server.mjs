import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

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

export function validateStory(value){
 const strings=(items,min,max)=>Array.isArray(items)&&items.length>=min&&items.length<=max&&
 items.every(s=>typeof s==='string'&&s.trim()&&s.length<=2000);
 if(!value||!strings(value.narration,2,3)||!Array.isArray(value.dialogue)||value.dialogue.length>3||
 !value.dialogue.every(d=>d&&['Arohi','Naina'].includes(d.character)&&typeof d.text==='string'&&d.text.trim()&&d.text.length<=2000)||
 !strings(value.suggested_replies,3,3)||new Set(value.suggested_replies.map(s=>s.trim().toLowerCase())).size!==3){
 throw Error('The model returned an incomplete scene. It was not added to the story.');
 }
 const visible=[...value.narration,...value.dialogue.map(d=>d.text)].join(' ');
 if(/local demo|system prompt|api key|connect.*gemma|gemma.*connect/i.test(visible))throw Error('The model put setup instructions inside the story. The reply was rejected.');
 return {narration:value.narration,dialogue:value.dialogue.map(d=>({character:d.character,text:d.text})),suggested_replies:value.suggested_replies};
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
export function createDemoServer({settings=config(),fetcher=fetch,port=8789,publicOrigin}={}){
 const origin=publicOrigin||'http://127.0.0.1:'+port;
 const expectedHost=new URL(origin).host;
 let busy=false;
 return http.createServer(async(req,res)=>{
 let telemetry=null,ownsRequest=false;
 try{
 if(req.headers.host!==expectedHost)return reply(res,403,{error:'Open '+origin});
 if(req.method==='GET'&&req.url==='/'){
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
 'Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
 res.end(await readFile(page));return;
 }
 if(req.method==='GET'&&req.url==='/api/status')return reply(res,200,{configured:Boolean(settings.key),model:settings.model,provider:settings.provider,
 error:settings.key?null:'Set '+(settings.provider==='openrouter'?'OPENROUTER_API_KEY':'DEEPINFRA_API_KEY')+' to a funded test key in PowerShell, then restart this demo.'});
 if(req.method!=='POST'||req.url!=='/api/story')return reply(res,404,{error:'Page not found.'});
 if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return reply(res,403,{error:'Use the demo page at '+origin});
 if(!settings.key)return reply(res,503,{error:'A funded provider key is required. Set it in PowerShell and restart the demo.'});
 if(busy)return reply(res,429,{error:'A story request is already running. Wait for it to finish.'});
 const pieces=[];let size=0;
 for await(const piece of req){size+=piece.length;if(size>500000)return reply(res,413,{error:'Conversation too large. Export it before restarting.'});pieces.push(piece);}
 let messages;
 try{messages=validateHistory(JSON.parse(Buffer.concat(pieces).toString('utf8')).messages);}
 catch(error){return reply(res,400,{error:error.message});}
 // Recheck after reading the body to prevent two simultaneous uploads acquiring the lock.
 if(busy)return reply(res,429,{error:'A story request is already running.'});
 busy=true;ownsRequest=true;
 const started=Date.now();
 const response=await fetcher(settings.endpoint,{method:'POST',headers:{Authorization:'Bearer '+settings.key,'Content-Type':'application/json'},
 body:JSON.stringify({model:settings.model,messages:[{role:'system',content:prompt},...messages],max_tokens:1100,temperature:0.65,
 stream:true,stream_options:{include_usage:true}}),signal:AbortSignal.timeout(120000),redirect:'error'});
 if(!response.ok){
 await response.body?.cancel();
 const errors={401:'The provider rejected this API key.',402:'This provider account needs credits or active billing.',429:'Provider rate limit reached. Wait before retrying.',404:'The provider could not find the configured 26B model. Confirm the model ID with Akash.'};
 return reply(res,response.status,{error:errors[response.status]||'Provider returned HTTP '+response.status+'. No automatic retry was made.'});
 }
 const result=await readProvider(response.body,started);
 const providerCost=result.usage?.cost;
 telemetry={configured_model:settings.model,reported_model:result.reportedModel,provider:settings.provider,
 usage:result.usage,usage_source:result.usage?'provider':'unavailable',
 cost_usd:typeof providerCost==='number'&&Number.isFinite(providerCost)?providerCost:null,
 cost_source:typeof providerCost==='number'&&Number.isFinite(providerCost)?'provider':'unavailable',
 first_token_ms:result.firstToken,total_duration_ms:Date.now()-started};
 if(result.reportedModel&&result.reportedModel.toLowerCase()!==settings.model.toLowerCase())return reply(res,502,{error:'The provider reported a different model. Review the configuration before continuing.',telemetry});
 if(!result.done||result.finishReason!=='stop')return reply(res,502,{error:'The provider did not complete the scene normally. Usage may still have been charged.',telemetry});
 let content=result.text.trim();
 if(content.startsWith('```'))content=content.slice(3).replace(/^json\s*/i,'').replace(/```\s*$/,'').trim();
 let story;
 try{story=validateStory(JSON.parse(content));}catch(error){return reply(res,502,{error:error instanceof SyntaxError?'The model returned invalid JSON. Your message is kept for retry.':error.message,telemetry});}
 return reply(res,200,{story,configured_model:settings.model,model:result.reportedModel,telemetry});
 }catch(error){
 reply(res,502,{error:error.name==='TimeoutError'?'The model timed out. Your message is kept; usage may still have been charged.':'Could not complete the model request. Your message is kept for retry.',telemetry});
 }finally{if(ownsRequest)busy=false;}
 });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const settings=config();const server=createDemoServer({settings});
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port 8789 is in use. Stop the previous demo with Ctrl+C.':error.message);process.exitCode=1;});
 server.listen(8789,'127.0.0.1',()=>{
 console.log('Kal Phir Miloge? Standalone demo: http://127.0.0.1:8789/');
 console.log('Provider: '+settings.provider+' | Configured model: '+settings.model);
 console.log(settings.key?'Key is configured; billing and generation are checked on your first send.':'Missing funded API key. See START-HERE.txt.');
 console.log('No Convico application endpoint is called. Ctrl+C stops this demo.');
 });
}
