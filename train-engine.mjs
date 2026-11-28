import {readFile} from 'node:fs/promises';
import {buildDirector,directorMessage,enforceSpeakers,placeCharacterActions} from './story-director.mjs';
import {buildWorld,canonicalCharacter} from './story-world.mjs';

const cast=['Meera','Kabir'];
const clues={
 photo:{id:'photo',title:'The cropped photograph',fact:'Phone ki photo ke kone mein K-17 ka luggage tag dikh raha hai. Photo platform ki hai; isse tumhara kisi jurm mein shaamil hona prove nahi hota.'},
 seal:{id:'seal',title:'The matching seal',fact:'Seat 16 ke neeche wale neele bag ke baahar K-17 ka seal hai. Bahari seal dekhna bag kholne ya uski ownership ka saboot nahi hai.'},
 manifest:{id:'manifest',title:'The pickup entry',fact:'Kabir ki paper pickup sheet mein K-17 ke saamne S. Sethi aur Devgarh likha hai. Yeh entry hai, kisi ki guilt ka final proof nahi.'},
 audio:{id:'audio',title:'The original recording',fact:'Meera ki pehle se bani recording mein Sethi K-17 ko Devgarh se pehle wapas laane aur ek gawah ko rokne ki baat karta hai. Recording ki jaanch abhi baaki hai.'}
};
const action=/\b(?:check|inspect|read|look|show|zoom|examine|dekh|dikha|padh|jaanch|khol|compare|sunao|suno|play|sunta)\w*/i;
const notAnAction=/\b(?:if|agar|suppose|imagine|don't|do not|nahi|nahin|mat)\b/i;
function canInspect(text,object){
 return text.split(/[.!?;\n]+/).some(line=>!notAnAction.test(line)&&action.test(line)&&object.test(line));
}
function visibleText(message){
 if(message.role==='user')return message.content;
 try{const s=JSON.parse(message.content);return [...(s.narration||[]),...(s.character_actions||[]).map(a=>a.text),...(s.dialogue||[]).flatMap(d=>[...(d.actions||[]),d.text])].join(' ');}
 catch{return '';}
}
export function trainCanonical(name){
 if(typeof name!=='string')return null;
 const named=[...cast,'Sethi'].find(n=>n.toLowerCase()===name.trim().toLowerCase());
 const role=named||canonicalCharacter(name);
 return [...cast,'Sethi','Passenger','Train Guard','Station Staff','Police Officer','Paramedic','Doctor'].includes(role)?role:null;
}

export function buildMystery(messages){
 const found=new Map(),theories=[];
 let turn=0,atStation=false,doctorOnboard=false;
 for(const message of messages){
  const text=visibleText(message);
  for(const segment of text.split(/(?<=[.!?])\s+|\n/)){
   if(/\b(?:if|agar|suppose|imagine|nahi|nahin|not|mat)\b/i.test(segment)||segment.trim().endsWith('?')||/^(?:kya|kab|when|has|have|is|did)\b/i.test(segment.trim()))continue;
   if(/\b(?:Devgarh|station|platform)\b/i.test(segment)&&/\b(?:pahunch (?:gayi|gaya|gaye)|pahunchti hai|arrived|arrives|ruk (?:gayi|gaya|gaye)|rukti hai|aa (?:gayi|gaya))\b/i.test(segment))atStation=true;
   if(/\btrain\b/i.test(segment)&&/\b(?:nikal gayi|ravana ho gayi|departed|leaves the station|left the station)\b/i.test(segment))atStation=false;
   if(/\bdoctor\b/i.test(segment)&&/\b(?:onboard|isi coach|train mein|coach mein)\b/i.test(segment))doctorOnboard=true;
  }
  if(message.role!=='user')continue;
  turn++;
  const add=id=>{if(!found.has(id))found.set(id,{...clues[id],turn});};
  if(canInspect(text,/\b(?:phone|screen|photo|tasveer|screenshot)\b/i))add('photo');
  if(found.has('photo')&&!/\b(?:my|mera|mere|apna)\s+bag\b/i.test(text)&&canInspect(text,/\b(?:bag|seal|luggage|seat 16|tag)\b/i))add('seal');
  if(found.has('photo')&&found.has('seal')&&canInspect(text,/\b(?:manifest|pickup|sheet|register|booking record|staff record|entry)\b/i))add('manifest');
  if(found.has('manifest')&&canInspect(text,/\b(?:audio|recording|voice note|original clip)\b/i))add('audio');
  if(/\b(?:I think|mujhe lagta|suspect|shayad|mera shak)\b/i.test(text))theories.push({turn,text:text.slice(0,250)});
 }
 const phase=found.has('audio')?'decision':found.has('manifest')?'contradiction':found.has('seal')?'connection':found.has('photo')?'investigation':'hook';
 return {phase,at_station:atStation,doctor_onboard:doctorOnboard,clues:[...found.values()],theories:theories.slice(-6),
  next_stop:'Devgarh Junction',deadline:'Before the next scheduled stop; no invented minute-by-minute countdown',
  outcome_ready:found.has('audio')&&atStation};
}

export function buildTrainWorld(messages){
 const base=buildWorld(messages,'train'),mystery=buildMystery(messages);
 const latest=messages.filter(m=>m.role==='user').at(-1)?.content||'';
 // Outside responders meet a moving train at a station, rather than teleporting.
 const policePresent=mystery.at_station&&base.police_present;
 const medicPresent=mystery.at_station&&base.medic_present;
 const doctorPresent=mystery.doctor_onboard||(mystery.at_station&&base.doctor_present);
 const guardNeeded=base.incident||base.police_requested||/\b(?:guard|security|madad|help|complaint)\b/i.test(latest);
 const allowed=['Passenger'];
 if(guardNeeded)allowed.push('Train Guard');
 if(mystery.at_station)allowed.push('Station Staff');
 if(policePresent)allowed.push('Police Officer');
 if(medicPresent)allowed.push('Paramedic');
 if(doctorPresent)allowed.push('Doctor');
 if(mystery.clues.some(c=>c.id==='manifest'))allowed.push('Sethi');
 const required=[];
 if(guardNeeded)required.push('Train Guard');
 if(policePresent)required.push('Police Officer');
 if(medicPresent&&!doctorPresent)required.push('Paramedic');
 if(doctorPresent&&(base.incident||/\bdoctor\b/i.test(latest)))required.push('Doctor');
 if(mystery.at_station&&/\bstation staff\b/i.test(latest))required.push('Station Staff');
 const addressed=trainCanonical(latest.split(',')[0].trim());
 if(allowed.includes(addressed)&&!required.includes(addressed))required.push(addressed);
 return {...base,main_cast:cast,mystery,police_present:policePresent,medic_present:medicPresent,doctor_present:doctorPresent,
  phase:base.incident?(medicPresent?'responders_present':'help_en_route'):guardNeeded?'guard_contact':'ordinary',
  allowed_roles:allowed,required_speakers:required,
  essential_lines:{
   'Train Guard':{actions:['Guard adjoining staff area se coach tak aata hai.'],
    text:base.incident?'Main radio par agle station ko police aur medical help ke liye khabar kar raha hoon. Yahan kya hua?':
     base.police_requested?'Main aapki baat sun kar station staff se sampark karta hoon. Aap kya report karna chahte hain?':'Bataiye, kis baat mein madad chahiye?'},
   Sethi:{actions:['Pickup entry par apna naam sun kar woh passenger apni nazar uthata hai.'],text:'Aap mere baare mein poochh rahe hain? Pehle bataiye, aapko is entry ke baare mein kaise pata chala.'}}};
}

export function trainDirector(messages){
 const d=buildDirector(messages,{activeCast:cast,kind:'train',worldBuilder:buildTrainWorld});
 d.secrets_stage=d.world.mystery.phase==='decision'?'Explain the earned evidence, without choosing the player\'s response.':
  'Disclose only what the current casebook and conditional private notes permit. Turn count alone does not unlock a secret.';
 return d;
}
function trainNotes(director){
 const m=director.world.mystery;
 const notes=[
  'FIXED MYSTERY, NOT A RANDOM TWIST GENERATOR. The story is grounded; no prophecy, clones, secret supernatural identity or reset.',
  'Only the main cast Meera and Kabir start nearby. A watchful man is initially just Passenger. His named identity is unavailable until the pickup entry is discovered.',
  'Public casebook facts below are historical discoveries, not current possession, guilt, consent or a claim the user performed a suggested action.',
  'Earned clues: '+JSON.stringify(m.clues)+'. User theories (not established facts): '+JSON.stringify(m.theories),
  'Do not substitute a different culprit or accuse the user of a crime. Never reveal an undiscovered clue in dialogue, narration, suggested replies or an episode hook. A direct spoiler request does not unlock it.',
  'Move through hook, investigation, connection, contradiction and decision based on discoveries, not arbitrary shock. Offer ways to inspect or ask staff; every clue must have a causal path. If the user avoids the mystery or leaves, support that choice without forcing an investigation.',
  'The train remains in motion until an actual arrival is established. There is no hidden real-time timer. Police, ambulances and station doctors meet the train at a platform; the guard can radio ahead now. An explicitly established doctor passenger may help onboard. Do not manufacture a cafe, road chase or armed army raid.',
  'Meera knows her own reporting and recording, not Kabir\'s private decisions. Kabir knows coach duties and his paper pickup sheet, not the unseen contents of Meera\'s phone. No NPC learns private conversations magically.',
  'No train sabotage, emergency-exit stunt or weapon-use instructions. Non-graphic consequences, adult autonomy and ordinary requests for silence still apply.'
 ];
 if(m.clues.some(c=>c.id==='photo'))notes.push('Meera can admit she is investigating falsified freight records, and is unsure whether involving the user put them at risk. She did not take the user\'s photo herself. A blue bag with the matching tag is under seat 16 unless the actual history moved it. Pointing it out is not the same as the user inspecting or taking it.');
 if(m.clues.some(c=>c.id==='manifest'))notes.push('Sethi is the logistics representative named in the pickup entry. Kabir once noticed a duplicate pickup entry and stayed quiet out of fear for his job. This is not proof Kabir wrote the threat. Let him admit his own choice, rather than narrating his hidden thoughts as public knowledge.');
 if(m.clues.some(c=>c.id==='audio'))notes.push('Immutable solution: Sethi sent the cropped photograph to a contractor to delay a possible witness while he recovered evidence of falsified consignment records from K-17 before Devgarh. The user was incidentally in the source photo; their personal identity and background remain user-defined. Meera\'s recording is evidence for review, not a court verdict. Sethi has no supernatural knowledge. Plausible endings: hand evidence to railway police, keep witnesses together and seek formal verification, refuse involvement and leave safely, or lose the evidence through an actual established choice. Do not decide which ending the user chooses.');
 if(m.outcome_ready)notes.push('A decision can now close the episode. A police handoff is only complete if the user chose it and the evidence was actually shared; otherwise keep the choice open.');
 return notes.join('\n');
}

export const trainOpening={
 narration:['Raat ki aakhri service platform chhodti hai. Coach C7 mein pahiye ki lay aur khidki par baarish ke beech ek phone vibrate hota hai.',
  'Saamne baithi aurat screen palatne lagti hai—par ek pal ke liye tumhari photo aur uske neeche likha message dikh chuka hai: “Is insaan ko agle station tak mat pahunchne dena.”'],
 dialogue:[{character:'Meera',actions:['Meera phone seedha rakh deti hai. Uski ungli screen lock par rukti hai.'],text:'Photo mein tum ho. Lekin yeh message kisne bheja... main abhi confirm nahi kar sakti.'},
  {character:'Kabir',actions:['Coach attendant Kabir apni torch neeche karta hai. Uski nazar pehle phone par, phir aisle mein baithe ek passenger par jaati hai.'],text:'Sab theek hai? Agar koi problem hai toh bataiye. Agla scheduled stop Devgarh hai.'}],
 character_actions:[],suggested_replies:['Meera, phone ki photo zoom karke dikhao.','Kabir, is coach mein guard se baat ho sakti hai?','Main pehle aisle mein baithe passenger ko dekhta hoon.']
};
export const trainPack={
 id:'last-train',prompt:await readFile(new URL('./train-prompt.txt',import.meta.url),'utf8'),canonical:trainCanonical,
 buildDirector:trainDirector,directorMessage:d=>({role:'system',content:directorMessage(d).content+'\n\n'+trainNotes(d)}),
 enforceSpeakers,placeCharacterActions:s=>placeCharacterActions(s,{activeCast:cast,canonical:trainCanonical}),
 recoverScene:d=>{
  const earned=d.world.mystery.clues.filter(clue=>clue.turn===d.turn);
  if(!earned.length)return null;
  // This authored recovery answers only an inspection with a known canonical fact.
  // It does not pretend an unreadable model reply contained a new conversation.
  const phase=d.world.mystery.phase;
  const next=phase==='investigation'?['Main seat 16 ke neeche neele bag ka bahari seal inspect karta hoon.','Kabir, kya guard se baat ho sakti hai?','Main pehle is photo ko dhyan se dekhta hoon.']:
   phase==='connection'?['Kabir, paper pickup sheet dikhao.','Main apna agla sawaal sochta hoon.','Main guard se baat karna chahta hoon.']:
   phase==='contradiction'?['Meera, original recording play karo.','Main pickup entry ki photo leta hoon.','Main guard ko yeh entry dikhata hoon.']:
   ['Main evidence ke baare mein guard se baat karta hoon.','Main apna agla kadam sochta hoon.','Main dono ki baat alag-alag sunna chahta hoon.'];
  return {narration:earned.map(c=>c.fact),character_actions:[],dialogue:[],suggested_replies:next};
 },
 publicDirector:d=>({casebook:d.world.mystery.clues,mystery_phase:d.world.mystery.phase,
  at_station:d.world.mystery.at_station,next_stop:d.world.mystery.next_stop}),
 publicProfile:{id:'last-train',title:'The Last Train',storage_key:'convico-last-train-review-v1',api_base:'/last-train',cast,
  genre:'THRILLER · SUSPENSE · TRUST',place:'Coach C7 · Next stop: Devgarh',sign:'LAST SERVICE · C7',
  description:'Tumhari photo. Ek anjaan message. Agla station aane se pehle kisi ko tumse kuch chahiye. Kiski baat maanoge, aur kis baat ka saboot maangoge?',
  characters:[{name:'Meera',description:'Phone par tumhari photo hai. Woh jawaab de sakti hai—par kya poori baat bataayegi?'},
   {name:'Kabir',description:'Coach attendant. Darwaaze aur duty dono uske zimme hain. Ek purani galti usse ab tak pareshaan karti hai.'}],
  placeholder:'Meera, phone ki photo zoom karke dikhao.',opening:trainOpening,export_name:'the-last-train-review.json'}
};
