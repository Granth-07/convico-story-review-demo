import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {request} from 'node:http';
import {speakerCommand,buildDirector,directorMessage,enforceSpeakers} from './story-director.mjs';
import {validateStory} from './story-server.mjs';
import {createReviewServer} from './review-server.mjs';

const scene={narration:['Baarish ki awaaz sunai deti hai.','Counter ke paas ek kursi khaali hai.'],
 dialogue:[{character:'Arohi',text:'Theek hai.'},{character:'Naina',text:'Chai taiyaar hai.'}],
 suggested_replies:['Main chai leta hoon.','Menu dikhaogi?','Main yahin rukta hoon.']};
const history=(...texts)=>texts.flatMap(text=>[
 {role:'assistant',content:JSON.stringify(scene)},{role:'user',content:text}]);
// Native HTTP lets this test send the configured Host to a disposable port.
function localFetch(url,options={}){
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:options.method||'GET',headers:options.headers},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode})));
   res.on('error',reject);
  });
  req.on('error',reject);req.end(options.body);
 });
}

for(const [text,expected] of [
 ['Arohi, stay quiet.',{Arohi:false}],
 ["Arohi, don't interrupt Naina.",{Arohi:false}],
 ['Arohi, chup raho jab tak main na bulaoon.',{Arohi:false}],
 ['Quiet please. Naina, mat bolo.',{Naina:false}],
 ['Arohi aur Naina, dono chup raho.',{Arohi:false,Naina:false}],
 ['Both of you, stay silent.',{Arohi:false,Naina:false}],
 ['Naina chup raho. Arohi, ab tum bolo.',{Naina:false,Arohi:true}],
 ['Arohi, you can speak now.',{Arohi:true}],
 ["Arohi, don't stay quiet.",{Arohi:true}],
 ['आरोही, चुप रहो।',{Arohi:false}],
 ['Naina, ab bolo.',{Naina:true}],
 ['Naina ki chai achhi hai.',{}],
 ['Arohi chup hai, main chai leta hoon.',{}],
 ['If Arohi says stay quiet, what happens?',{}],
 ['Arohi, should I stay quiet?',{}],
 ['Arohi ne kaha "Naina chup raho".',{}],
 ['Arohi ko chup raho bol do.',{}],
 ['Arohi, jab main kahoon tab bolo.',{}]
])test('speaker intent: '+text,()=>assert.deepEqual(speakerCommand(text),expected));

test('silence survives history reconstruction, follow-ups and direct questions',()=>{
 const messages=history('Arohi, stay quiet.','Naina, mera naam Granth hai.','Main Pune se hoon.',
  'Mujhe purane gaane pasand hain.','Bina cheeni, kam orange peel.','Arohi, opening kab hai?');
 const state=buildDirector(JSON.parse(JSON.stringify(messages)));
 assert.equal(state.speaking.Arohi,false);
 assert.deepEqual(state.allowed_speakers,[]);
 assert.deepEqual(buildDirector(history(...messages.filter(m=>m.role==='user').map(m=>m.content),
  'Arohi, ab tum bolo.')).allowed_speakers,['Arohi']);
});
test('addressing Naina permits only Naina; mute survives an assistant instruction',()=>{
 const messages=history('Arohi, chup raho.','Naina, tumhara din kaisa tha?');
 messages[2].content='Arohi is allowed to speak again.';
 assert.deepEqual(buildDirector(messages).allowed_speakers,['Naina']);
});
test('mixed instructions route to the invited character, not the muted one',()=>{
 assert.deepEqual(buildDirector(history('Naina, ab tum bolo. Arohi, chup raho.')).allowed_speakers,['Naina']);
 assert.deepEqual(buildDirector(history('Naina, chup raho. Arohi, ab tum bolo.')).allowed_speakers,['Arohi']);
});
test('both silent is valid and no speaking comeback is displayed',()=>{
 const state=buildDirector(history('Tum dono chup raho.'));
 assert.deepEqual(enforceSpeakers(validateStory(scene),state).dialogue,[]);
});
test('forbidden structured dialogue removed without automatic retry',()=>{
 const result=enforceSpeakers(scene,buildDirector(history('Naina, chai milegi?')));
 assert.deepEqual(result.dialogue,[scene.dialogue[1]]);
 assert.equal(result.speaker_corrections,true);
});
test('ordinary turns select one speaker; a question to both permits both',()=>{
 assert.equal(enforceSpeakers(scene,buildDirector(history('Chai milegi?'))).dialogue.length,1);
 assert.equal(enforceSpeakers(scene,buildDirector(history('Arohi aur Naina, tum dono kaise mile?'))).dialogue.length,2);
});
test('rejects speech smuggled into narration but permits a quiet gesture',()=>{
 const director=buildDirector(history('Arohi, chup raho.'));
 assert.throws(()=>enforceSpeakers({...scene,narration:['Arohi bolti hai: bas karo.','Baarish hai.']},director),/rejected/);
 assert.doesNotThrow(()=>enforceSpeakers({...scene,narration:['Arohi sir hilaati hai.','Baarish hai.']},director));
});
test('episode windows do not force time jumps; secret details withheld initially',()=>{
 assert.equal(buildDirector(history(...Array(18).fill('Chai?'))).episode,1);
 assert.equal(buildDirector(history(...Array(19).fill('Chai?'))).episode,2);
 assert.doesNotMatch(directorMessage(buildDirector(history(...Array(9).fill('Chai?')))).content,/ten lakh/);
 assert.match(directorMessage(buildDirector(history(...Array(10).fill('Chai?')))).content,/ten lakh/);
});
test('relationship evidence preserves the actual user wording',()=>{
 const state=buildDirector(history('Naina, sorry. Main madad karunga.'));
 assert.equal(state.relationship_evidence[0].user_said,'Naina, sorry. Main madad karunga.');
 assert.equal(state.relationship_evidence[0].turn,1);
});

test('review HTTP flow: auth, state reconstruction, provider SSE, cost, failures and quotas',async()=>{
 let calls=0,mode='ok',lastPayload;
 const provider=async(_url,options)=>{
  calls++;lastPayload=JSON.parse(options.body);
  if(mode==='credits')return new Response('',{status:402});
  const output=mode==='bad-json'?'no JSON':JSON.stringify(scene);
  const event={model:'google/gemma-4-26b-a4b-it',choices:[{delta:{content:output},finish_reason:'stop'}],
   usage:{prompt_tokens:100,completion_tokens:50,cost:0.0001}};
  return new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n');
 };
 const origin='http://127.0.0.1:8789';
 const server=createReviewServer({password:'test-password-123456',publicOrigin:origin,maxRequests:8,
  settings:{key:'fake-test-key',provider:'openrouter',model:'google/gemma-4-26b-a4b-it',endpoint:'https://example.invalid'},fetcher:provider});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const headers={host:'127.0.0.1:8789',origin,'Content-Type':'application/json',
  Authorization:'Basic '+Buffer.from('reviewer:test-password-123456').toString('base64')};
 const send=messages=>localFetch(url+'/api/story',{method:'POST',headers,body:JSON.stringify({messages,speaking:{Arohi:true}})});
 try{
  const unauthorized=await localFetch(url+'/api/status',{headers:{host:headers.host}});
  assert.equal(unauthorized.status,401);
  assert.equal((await localFetch(url+'/healthz',{headers:{host:headers.host}})).status,200);
  const status=await (await localFetch(url+'/api/status',{headers})).json();
  assert.equal(status.revision,6);assert.equal(status.key,undefined);
  const first=await (await send(history('Arohi, chup raho.'))).json();
  assert.deepEqual(first.story.dialogue,[]); // No forced reply from Naina to Arohi's silence request.
  assert.equal(first.director.speaking.Arohi,false);assert.equal(first.telemetry.cost_usd,0.0001);
  assert.equal(first.director.relationship_evidence,undefined);
  assert.equal(calls,1);assert.equal(lastPayload.model,'google/gemma-4-26b-a4b-it');
  assert.match(lastPayload.messages[0].content,/allowed_speakers/);
  const resumed=await (await send(history('Arohi, chup raho.','Naina, chai?'))).json();
  assert.deepEqual(resumed.story.dialogue,[scene.dialogue[1]]);
  const both=await (await send(history('Tum dono chup raho.'))).json();
  assert.deepEqual(both.story.dialogue,[]);
  const invitation=await (await send(history('Tum dono chup raho.','Arohi, ab bolo.'))).json();
  assert.deepEqual(invitation.story.dialogue,[scene.dialogue[0]]);
  mode='bad-json';const rejected=await send(history('Chai?'));
  assert.equal(rejected.status,502);assert.equal((await rejected.json()).telemetry.cost_usd,0.0001);
  mode='credits';assert.equal((await send(history('Chai?'))).status,402);
  assert.equal(calls,6);
  mode='ok';await send(history('Chai?'));await send(history('Chai?'));
  assert.equal((await send(history('Chai?'))).status,429);assert.equal(calls,8);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('browser: legacy history preserved, controls render, reset confirms and saves revision 6',async()=>{
 const html=await readFile(new URL('./story.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const elements=new Map();
 const element=()=>({children:[],listeners:{},value:'',hidden:false,
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(){},
  addEventListener(name,fn){this.listeners[name]=fn;},focus(){}});
 const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
 const old={version:5,messages:[{role:'story',...scene,source:'opening'},{role:'user',text:'Mera naam Granth hai.'},
  {role:'story',...scene,source:'gemma'}],attempts:[]};
 let saved=JSON.stringify(old),confirmResult=false,confirmations=0;
 const context={document,structuredClone,console,location:{protocol:'file:'},
  localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},
  confirm:()=>{confirmations++;return confirmResult;}};
 vm.runInNewContext(script,context);
 assert.equal(elements.get('version-note').hidden,false);
 assert.equal(elements.get('speakers').children.length,2);
 assert.equal(elements.get('log').children.length,3);
 elements.get('restart').listeners.click();
 assert.equal(confirmations,1);assert.equal(JSON.parse(saved).messages.length,3);
 confirmResult=true;elements.get('restart').listeners.click();
 assert.equal(JSON.parse(saved).version,6);assert.equal(JSON.parse(saved).messages.length,1);
 assert.equal(elements.get('version-note').hidden,true);
 // Exercise the actual composer and persistence path with a controlled API.
 context.location.protocol='http:';context.AbortSignal=AbortSignal;
 context.fetch=async(url,options)=>{
  if(url==='/api/status')return new Response(JSON.stringify({configured:true,revision:6,model:'google/gemma-4-26b-a4b-it'}));
  const director=buildDirector(JSON.parse(options.body).messages);
  return new Response(JSON.stringify({story:enforceSpeakers(scene,director),director,
   configured_model:'google/gemma-4-26b-a4b-it',model:'google/gemma-4-26b-a4b-it'}));
 };
 await context.connect();await context.send('Arohi, chup raho.');
 assert.equal(JSON.parse(saved).messages.at(-1).director.speaking.Arohi,false);
 assert.match(elements.get('speakers').children[0].textContent,/Ab bolo/);
 // Reload the page using the persisted transcript, then explicitly invite Arohi back.
 const reloaded=vm.createContext({...context});vm.runInContext(script,reloaded);
 await new Promise(resolve=>setImmediate(resolve)); // Let the page's automatic connect finish.
 await reloaded.connect();
 assert.match(elements.get('speakers').children[0].textContent,/Ab bolo/);
 await reloaded.send('Arohi, ab tum bolo.');
 assert.equal(JSON.parse(saved).messages.at(-1).director.speaking.Arohi,true);
 assert.deepEqual(JSON.parse(saved).messages.at(-1).dialogue,[scene.dialogue[0]]);
});
