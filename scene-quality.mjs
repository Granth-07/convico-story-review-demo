// No eval, extra provider request or invented closing braces is used for repair.
export function sceneResponseFormat(characters){
 const text={type:'string'};
 const actor={type:'string',enum:[...new Set(characters)]};
 return {type:'json_schema',json_schema:{name:'interactive_scene',strict:true,schema:{
  type:'object',additionalProperties:false,
  properties:{
   narration:{type:'array',items:text,minItems:0,maxItems:6},
   character_actions:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,
    properties:{character:actor,text},required:['character','text']}},
   dialogue:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,
    properties:{character:actor,actions:{type:'array',items:text,maxItems:3},text},required:['character','actions','text']}},
   suggested_replies:{type:'array',items:text,minItems:3,maxItems:3},
   episode_hook:{type:['string','null']}
  },required:['narration','character_actions','dialogue','suggested_replies','episode_hook']
 }}};
}

function normalizeSyntax(input){
 let result='',inside=false,escape=false,smart=false;
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(inside){
   if(escape){result+=ch;escape=false;continue;}
   if(ch==='\\'){result+=ch;escape=true;continue;}
   if(ch==='\n'||ch==='\r'||ch==='\t'){result+=ch==='\n'?'\\n':ch==='\r'?'\\r':'\\t';continue;}
   if((!smart&&ch==='"')||(smart&&ch==='”')){result+='"';inside=false;smart=false;continue;}
   if(smart&&ch==='"'){result+='\\"';continue;}
   result+=ch;continue;
  }
  if(ch==='"'||ch==='“'){inside=true;smart=ch==='“';result+='"';continue;}
  if(ch===','&&/^[\s]*[}\]]/.test(input.slice(i+1)))continue;
  result+=ch;
 }
 if(inside)throw new SyntaxError('Unterminated string; the scene was not reconstructed.');
 return result;
}
function rootObject(text){
 const start=text.indexOf('{');if(start<0)throw new SyntaxError('No scene object.');
 let depth=0,inside=false,escape=false,end=-1;
 for(let i=start;i<text.length;i++){
  const ch=text[i];
  if(inside){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')inside=false;continue;}
  if(ch==='"'){inside=true;continue;}
  if(ch==='{'||ch==='[')depth++;
  if(ch==='}'||ch===']'){depth--;if(depth===0){end=i+1;break;}}
 }
 if(end<0||inside)throw new SyntaxError('Incomplete scene object.');
 // A single complete object may have a prose/fence wrapper, not another object.
 if(/[{}\[\]]/.test(text.slice(end)))throw new SyntaxError('Ambiguous multiple scene objects.');
 return text.slice(start,end);
}
export function parseSceneJson(raw){
 if(typeof raw!=='string'||raw.length>30000)throw new SyntaxError('Invalid scene size.');
 const trimmed=raw.replace(/^\uFEFF/,'').trim();
 try{return {value:JSON.parse(trimmed),repaired:false};}catch{}
 const normalized=normalizeSyntax(trimmed.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 const body=rootObject(normalized);
 return {value:JSON.parse(body),repaired:true};
}

// Phones and screens belong to the plot; the chat interface does not.
const interfaceReference=/\b(?:keyboard|keybord|keypad|autocorrect|typos?|typing|gibberish|random (?:letters|characters)|text ?box|send button|chat ?bot|language model|llm|json|api key|system prompt|local demo|your (?:input|message) is (?:invalid|unclear))\b|\b(?:type|typing)\s+(?:kar|kiya|karna|karo|ho|rahe)|\b(?:tumhar[aei]|aapka|your)\s+chat\b/i;
const clarification='Ek baar phir, thoda saaf bataoge? Tum kya kehna chahte ho?';
const safeReplies=['Main apni baat dobara saaf karta hoon.','Main pehle aas-paas dekhta hoon.','Main apna agla kadam batata hoon.'];
export function protectImmersion(story){
 let corrected=false;
 const keep=text=>{if(interfaceReference.test(text)){corrected=true;return false;}return true;};
 const narration=story.narration.filter(keep);
 const character_actions=(story.character_actions||[]).filter(a=>keep(a.text));
 const dialogue=story.dialogue.map(d=>({...d,actions:(d.actions||[]).filter(keep),
  text:keep(d.text)?d.text:clarification}));
 let suggested_replies=story.suggested_replies.filter(keep);
 for(const option of safeReplies)if(suggested_replies.length<3&&!suggested_replies.includes(option))suggested_replies.push(option);
 const episode_hook=story.episode_hook&&keep(story.episode_hook)?story.episode_hook:null;
 if(!narration.length&&!character_actions.length&&!dialogue.length)narration.push('Baat ek pal ke liye thamti hai; agla kadam tumhara hai.');
 return {story:{...story,narration,character_actions,dialogue,suggested_replies,episode_hook},corrected};
}
