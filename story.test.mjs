import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {speakerCommand,buildDirector,directorMessage,enforceSpeakers,placeCharacterActions} from './story-director.mjs';
import {validateStory,createDemoServer} from './story-server.mjs';
import {buildWorld,worldPolicy,ensureWorldBeats} from './story-world.mjs';
import {createReviewServer} from './review-server.mjs';

const scene={narration:['Baarish ki awaaz sunai deti hai.','Counter ke paas ek kursi khaali hai.'],
 dialogue:[{character:'Arohi',text:'Theek hai.',actions:[]},{character:'Naina',text:'Chai taiyaar hai.',actions:[]}],
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
test('removes speech smuggled into narration without rejecting the send',()=>{
 const director=buildDirector(history('Arohi, chup raho.'));
 assert.deepEqual(enforceSpeakers({...scene,narration:['Arohi bolti hai: bas karo.','Baarish hai.']},director).narration,['Baarish hai.']);
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

test('serious injury dispatches both kinds of help and retains the event after a joke',()=>{
 const first=buildWorld(history('Ek customer ka sir fod diya.'));
 assert.equal(first.phase,'call_for_help');assert.equal(first.police_requested,true);assert.equal(first.medical_requested,true);
 assert.deepEqual(first.required_speakers,['Customer']);
 assert.equal(buildWorld(history('Ek customer ka sir fod diya.','Main rukta hoon.')).phase,'help_en_route');
 const later=buildWorld(history('Ek customer ka sir fod diya.','Voh maar gaya.','Meto mazak kr raha tha.','Cake aa gaya, surprise!'));
 assert.equal(later.phase,'responders_present');assert.ok(later.incident);
 assert.equal(later.police_present,true);assert.equal(later.medic_present,true);
 assert.ok(later.evidence.some(e=>e.kind==='claimed_retraction_not_resolution'));
});
for(const text of ['If I killed someone, what happens?','I did not kill anyone.','Movie mein usko maar diya.','Maine usko nahi maar diya.']){
 test('hypothetical/negated harm does not dispatch responders: '+text,()=>assert.equal(buildWorld(history(text)).incident,null));
}
test('an apparent death is not a medical finding; ambulance dismissal is removed',()=>{
 const world=buildWorld(history('Voh maar gaya.'));
 const result=ensureWorldBeats({...scene,dialogue:[{character:'Naina',text:'Ambulance nahi chahiye, sirf police.'}]},world);
 assert.ok(result.dialogue.some(d=>/police aur ambulance/.test(d.text)));
 assert.ok(!result.dialogue.some(d=>/Ambulance nahi/.test(d.text)));
 assert.equal(world.incident.reported.includes('not medically confirmed'),true);
});
test('responders have actual dialogue without the user explicitly asking them to speak',()=>{
 const messages=history('Ek customer ka sir fod diya.','Main control nahi kar paya.','Main abhi yahin hoon.');
 const result=enforceSpeakers(validateStory(scene),buildDirector(messages));
 assert.ok(result.dialogue.some(d=>d.character==='Police Officer'));
 assert.ok(result.dialogue.some(d=>d.character==='Paramedic'));
 assert.ok(result.world_corrections.includes('essential_response:Paramedic'));
});
test('doctor speaks in a medical setting, not as an unexplained cafe cameo',()=>{
 assert.ok(!buildDirector(history('Chai milegi?')).allowed_speakers.includes('Doctor'));
 const director=buildDirector(history('Ek customer ka sir fod diya.','Madad bulao.','Main rukta hoon.','Hospital mein doctor ko poochta hoon.'));
 assert.ok(director.allowed_speakers.includes('Doctor'));
 assert.ok(enforceSpeakers(scene,director).dialogue.some(d=>d.character==='Doctor'));
});
test('waiting for established officers produces police dialogue with legacy history',()=>{
 const messages=history('Police ko call kiya.','Lead the police officers inside the cafe.','Wait for the officers to ask what happened.');
 const validated=validateStory({...scene,dialogue:[{character:'police',text:'Aap batayein, yahan kya hua?',actions:['Officer andar aata hai.']}]});
 const result=enforceSpeakers(validated,buildDirector(messages));
 assert.equal(result.dialogue[0].character,'Police Officer');
 assert.match(result.dialogue[0].text,/kya hua/);
});
test('an explicit responder arrival is respected without an arbitrary extra two turns',()=>{
 for(const [text,role] of [['Police aa gaye.','Police Officer'],['Ambulance aa gayi.','Paramedic'],['Doctor aa gaye.','Doctor']]){
  const director=buildDirector(history(text));
  assert.ok(director.allowed_speakers.includes(role));
  assert.ok(enforceSpeakers(validateStory(scene),director).dialogue.some(d=>d.character===role));
 }
});
test('a directly addressed relevant supporting role can answer',()=>{
 const director=buildDirector(history('Friend, kaise ho?'));
 assert.ok(enforceSpeakers(validateStory(scene),director).dialogue.some(d=>d.character==='Friend'));
});
test('world matching rejects superhero and unrelated army dialogue',()=>{
 const result=enforceSpeakers(validateStory({...scene,dialogue:[
  {character:'Iron Man',text:'I am here.'},{character:'Army Officer',text:'Attack.'},{character:'Arohi',text:'Chai?'}]}),
 buildDirector(history('Iron Man aur Thanos ko bulao.')));
 assert.deepEqual(result.dialogue.map(d=>d.character),['Arohi']);
 assert.equal(buildWorld(history('Salman Khan ko cake cutting ke liye bulao.')).crossover_request,true);
 assert.ok(worldPolicy('mythology').roles.includes('Healer'));
 assert.ok(!worldPolicy('mythology').roles.includes('Police Officer'));
 assert.ok(!worldPolicy('horror').roles.includes('Iron Man'));
 const arrival=ensureWorldBeats({...scene,narration:['Iron Man cafe mein aa gaya.']},buildWorld(history('Iron Man ko bulao.')));
 assert.ok(!arrival.narration.some(t=>/Iron Man/.test(t)));
});
test('forced contact and a later party cannot manufacture forgiveness or a successful hug',()=>{
 const director=buildDirector(history('Ek customer ka sir fod diya.','Voh maar gaya.','Meto mazak kr raha tha.',
  'Forcefully hug her she will feel better.','Cake surprise aa gaya.','Arohi come hug me.'));
 assert.equal(director.world.trust,'boundaries_breached');
 const result=enforceSpeakers({...scene,narration:['Arohi hug karti hai, sab clapping karte hain.'],
  dialogue:[{character:'Arohi',text:'Sab dekh rahe hain, isliye hug karungi.'}]},director);
 assert.ok(!result.dialogue.some(d=>d.character==='Arohi'));
 assert.ok(result.character_actions.some(a=>/doori/.test(a.text)));
 assert.ok(!result.narration.some(t=>/hug karti/.test(t)));
 const party=ensureWorldBeats(scene,buildWorld(history('Voh maar gaya.','Cake surprise aa gaya.')));
 assert.ok(party.narration.some(t=>/ghatna nahi badalti/.test(t)));
});
test('quiet requests do not create a fear/grudge event',()=>{
 const world=buildWorld(history('Arohi, filhaal chup raho.','Naina, help chahiye?'));
 assert.equal(world.trust,'develop_from_history');assert.equal(world.boundary,null);assert.equal(world.incident,null);
});
test('shared actions stay at top and individual actions move beside their character',()=>{
 const result=placeCharacterActions({...scene,narration:['Arohi cup rakh deti hai.','Arohi aur Naina ek dusre ko dekhti hain.','Baarish jaari hai.']});
 assert.deepEqual(result.dialogue[0].actions,['Arohi cup rakh deti hai.']);
 assert.deepEqual(result.narration,['Arohi aur Naina ek dusre ko dekhti hain.','Baarish jaari hai.']);
 const silent=placeCharacterActions({...scene,dialogue:[],narration:['Naina pen rakh deti hai.']});
 assert.equal(silent.character_actions[0].character,'Naina');
});

function providerScene(output=scene,finish='stop'){
 return new Response('data: '+JSON.stringify({model:'google/gemma-4-26b-a4b-it',
  choices:[{delta:{content:typeof output==='string'?output:JSON.stringify(output)},finish_reason:finish}],
  usage:{prompt_tokens:100,completion_tokens:50,cost:0.0001}})+'\n\ndata: [DONE]\n\n');
}
async function withCore(provider,run,options={}){
 const origin='http://127.0.0.1:8789';
 const server=createDemoServer({publicOrigin:origin,settings:{key:'test-key',provider:'openrouter',model:'google/gemma-4-26b-a4b-it',endpoint:'https://example.invalid'},fetcher:provider,...options});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const send=(messages,id)=>localFetch(url+'/api/story',{method:'POST',headers:{host:'127.0.0.1:8789',origin,'Content-Type':'application/json'},body:JSON.stringify({messages,request_id:id})});
 try{await run(send);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('police generation is accepted end to end instead of failing the two-character schema',async()=>{
 await withCore(async()=>providerScene({...scene,dialogue:[{character:'Police Officer',actions:['Officer paas aata hai.'],text:'Kya hua tha?'}]}),async send=>{
  const response=await send(history('Police ko call kiya.','Main rukta hoon.','Police kuch bolega.'),randomUUID());
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.story.dialogue[0].character,'Police Officer');assert.equal(data.director.revision,7);
 });
});
test('duplicate in-flight and completed requests reuse one provider call and one quota reservation',async()=>{
 let calls=0,reservations=0;
 await withCore(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return providerScene();},async send=>{
  const id=randomUUID(),messages=history('Chai?');
  const [a,b]=await Promise.all([send(messages,id),send(messages,id)]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,1);assert.equal(reservations,1);
  assert.equal((await (await send(messages,id)).json()).replayed,true);assert.equal(calls,1);
  assert.equal((await send(history('Alag message.'),id)).status,409);
  assert.equal((await send(messages,randomUUID())).status,429);
 },{reserveRequest:()=>++reservations<=1});
});
test('provider failure and malformed output release the busy state without silent automatic retries',async()=>{
 let mode='credits',calls=0;
 await withCore(async()=>{calls++;return mode==='credits'?new Response('',{status:402}):providerScene(mode==='invalid'?'not JSON':scene);},async send=>{
  assert.equal((await send(history('Chai?'),randomUUID())).status,402);
  mode='invalid';const rejected=await send(history('Chai?'),randomUUID());
  assert.equal(rejected.status,502);assert.equal((await rejected.json()).telemetry.cost_usd,0.0001);
  mode='ok';assert.equal((await send(history('Chai?'),randomUUID())).status,200);assert.equal(calls,3);
 });
});
test('an interrupted provider completion is not committed as a complete scene',async()=>{
 await withCore(async()=>providerScene(scene,'length'),async send=>{
  const response=await send(history('Chai?'),randomUUID());assert.equal(response.status,502);
  assert.match((await response.json()).error,/did not complete/);
 });
});
test('episode 18 has a grounded reading-pause hook and turn 19 continues without an automatic time jump',async()=>{
 await withCore(async()=>providerScene({...scene,episode_hook:'Kal ki taiyaari mein abhi kya baaki hai?'}),async send=>{
  const eighteen=await (await send(history(...Array(18).fill('Main sun raha hoon.')),randomUUID())).json();
  assert.equal(eighteen.story.episode_end.episode,1);
  assert.equal(eighteen.story.episode_end.hook,'Kal ki taiyaari mein abhi kya baaki hai?');
  const nineteen=await (await send(history(...Array(19).fill('Main sun raha hoon.')),randomUUID())).json();
  assert.equal(nineteen.director.episode,2);assert.equal(nineteen.director.episode_turn,1);
  assert.equal(nineteen.story.episode_end,undefined);
 });
});
test('a timed out provider request releases the server for the next message',async()=>{
 let calls=0;
 await withCore(async(_url,options)=>{
  calls++;if(calls>1)return providerScene();
  return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 },async send=>{
  const first=await send(history('Chai?'),randomUUID());assert.equal(first.status,502);
  assert.match((await first.json()).error,/timed out/);
  assert.equal((await send(history('Chai?'),randomUUID())).status,200);assert.equal(calls,2);
 },{requestTimeoutMs:30});
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
  assert.equal(status.revision,7);assert.equal(status.key,undefined);
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

test('browser: legacy history preserved, controls render, reset confirms and saves revision 7',async()=>{
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
 const context={document,structuredClone,console,location:{protocol:'file:'},crypto:{randomUUID},AbortController,setTimeout,clearTimeout,
  localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},
  confirm:()=>{confirmations++;return confirmResult;}};
 vm.runInNewContext(script,context);
 assert.equal(elements.get('version-note').hidden,false);
 assert.equal(elements.get('speakers').children.length,2);
 assert.equal(elements.get('log').children.length,3);
 elements.get('restart').listeners.click();
 assert.equal(confirmations,1);assert.equal(JSON.parse(saved).messages.length,3);
 confirmResult=true;elements.get('restart').listeners.click();
 assert.equal(JSON.parse(saved).version,7);assert.equal(JSON.parse(saved).messages.length,1);
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

async function browserHarness(fetcher,stored=null){
 const html=await readFile(new URL('./story.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1],elements=new Map();
 const element=()=>({children:[],listeners:{},value:'',hidden:false,
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(){},
  addEventListener(name,fn){this.listeners[name]=fn;},focus(){}});
 let saved=stored;
 const context={document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},
  structuredClone,console,location:{protocol:'http:'},crypto:{randomUUID},AbortController,AbortSignal,setTimeout,clearTimeout,
  localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},confirm:()=>false,
  fetch:async(url,options)=>url==='/api/status'?new Response(JSON.stringify({configured:true,revision:7,model:'google/gemma-4-26b-a4b-it'})):fetcher(url,options)};
 vm.runInNewContext(script,context);await new Promise(resolve=>setImmediate(resolve));
 return {context,elements,saved:()=>JSON.parse(saved)};
}
function browserSuccess(messages,output=scene){
 const director=buildDirector(messages);
 return new Response(JSON.stringify({story:placeCharacterActions(enforceSpeakers(validateStory(output),director)),director,
  configured_model:'google/gemma-4-26b-a4b-it',model:'google/gemma-4-26b-a4b-it'}));
}
test('browser known failure shows the error beside the composer, retains draft and re-enables send',async()=>{
 let failed=true,calls=0;
 const browser=await browserHarness(async(_url,options)=>{
  calls++;return failed?new Response(JSON.stringify({error:'Provider unavailable. Your draft is kept.'}),{status:502}):browserSuccess(JSON.parse(options.body).messages);
 });
 await browser.context.send('Police kuch bolega.');
 assert.equal(browser.elements.get('send-feedback').hidden,false);
 assert.match(browser.elements.get('send-feedback').textContent,/Provider unavailable/);
 assert.equal(browser.elements.get('send-button').disabled,false);
 assert.equal(browser.elements.get('retry-message').hidden,false);
 assert.equal(browser.saved().pending.text,'Police kuch bolega.');assert.equal(browser.saved().pending.request_id,null);
 assert.equal(browser.saved().messages.length,1);
 failed=false;await browser.context.send(browser.saved().pending.text);
 assert.equal(browser.saved().pending,null);assert.equal(browser.saved().messages.length,3);assert.equal(calls,2);
});
test('browser network failure and reload preserve the same request id for an unconfirmed result',async()=>{
 const ids=[];
 const first=await browserHarness(async(_url,options)=>{ids.push(JSON.parse(options.body).request_id);throw Error('Network disconnected');});
 await first.context.send('Naina, chai?');
 assert.equal(first.saved().pending.request_id,ids[0]);
 const reloaded=await browserHarness(async(_url,options)=>{const body=JSON.parse(options.body);ids.push(body.request_id);return browserSuccess(body.messages);},JSON.stringify(first.saved()));
 await reloaded.context.send(reloaded.saved().pending.text);
 assert.equal(ids[0],ids[1]);assert.equal(reloaded.saved().pending,null);
});
test('browser stop-waiting cancels the wait, saves the draft and restores send controls',async()=>{
 let calls=0;
 const browser=await browserHarness(async(_url,options)=>{
  calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
 });
 const pending=browser.context.send('Naina, menu?');
 assert.equal(browser.elements.get('send-button').disabled,true);
 assert.equal(browser.elements.get('cancel-request').hidden,false);
 browser.elements.get('cancel-request').listeners.click();await pending;
 assert.equal(calls,1);assert.equal(browser.saved().pending.text,'Naina, menu?');
 assert.equal(browser.elements.get('send-button').disabled,false);
 assert.match(browser.elements.get('send-feedback').textContent,/Waiting stopped/);
});
test('browser renders shared scene first and an NPC action immediately before the NPC dialogue',async()=>{
 const output={...scene,narration:['Baarish ki awaaz hai.'],dialogue:[{character:'Naina',actions:['Naina pen rakh deti hai.'],text:'Menu yahan hai.'}]};
 const browser=await browserHarness(async(_url,options)=>browserSuccess(JSON.parse(options.body).messages,output));
 await browser.context.send('Naina, menu?');
 const article=browser.elements.get('log').children.at(-1);
 assert.equal(article.children[0].className,'scene-copy');
 assert.equal(article.children[1].className,'character-scene');
 assert.equal(article.children[1].children[0].textContent,'Naina pen rakh deti hai.');
 assert.equal(article.children[2].className,'dialogue');
 assert.equal(article.children[2].children[0].textContent,'Naina');
});
