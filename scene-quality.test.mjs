import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {parseSceneJson,protectImmersion,sceneResponseFormat} from './scene-quality.mjs';
import {createReviewServer} from './review-server.mjs';
import {trainOpening} from './train-engine.mjs';

const scene={narration:['Train ki khidki par baarish ki lakeerein hain.'],character_actions:[],
 dialogue:[{character:'Meera',actions:['Meera phone ki screen dekhti hai.'],text:'Phone par yeh message aaya tha.'}],
 suggested_replies:['Main dhyan se sunta hoon.','Main agla sawaal poochhta hoon.','Main thoda sochta hoon.'],episode_hook:null};
const raw=JSON.stringify(scene);
for(const [label,input] of [
 ['plain',raw],['fenced','```json\n'+raw+'\n```'],['prose wrapper','Here is the scene:\n'+raw+'\nEnd of scene.'],
 ['trailing commas',raw.replace('],"character_actions"',',],"character_actions"').replace(/}$/ ,',}')],
 ['smart delimiters',raw.replace(/"/g,c=>'“').replace(/“([^“]*)“/g,'“$1”')]
])test('parse a complete scene: '+label,()=>assert.deepEqual(parseSceneJson(input).value,scene));

test('repairs a literal newline inside a string without changing its meaning',()=>{
 const value=parseSceneJson('{"narration":["Pehli line\nDoosri line"],"dialogue":[],"suggested_replies":["A","B","C"]}');
 assert.equal(value.value.narration[0],'Pehli line\nDoosri line');assert.equal(value.repaired,true);
});
test('repair does not modify bracket/comma text or escaped quotes inside valid strings',()=>{
 const tricky={...scene,narration:['Tag par "K-17" hai. Punctuation: }, ] , aur \\ slash.']};
 assert.deepEqual(parseSceneJson('```json\n'+JSON.stringify(tricky)+'\n```').value,tricky);
});
for(const [label,input] of [
 ['missing object end',raw.slice(0,-1)],['unfinished string','{"narration":["unfinished'],
 ['multiple objects',raw+'\n'+raw],['not JSON','not JSON'],['executable syntax','{"value": (() => 123)()}'],
 ['too large','x'.repeat(30001)]
])test('does not invent content from '+label,()=>assert.throws(()=>parseSceneJson(input),SyntaxError));

test('structured output restricts actor names and requires the scene shape',()=>{
 const format=sceneResponseFormat(['Meera','Kabir','Meera']);
 assert.equal(format.json_schema.strict,true);
 assert.deepEqual(format.json_schema.schema.properties.dialogue.items.properties.character.enum,['Meera','Kabir']);
 assert.equal(format.json_schema.schema.additionalProperties,false);
 assert.equal(format.json_schema.schema.properties.suggested_replies.minItems,3);
});
test('unclear speech never becomes a keyboard diagnosis',()=>{
 const result=protectImmersion({...scene,dialogue:[{character:'Meera',actions:[],text:'Kya tumhara keyboard kharab ho gaya hai?'}]});
 assert.equal(result.corrected,true);assert.doesNotMatch(JSON.stringify(result.story),/keyboard/i);
 assert.match(result.story.dialogue[0].text,/phir/);
});
test('interface references are filtered from every visible scene field',()=>{
 const result=protectImmersion({...scene,narration:['The user is typing gibberish.'],
  character_actions:[{character:'Kabir',text:'Kabir tumhara send button dekhta hai.'}],
  dialogue:[{character:'Meera',actions:['She checks the API key.'],text:'Your keyboard is broken.'}],
  suggested_replies:['Fix the JSON.','Check the text box.','Main sochta hoon.'],episode_hook:'The system prompt changes.'});
 assert.doesNotMatch(JSON.stringify(result.story),/keyboard|typing|gibberish|API key|send button|text box|JSON|system prompt/i);
 assert.equal(result.story.suggested_replies.length,3);assert.equal(result.story.episode_hook,null);
});
test('legitimate in-world phones, screens, photos and messages are preserved',()=>{
 const result=protectImmersion(scene);assert.equal(result.corrected,false);assert.deepEqual(result.story,scene);
});

const history=(...texts)=>texts.flatMap(content=>[{role:'assistant',content:JSON.stringify(trainOpening)},{role:'user',content}]);
function wire(url,options){return new Promise((resolve,reject)=>{
 const req=request(url,{method:'POST',headers:options.headers},res=>{
  const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode})));
 });req.on('error',reject);req.end(options.body);
});}
async function runProvider(provider,run){
 const server=createReviewServer({password:'quality-test-password-123',publicOrigin:'http://127.0.0.1:8789',maxRequests:20,
  settings:{key:'fake-key',provider:'openrouter',model:'google/gemma-4-26b-a4b-it',endpoint:'https://example.invalid'},fetcher:provider});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/last-train/api/story';
 const headers={host:'127.0.0.1:8789',origin:'http://127.0.0.1:8789','Content-Type':'application/json',Authorization:'Basic '+Buffer.from('reviewer:quality-test-password-123').toString('base64')};
 try{await run((messages,id=randomUUID())=>wire(url,{headers,body:JSON.stringify({messages,request_id:id})}));}
 finally{await new Promise(resolve=>server.close(resolve));}
}
function reply(text,finish='stop'){return new Response('data: '+JSON.stringify({model:'google/gemma-4-26b-a4b-it',
 choices:[{delta:{content:text},finish_reason:finish}],usage:{prompt_tokens:110,completion_tokens:60,cost:0.00012}})+'\n\ndata: [DONE]\n\n');}

test('native structured output and local formatting repair use exactly one model call',async()=>{
 let calls=0,payload;
 await runProvider(async(_url,options)=>{calls++;payload=JSON.parse(options.body);return reply('```json\n'+raw.replace(/}$/ ,',}')+'\n```');},async send=>{
  const response=await send(history('Meera, tum kya kehna chahti ho?'));assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.recovery.kind,'local_format_repair');assert.equal(data.recovery.extra_model_calls,0);
  assert.equal(calls,1);assert.equal(data.telemetry.cost_usd,0.00012);
  assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.provider.require_parameters,true);
  assert.equal(payload.model,'google/gemma-4-26b-a4b-it');assert.equal(payload.max_tokens,1400);
 });
});
test('the screenshot bag-inspection case recovers from unusable output with only its earned fact',async()=>{
 let calls=0;
 await runProvider(async()=>{calls++;return reply('not JSON');},async send=>{
  const messages=history('Meera, phone ki photo zoom karke dikhao.','Meera, chup raho.',
   'Main seat 16 ke neeche wale neele bag ka bahari seal inspect karta hoon. Bag nahi kholta.');
  const id=randomUUID(),response=await send(messages,id);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.recovery.kind,'grounded_inspection');
  assert.match(data.story.narration.join(' '),/K-17/);assert.doesNotMatch(JSON.stringify(data.story),/Sethi|keyboard|invalid JSON/);
  assert.equal(data.director.speaking.Meera,false);assert.equal(data.story.dialogue.length,0);
  assert.deepEqual(data.director.casebook.map(c=>c.id),['photo','seal']);
  const replay=await (await send(messages,id)).json();assert.equal(replay.replayed,true);assert.equal(calls,1);
 });
});
test('complete nonsense output without an earned action does not fabricate story progress',async()=>{
 await runProvider(async()=>reply('not JSON'),async send=>{
  const response=await send(history('Kabir, tum kya kehna chahte ho?'));assert.equal(response.status,502);
  const data=await response.json();assert.equal(data.code,'scene_format');assert.equal(data.diagnostic,'invalid_json');
  assert.doesNotMatch(data.error,/JSON|SyntaxError/);assert.match(data.error,/safe/);assert.equal(data.story,undefined);
 });
});
test('a truncated or interrupted generation is not repaired by inventing the rest of a scene',async()=>{
 await runProvider(async()=>reply(raw,'length'),async send=>{
  const response=await send(history('Meera, phone ki photo zoom karke dikhao.'));assert.equal(response.status,502);
  const data=await response.json();assert.equal(data.story,undefined);assert.equal(data.recovery,undefined);
 });
});
test('gibberish input keeps the response in-world and does not unlock clues',async()=>{
 let calls=0;
 const bad={...scene,dialogue:[{character:'Meera',actions:[],text:'Yeh kya tha? Tumhara keyboard kharab hai kya?'}]};
 await runProvider(async()=>{calls++;return reply(JSON.stringify(bad));},async send=>{
  const response=await send(history('jsvbchjscskjcbaks'));assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.quality.immersion_corrected,true);
  assert.doesNotMatch(JSON.stringify(data.story),/keyboard/i);assert.deepEqual(data.director.casebook,[]);assert.equal(calls,1);
 });
});
test('a provider credit failure remains a real error and does not create an inspection scene',async()=>{
 await runProvider(async()=>new Response('',{status:402}),async send=>{
  const response=await send(history('Meera, phone ki photo zoom karke dikhao.'));assert.equal(response.status,402);
  const data=await response.json();assert.equal(data.story,undefined);assert.equal(data.recovery,undefined);
 });
});
