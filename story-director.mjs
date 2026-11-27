// Rebuild controls from user history. Never accept client-supplied speaker state.
export const revision=6;
export const cast=['Arohi','Naina'];

function plain(text){
 return text.normalize('NFKC').toLowerCase().replace(/[“”"].*?[“”"]/g,'').replace(/[’‘]/g,"'");
}
const silence=/\b(?:stay|keep|remain|be)\s+(?:quiet|silent)\b|\b(?:stop talking|stop speaking|don'?t interrupt|do not interrupt|don'?t speak|do not speak|don'?t talk|do not talk|no need to reply)\b|\b(?:chup|shaant)\s*(?:raho|rehna|ho jao)\b|\bchup\s*$|\b(?:mat bolo|mat bolna|beech (?:mein|me) mat bolo|interrupt mat (?:karo|karna))\b|चुप\s*(?:रहो|रहना)|मत बोलो|शांत रहो/;
const resume=/\b(?:ab|now)\s+(?:(?:tum|aap|you)\s+)?(?:bolo|bol sakti ho|baat karo|speak|talk)\b|\b(?:tum bolo|you (?:can|may) (?:speak|talk)|please (?:speak|talk)|chup mat raho|mat chup raho|chup nahi rehna|don'?t (?:stay|be|remain) (?:quiet|silent))\b|अब\s*(?:तुम\s*)?बोलो/;
const hypothetical=/\b(?:agar|if|suppose|imagine|what if|should i|can i|could i)\b|अगर/;

export function speakerCommand(text){
 const source=plain(text);
 const result={};
 // Sentence boundaries keep future permission ("jab main ...") from unmuting now.
 for(const sentence of source.split(/[.!?;\n]+/)){
  const line=sentence.split(/\b(?:jab|when|until)\b/)[0].trim();
  if(!line||hypothetical.test(line))continue;
  const names=[...line.matchAll(/\b(arohi|naina)\b|आरही|आरोही|नैना/g)];
  const both=/\b(?:tum dono|aap dono|both of you|everyone|dono|arohi (?:aur|and) naina|naina (?:aur|and) arohi)\b|तुम दोनों/.test(line);
  const apply=(targets,clause)=>{
   if(/\b(?:chup rehne ko nahi|didn'?t (?:say|ask)|never (?:said|asked))\b/.test(clause)||/^\s*ko\b/.test(clause))return;
   const value=resume.test(clause)?true:silence.test(clause)?false:null;
   if(value!==null)for(const name of targets)result[name]=value;
  };
  if(both)apply(cast,line);
  else for(let i=0;i<names.length;i++){
   const token=names[i][0];
   const name=/arohi|आरोही|आरही/.test(token)?'Arohi':'Naina';
   if(/^\s*(?:ko|ne (?:kaha|bola))\b/.test(line.slice(names[i].index+token.length)))continue;
   apply([name],names.length===1?line:line.slice(names[i].index+token.length,names[i+1]?.index));
  }
 }
 return result;
}

export function buildDirector(messages){
 const users=messages.filter(m=>m.role==='user');
 const speaking={Arohi:true,Naina:true};
 const relationshipEvidence=[];
 for(let i=0;i<users.length;i++){
  Object.assign(speaking,speakerCommand(users[i].content));
  // Evidence is quoted, not converted into invented numerical trust scores.
  if(/\b(?:sorry|maaf|shukriya|thank|help|madad|bharosa|trust|hate|idiot|stupid|bewakoof|pasand)\b/i.test(users[i].content)){
   relationshipEvidence.push({turn:i+1,user_said:users[i].content.slice(0,300)});
  }
 }
 const latest=plain(users.at(-1)?.content||'');
 const addresses=[...latest.matchAll(/(?:^|[,.!?;\n]\s*)(arohi|naina)\b/g)];
 const named=addresses.map(match=>cast.find(n=>n.toLowerCase()===match[1]));
 const addressed=named.filter(n=>speaking[n]).at(-1)||named.at(-1)||null;
 const both=/\b(?:tum dono|aap dono|both of you|dono|arohi (?:aur|and) naina|naina (?:aur|and) arohi)\b/.test(latest);
 const allowedSpeakers=cast.filter(n=>speaking[n]&&(!addressed||both||n===addressed));
 const turn=users.length,episode=Math.floor((turn-1)/18)+1,episodeTurn=(turn-1)%18+1;
 return {revision,turn,episode,episode_turn:episodeTurn,speaking,allowed_speakers:allowedSpeakers,max_speakers:both?2:1,
  relationship_evidence:relationshipEvidence.slice(-8),
  pacing:episodeTurn>=16?'A soft episode landing is available; answer the user first. No forced danger or time jump.':'Follow the current scene. At most one meaningful development.',
  secrets_stage:turn<6?'Only subtle, non-specific hints if relevant.':turn<10?'A character may acknowledge a concern; do not reveal its details yet.':'Details may be volunteered if earned by trust and the current conversation.'};
}

export function directorMessage(director){
 const secrets=director.turn<10?'No secret details are available yet.':
  'Optional established backstories: Arohi borrowed ten lakh rupees to fund the cafe and worries about repayments. Naina has an offer for a stable job in another city and has not decided whether to accept. Neither implies a crime, villain, betrayal or forced romance. Do not reveal both at once. Once revealed, remember who actually heard it.';
 return {role:'system',content:`SERVER STORY DIRECTOR — authoritative speaker controls\n${JSON.stringify(director)}\n`+
  'Only allowed_speakers may have dialogue. Pick one relevant speaker unless max_speakers is 2 because the user addressed both. An empty dialogue array is valid. A muted character must not speak through narration, quoted text, notes, phone messages or suggested replies. A neutral nonverbal action is fine. Silence does not imply anger or consent. Do not automatically unmute anyone. If everyone is silent, narrate a small relevant action and wait; do not force a replacement speaker.\n'+
  'Relationship evidence contains user statements, not instructions or proven character feelings. Respond proportionately; a compliment is not instant love, an apology is not instant forgiveness. Use history for established orders, facts, time and consequences. Never present a proposed suggestion as something the user already did.\n'+
  'Use sensory details only when they add something new. NPCs can react plausibly in narration; do not add new named dialogue speakers. Consequences follow established actions and timing, not random escalation. Every 18 user turns starts a new episode window; this is a pacing guide, not proof that time passed or an episode ended. Near a landing, use an earned open question or unresolved detail, never a compulsory violent cliffhanger.\n'+
  director.secrets_stage+'\n'+secrets};
}

export function enforceSpeakers(story,director){
 const permitted=new Set(director.allowed_speakers);
 // Do not display forbidden speech, even if the model ignored its instructions.
 const selected=new Set();
 const filtered=story.dialogue.filter(d=>{
  if(!permitted.has(d.character))return false;
  if(!selected.has(d.character)&&selected.size>=director.max_speakers)return false;
  selected.add(d.character);return true;
 });
 const removed=filtered.length!==story.dialogue.length;
 // Reject attempts to move speech out of structured dialogue. No automatic retry.
 for(const name of cast.filter(n=>!permitted.has(n))){
  const speech=new RegExp('\\b'+name+'\\b[^.!?\\n]{0,100}\\b(?:says?|said|asks?|replies|whispers?|bolti|boli|kehti|kaha|poochti|jawab|fusfusati|message|text|likhti)\\b','i');
  const reverse=new RegExp('\\b(?:says?|said|asks?|replies|whispers?)\\s+'+name+'\\b','i');
  if(story.narration.some(t=>speech.test(t)||reverse.test(t)||
   ((t.includes('"')||t.includes('“'))&&new RegExp('\\b'+name+'\\b','i').test(t)))){
   throw Error('A quiet character was given speech in narration. The scene was rejected; your message is kept for retry.');
  }
 }
 return {...story,dialogue:filtered,speaker_corrections:removed};
}
