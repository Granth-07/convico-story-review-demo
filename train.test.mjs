import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import vm from 'node:vm';
import {buildMystery,buildTrainWorld,trainDirector,trainCanonical,trainPack,trainOpening} from './train-engine.mjs';
import {speakerCommand,enforceSpeakers,placeCharacterActions} from './story-director.mjs';
import {validateStory} from './story-server.mjs';
import {createReviewServer} from './review-server.mjs';

const history=(...texts)=>texts.flatMap(content=>[{role:'assistant',content:JSON.stringify(trainOpening)},{role:'user',content}]);
const investigation=['Meera, phone ki photo zoom karke dikhao.','Main seat 16 ke neeche bag ka seal inspect karta hoon.',
 'Kabir, pickup manifest padh ke dikhao.','Meera, original recording play karo.'];
const example={narration:['Baarish khidki par lakeerein bana rahi hai.'],character_actions:[],
 dialogue:[{character:'Meera',actions:['Meera phone seedha karti hai.'],text:'Pehle tasveer ko dhyan se dekhte hain.'}],
 suggested_replies:['Main phone ki photo inspect karta hoon.','Kabir, guard se baat karao.','Main kuch pal sochta hoon.']};

test('opening is actionable and does not invent the player identity or reveal the culprit',()=>{
 assert.deepEqual(trainOpening.dialogue.map(d=>d.character),['Meera','Kabir']);
 assert.equal(trainOpening.suggested_replies.length,3);
 assert.match(trainOpening.narration.join(' '),/photo/);assert.doesNotMatch(JSON.stringify(trainOpening),/Sethi|memory card|criminal identity/i);
});
test('no automatic clue discovery from turn count, theories or unchosen suggestions',()=>{
 assert.deepEqual(buildMystery(history(...Array(20).fill('Main chup baitha hoon.'))).clues,[]);
 assert.deepEqual(buildMystery(history('Mujhe lagta hai Meera jhooth bol rahi hai.')).clues,[]);
 assert.deepEqual(buildMystery(history('If I inspect the phone, what happens?')).clues,[]);
 assert.deepEqual(buildMystery(history('Phone mat dikhao.')).clues,[]);
});
test('earned clues form an ordered casebook and are reconstructed after reload',()=>{
 const messages=history(...investigation),m=buildMystery(JSON.parse(JSON.stringify(messages)));
 assert.deepEqual(m.clues.map(c=>c.id),['photo','seal','manifest','audio']);
 assert.deepEqual(m.clues.map(c=>c.turn),[1,2,3,4]);assert.equal(m.phase,'decision');assert.equal(m.outcome_ready,false);
 const afterArrival=buildMystery(history(...investigation,'Train Devgarh station par pahunch gayi.'));
 assert.equal(afterArrival.outcome_ready,true);
});
test('later-stage demands cannot skip the evidence chain',()=>{
 assert.deepEqual(buildMystery(history('Original recording play karo.','Manifest dikhao.','Bag inspect karta hoon.')).clues,[]);
 assert.deepEqual(buildMystery(history(investigation[0],'Mera bag inspect karo.')).clues.map(c=>c.id),['photo']);
});
test('a theory is preserved as a theory, not promoted into a culprit fact',()=>{
 const m=buildMystery(history('Mujhe lagta hai Kabir ne message bheja hai.'));
 assert.equal(m.theories.length,1);assert.deepEqual(m.clues,[]);assert.equal(m.culprit,undefined);
});
test('private solution is withheld until earned; cafe canon never enters the train prompt',()=>{
 const early=trainPack.directorMessage(trainDirector(history('Meera, tum kaun ho?'))).content;
 assert.doesNotMatch(early,/Arohi|Naina|ten lakh|Immutable solution:|Sethi sent/);
 const late=trainPack.directorMessage(trainDirector(history(...investigation))).content;
 assert.match(late,/Sethi sent the cropped photograph/);assert.match(late,/personal identity and background remain user-defined/);
});
test('train character silence, targeted questions and invitation to resume persist',()=>{
 assert.deepEqual(speakerCommand('Meera, chup raho.',['Meera','Kabir']),{Meera:false});
 const d=trainDirector(history('Meera, chup raho.','Kabir, kya hua?','Meera, tum kaun ho?'));
 assert.equal(d.speaking.Meera,false);assert.ok(!d.allowed_speakers.includes('Meera'));
 assert.equal(trainDirector(history('Meera, chup raho.','Meera, ab tum bolo.')).speaking.Meera,true);
 assert.equal(trainDirector(history('Meera aur Kabir, tum dono chup raho.')).speaking.Kabir,false);
});
test('guard can respond onboard; outside police and medics cannot teleport onto the moving train',()=>{
 const world=buildTrainWorld(history('I killed someone.','Main yahin hoon.','Police aa gaye.','Ambulance aa gayi.'));
 assert.ok(world.allowed_roles.includes('Train Guard'));assert.ok(!world.allowed_roles.includes('Police Officer'));
 assert.ok(!world.allowed_roles.includes('Paramedic'));
 const result=enforceSpeakers(validateStory(example,{canonical:trainCanonical}),trainDirector(history('I killed someone.')));
 assert.ok(result.dialogue.some(d=>d.character==='Train Guard'));
 assert.ok(!result.dialogue.some(d=>d.character==='Neighbour'));
});
test('station arrival enables appropriate responders and an established doctor can help onboard',()=>{
 const station=buildTrainWorld(history('I killed someone.','Main rukta hoon.','Train Devgarh station par pahunch gayi.'));
 assert.ok(station.allowed_roles.includes('Police Officer'));assert.ok(station.allowed_roles.includes('Paramedic'));
 assert.ok(!buildTrainWorld(history('Doctor isi coach mein hai?')).allowed_roles.includes('Doctor'));
 const doctor=buildTrainWorld(history('Ek doctor isi coach mein hai.'));
 assert.ok(doctor.allowed_roles.includes('Doctor'));
 assert.equal(buildMystery(history('Kya train Devgarh pahunch gayi?')).at_station,false);
});
test('fixed setting accepts railway roles and rejects cafe or crossover dialogue',()=>{
 const s=validateStory({...example,dialogue:[{character:'Arohi',text:'Chai?'},{character:'Iron Man',text:'Hello'},
  {character:'Meera',text:'Main yahin hoon.'}]},{canonical:trainCanonical});
 assert.deepEqual(s.dialogue.map(d=>d.character),['Meera']);
 const directed=trainDirector(history('Kabir, guard se baat karao.'));
 assert.ok(directed.allowed_speakers.includes('Train Guard'));
});
test('train individual actions are placed beside their actor; shared actions stay at top',()=>{
 const s=placeCharacterActions({...example,narration:['Meera phone rakh deti hai.','Meera aur Kabir ek dusre ko dekhte hain.']},
  {activeCast:['Meera','Kabir'],canonical:trainCanonical});
 assert.ok(s.dialogue[0].actions.includes('Meera phone rakh deti hai.'));
 assert.deepEqual(s.narration,['Meera aur Kabir ek dusre ko dekhte hain.']);
});
test('a named suspect and a directly addressed passenger can respond without an invalid speaker error',()=>{
 const director=trainDirector(history(...investigation.slice(0,3),'Sethi, pickup entry par tumhara naam kyun hai?'));
 const result=enforceSpeakers(validateStory(example,{canonical:trainCanonical}),director);
 assert.ok(result.dialogue.some(d=>d.character==='Sethi'&&typeof d.text==='string'));
 const passenger=trainDirector(history('Passenger, tumne kya dekha?'));
 const ordinary=enforceSpeakers(validateStory(example,{canonical:trainCanonical}),passenger);
 assert.ok(ordinary.dialogue.some(d=>d.character==='Passenger'));
 assert.ok(!ordinary.dialogue.some(d=>/kisi ko chot/.test(d.text)));
});
test('a departure updates the station state instead of leaving the train permanently on a platform',()=>{
 assert.equal(buildMystery(history('Train Devgarh station par pahunch gayi.','Train station se nikal gayi.')).at_station,false);
});

function wire(url,options={}){
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:options.method||'GET',headers:options.headers},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));res.on('error',reject);
  });req.on('error',reject);req.end(options.body);
 });
}
function providerReply(scene){return new Response('data: '+JSON.stringify({model:'google/gemma-4-26b-a4b-it',choices:[{delta:{content:JSON.stringify(scene)},finish_reason:'stop'}],
 usage:{prompt_tokens:100,completion_tokens:50,cost:0.0001}})+'\n\ndata: [DONE]\n\n');}
test('authenticated collection serves both stories, isolates prompts and shares model quota',async()=>{
 let calls=0,trainPrompt='',cafePayload,trainPayload;
 const server=createReviewServer({password:'train-review-password-123',publicOrigin:'http://127.0.0.1:8789',maxRequests:2,
  settings:{key:'test',provider:'openrouter',model:'google/gemma-4-26b-a4b-it',endpoint:'https://example.invalid'},
  fetcher:async(_url,options)=>{
   calls++;const payload=JSON.parse(options.body);
   if(payload.messages[0].content.startsWith('THE LAST TRAIN')){trainPayload=payload;trainPrompt=payload.messages[0].content;return providerReply(example);}
   cafePayload=payload;
   return providerReply({...example,dialogue:[{character:'Arohi',text:'Chai taiyaar hai.'}]});
  }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const headers={host:'127.0.0.1:8789',origin:'http://127.0.0.1:8789','Content-Type':'application/json',Authorization:'Basic '+Buffer.from('reviewer:train-review-password-123').toString('base64')};
 const send=(path,messages,id)=>wire(url+path,{method:'POST',headers,body:JSON.stringify({messages,request_id:id})});
 try{
  assert.equal((await wire(url+'/last-train/',{headers:{host:headers.host}})).status,401);
  const page=await (await wire(url+'/last-train/',{headers})).text();
  assert.match(page,/convico-last-train-review-v1/);assert.doesNotMatch(page,/Sethi sent the cropped photograph/);
  assert.equal((await wire(url+'/last-train',{headers})).status,302);
  const status=await (await wire(url+'/last-train/api/status',{headers})).json();assert.equal(status.story,'last-train');assert.equal(status.revision,8);
  const cafeStatus=await (await wire(url+'/api/status',{headers})).json();assert.equal(cafeStatus.revision,7);
  const id=randomUUID(),messages=history(investigation[0]);
  const train=await (await send('/last-train/api/story',messages,id)).json();
  assert.equal(train.story_id,'last-train');assert.equal(train.story.dialogue[0].character,'Meera');
  assert.deepEqual(train.director.casebook.map(c=>c.id),['photo']);
  assert.doesNotMatch(trainPrompt,/Arohi|Naina|ten lakh/);assert.equal(calls,1);
  const cafe=await (await send('/api/story',history('Chai?'),randomUUID())).json();
  assert.equal(cafe.story_id,'cafe');assert.equal(cafe.story.dialogue[0].character,'Arohi');
  assert.equal(cafe.director.casebook,undefined);
  assert.equal(cafePayload.response_format,undefined);assert.equal(cafePayload.provider,undefined);
  assert.equal(cafePayload.max_tokens,1100);assert.equal(cafePayload.temperature,0.65);
  assert.equal(cafe.recovery,undefined);assert.equal(cafe.quality,undefined);
  assert.equal(trainPayload.response_format.type,'json_schema');assert.equal(trainPayload.provider.require_parameters,true);
  assert.equal(trainPayload.max_tokens,1400);assert.equal(trainPayload.temperature,0.45);
  assert.equal(cafePayload.messages[0].content.includes('Never diagnose a keyboard'),false);
  assert.equal((await send('/last-train/api/story',history('Kabir, hello.'),randomUUID())).status,429);
  assert.equal((await (await send('/last-train/api/story',messages,id)).json()).replayed,true);assert.equal(calls,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('train browser uses separate storage, prefixed APIs, its own opening and the public casebook',async()=>{
 const html=(await readFile(new URL('./story.html',import.meta.url),'utf8')).replace('/*__STORY_PROFILE__*/ null',JSON.stringify(trainPack.publicProfile));
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1],elements=new Map(),storage=new Map([['convico-kal-hosted-review-v1','cafe history preserved']]);
 const element=()=>({children:[],listeners:{},value:'',hidden:false,append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},focus(){}});
 const urls=[];
 const context={document:{body:element(),getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},
  structuredClone,console,crypto:{randomUUID},AbortController,AbortSignal,setTimeout,clearTimeout,location:{protocol:'http:'},confirm:()=>false,
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  fetch:async(url,options)=>{
   urls.push(url);if(url.endsWith('/api/status'))return new Response(JSON.stringify({configured:true,model:'google/gemma-4-26b-a4b-it'}));
   const director=trainDirector(JSON.parse(options.body).messages);
   return new Response(JSON.stringify({story:example,story_id:'last-train',director:{speaking:director.speaking,episode:1,...trainPack.publicDirector(director)},
    configured_model:'google/gemma-4-26b-a4b-it',model:'google/gemma-4-26b-a4b-it'}));
  }};
 vm.runInNewContext(script,context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.get('story-title').textContent,'The Last Train');assert.equal(elements.get('casebook').hidden,false);
 assert.match(elements.get('speakers').children[0].textContent,/Meera/);
 await context.send(investigation[0]);
 assert.deepEqual(urls,['/last-train/api/status','/last-train/api/story']);
 const saved=JSON.parse(storage.get('convico-last-train-review-v1'));
 assert.equal(saved.messages[0].dialogue[0].character,'Meera');assert.equal(saved.messages.at(-1).director.casebook[0].id,'photo');
 assert.equal(storage.get('convico-kal-hosted-review-v1'),'cafe history preserved');
 assert.equal(elements.get('clue-list').children[0].children[0].textContent,'The cropped photograph');
});
