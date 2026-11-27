// Story-specific casting: supporting roles must belong to this setting.
const policies={
 cafe:{setting:'Present-day Mumbai cafe',roles:['Customer','Neighbour','Delivery Rider','Friend','Police Officer','Paramedic','Doctor','Firefighter']},
 train:{setting:'Present-day fictional Indian overnight train, coach C7',roles:['Passenger','Train Guard','Station Staff','Police Officer','Paramedic','Doctor']},
 mythology:{setting:'Ancient mythological world',roles:['Traveller','Guard','Healer','Messenger']},
 horror:{setting:'Present-day haunted house',roles:['Neighbour','Friend','Police Officer','Paramedic','Doctor','Caretaker']}
};
const aliases={police:'Police Officer',officer:'Police Officer',cop:'Police Officer','police officer':'Police Officer',
 'police officers':'Police Officer',inspector:'Police Officer',constable:'Police Officer',
 'ambulance staff':'Paramedic','ambulance worker':'Paramedic',medic:'Paramedic',paramedic:'Paramedic',
 doctor:'Doctor',customer:'Customer',bystander:'Customer',neighbour:'Neighbour',neighbor:'Neighbour',
 shopkeeper:'Neighbour','delivery rider':'Delivery Rider','delivery boy':'Delivery Rider',friend:'Friend',
 firefighter:'Firefighter',traveller:'Traveller',guard:'Guard',healer:'Healer',messenger:'Messenger',caretaker:'Caretaker',
 passenger:'Passenger','train guard':'Train Guard','station staff':'Station Staff','railway police':'Police Officer'};
const crossover=/\b(?:iron\s*man|thanos|salman\s*khan|batman|superman|spider[ -]?man)\b/i;
export function worldPolicy(kind='cafe'){
 if(!policies[kind])throw Error('Unknown story setting.');
 return {...policies[kind],roles:[...policies[kind].roles]};
}
export function canonicalCharacter(name){
 if(typeof name!=='string')return null;
 if(/^arohi$/i.test(name.trim()))return 'Arohi';
 if(/^naina$/i.test(name.trim()))return 'Naina';
 return aliases[name.trim().toLowerCase()]||null;
}
const hypothetical=/\b(?:if|agar|suppose|imagine|what if|sapne|dream|movie|film|kahani sunao)\b/i;
const physicalHarm=/\b(?:sir (?:fod|phod) diya|head (?:open|injury)|(?:stabbed|shot|killed|murdered) (?:him|her|someone|a (?:man|woman|customer|person))|(?:usko|use|usse|customer ko|aadmi ko) (?:maar|mar) diya|(?:voh|woh|wo|he|she) (?:mar|maar) gaya|goli (?:maar|mar) di|chaku (?:maar|mar) diya)\b/i;
const forcedContact=/\b(?:forcefully hug|forcibly hug|zabardasti|jabardasti|pakad (?:liya|leta|leta hoon)|force her|force him)\b/i;
const blockedNegation=/\b(?:did not|didn't|never|nahi|nahin|mat)\b/i;
function asserted(text,pattern){
 const unquoted=text.replace(/[“"].*?[”"]/g,'');
 return unquoted.split(/[.!?;\n]+/).some(s=>pattern.test(s)&&!hypothetical.test(s)&&!blockedNegation.test(s));
}
function sceneText(message){
 try{const s=JSON.parse(message.content);return [...(s.narration||[]),...(s.dialogue||[]).flatMap(d=>[...(d.actions||[]),d.text])].join(' ');}
 catch{return '';}
}

export function buildWorld(messages,kind='cafe'){
 const policy=worldPolicy(kind),users=messages.filter(m=>m.role==='user');
 let incident=null,boundary=null,policeCall=null,medicalCall=null,policeSeen=false,medicSeen=false,doctorSeen=false;
 let customerSeen=false,turn=0;
 const evidence=[];
 for(const message of messages){
  if(message.role==='user'){
   turn++;
   const text=message.content;
   if(asserted(text,physicalHarm)){
    incident??={turn,reported:'serious injury or apparent death; not medically confirmed'};
    policeCall??=turn;medicalCall??=turn;
    evidence.push({turn,kind:'reported_violence',text:text.slice(0,300)});
   }
   if(asserted(text,forcedContact)){
    boundary??={turn,reason:'forced physical contact'};
    policeCall??=turn;
    evidence.push({turn,kind:'consent_boundary',text:text.slice(0,300)});
   }
   if(!hypothetical.test(text)&&/\b(?:police|officers?|inspector|constable)\b/i.test(text)&&
    /\b(?:call|bulaya|bulao|bulata|bulayi|bulai|bula li|aa (?:gayi|gaye)|aaye|aate|arrive|arrived|inside|andar)\b/i.test(text))policeCall??=turn;
   if(!hypothetical.test(text)&&/\b(?:ambulance|paramedic|doctor)\b/i.test(text)&&
    /\b(?:call|bulaya|bulao|bulata|bulayi|bulai|aa (?:gayi|gaye)|aaye|aate|arrived)\b/i.test(text))medicalCall??=turn;
   if(!hypothetical.test(text)){
    const arrived=/\b(?:aa (?:gaye|gayi|gaya)|arrived|enters?|andar (?:aaye|aate|hai)|lead .* inside)\b/i;
    if(/\b(?:police|officers?|inspector)\b/i.test(text)&&arrived.test(text))policeSeen=true;
    if(/\b(?:ambulance|paramedic|medic)\b/i.test(text)&&arrived.test(text))medicSeen=true;
    if(/\bdoctor\b/i.test(text)&&arrived.test(text))doctorSeen=true;
   }
   if(/\b(?:customers?|bystanders?|bheed)\b/i.test(text))customerSeen=true;
   if((incident||boundary)&&/\b(?:mazak|majak|prank|joke|surprise|cake)\b/i.test(text)){
    evidence.push({turn,kind:'claimed_retraction_not_resolution',text:text.slice(0,300)});
   }
  }else{
   const text=sceneText(message);
   // Existing transcripts may predate the structured NPC cast.
   const arrival=/\b(?:andar (?:aate|aaye|aa|aata)|pahunch|arriv|enter|maujood|khad[aei])\w*/i;
   if(/\b(?:police|officers?|inspector|constable)\b/i.test(text)&&arrival.test(text))policeSeen=true;
   if(/\b(?:paramedic|ambulance staff|medic)\b/i.test(text)&&arrival.test(text))medicSeen=true;
   if(/\bdoctor\b/i.test(text)&&arrival.test(text))doctorSeen=true;
   try{
    for(const d of JSON.parse(message.content).dialogue||[]){
     const role=canonicalCharacter(d.character);
     if(role==='Police Officer')policeSeen=true;
     if(role==='Paramedic')medicSeen=true;
     if(role==='Doctor')doctorSeen=true;
    }
   }catch{}
  }
 }
 const latest=users.at(-1)?.content||'',elapsed=/\b(?:kuch (?:der|waqt) baad|minutes? later|after .*minutes?|time skip)\b/i.test(latest);
 const policePresent=policeSeen||(policeCall!==null&&(turn-policeCall>=2||elapsed));
 const medicPresent=medicSeen||(medicalCall!==null&&(turn-medicalCall>=2||elapsed));
 const hospital=/\b(?:hospital|clinic|aspatal|doctor se|doctor ko|doctor,|doctor aaye|doctor aa)\b/i.test(latest);
 const doctorPresent=doctorSeen||(hospital&&medicalCall!==null&&(medicPresent||turn>medicalCall));
 const allowed=policy.roles.filter(role=>{
  if(role==='Police Officer')return policePresent;
  if(role==='Paramedic')return medicPresent;
  if(role==='Doctor')return doctorPresent;
  if(role==='Firefighter')return /\b(?:fire|aag|smoke|dhua)\b/i.test(latest);
  if(role==='Customer')return customerSeen;
  if(role==='Neighbour')return Boolean(incident)||/\b(?:neighbour|neighbor|pados|shopkeeper|dukan)\b/i.test(latest);
  if(role==='Delivery Rider')return /\b(?:delivery|courier|parcel|supplies)\b/i.test(latest);
  if(role==='Friend')return /\b(?:friend|dost)\b/i.test(latest);
  return false;
 });
 // An arrival is a story beat after intervening turns, not a real dispatch ETA.
 const phase=incident?(medicPresent?'responders_present':turn===incident.turn?'call_for_help':'help_en_route'):
  policePresent?'police_present':medicPresent||doctorPresent?'medical_present':policeCall!==null?'police_requested':'ordinary';
 const required=[];
 if(incident&&phase==='call_for_help')required.push(customerSeen?'Customer':'Neighbour');
 if(policePresent&&(!policeSeen||/\b(?:police|officers?|complaint|case|inspector)\b/i.test(latest)))required.push('Police Officer');
 if(medicPresent&&!doctorPresent&&((incident&&!medicSeen)||/\b(?:ambulance|paramedic|medic|mar gaya|maar gaya|unconscious)\b/i.test(latest)))required.push('Paramedic');
 if(doctorPresent&&((incident&&!doctorSeen)||/\bdoctor\b/i.test(latest)))required.push('Doctor');
 const requestedRole=Object.entries(aliases).find(([label,role])=>allowed.includes(role)&&
  (latest.toLowerCase().startsWith(label+',')||latest.toLowerCase().startsWith(label+' kuch bole')))?.[1];
 if(requestedRole&&!required.includes(requestedRole))required.push(requestedRole);
 return {setting:policy.setting,kind,phase,incident,boundary,police_requested:policeCall!==null,
  medical_requested:medicalCall!==null,police_present:policePresent,medic_present:medicPresent,doctor_present:doctorPresent,
  allowed_roles:allowed,required_speakers:required.filter(r=>allowed.includes(r)),
  crossover_request:crossover.test(latest),requested_contact:/\b(?:hug|embrace|gale lag|baahon)\b/i.test(latest),
  party_reset_requested:Boolean(incident)&&/\b(?:cake|confetti|surprise|party|prank|mazak|majak)\b/i.test(latest),evidence:evidence.slice(-12),
  trust:boundary?'boundaries_breached':incident?'serious_concern':'develop_from_history'};
}

const essential={
 Customer:{actions:['Ek customer phone nikaalkar police aur ambulance ki madad maangta hai.'],text:'Yahan kisi ko chot lagi hai. Maine police aur ambulance dono ke liye madad maangi hai.'},
 Neighbour:{actions:['Shor sunkar pados ki dukaan se ek vyakti darwaaze par aata hai aur madad bulata hai.'],text:'Maine police aur ambulance ke liye madad maangi hai. Yahan kisi ko chot lagi hai.'},
 'Police Officer':{actions:['Kuch waqt baad pahuncha police officer scene ko dekhta hai.'],text:'Yahan kya hua? Main gawahon ki baat bhi sununga. Pehle medical team ko apna kaam karne dein.'},
 Paramedic:{actions:['Pahunchi medical team haalat ka jaayza leti hai.'],text:'Hum assessment kar rahe hain. Abhi kisi ki haalat ka nateeja maanna theek nahi hoga.'},
 Doctor:{actions:['Doctor medical assessment ki jaankari leta hai.'],text:'Main jaanch ke baad hi haalat ke baare mein kuch keh sakta hoon.'},
 Passenger:{actions:['Passenger tumhari baat sunne ke liye mudta hai.'],text:'Aap kuch poochhna chahte hain? Batayiye.'},
 'Train Guard':{actions:['Guard coach tak aakar staff radio uthata hai.'],text:'Main agle station ke staff ko khabar kar raha hoon. Aap mujhe batayein, yahan kya hua?'},
 'Station Staff':{actions:['Platform par station staff baat sunne ke liye rukta hai.'],text:'Aap is coach se aaye hain? Bataiye, kis baat mein madad chahiye?'},
 Friend:{actions:['Tumhara dost tumhari taraf mudta hai.'],text:'Main tumhari baat sun raha hoon. Kya hua?'},
 'Delivery Rider':{actions:['Delivery rider darwaaze ke paas rukta hai.'],text:'Delivery kahan rakhni hai?'},
 Firefighter:{actions:['Firefighter mauke par haalat ka jaayza leta hai.'],text:'Yahan kya hua? Kya koi abhi andar hai?'}
};
export function ensureWorldBeats(story,world){
 const corrections=[];
 const wrongMedical=/\b(?:ambulance (?:nahi|nahin|ki zaroorat nahi)|no ambulance|does not need an ambulance)\b/i;
 let dialogue=story.dialogue.filter(d=>!(world.incident&&wrongMedical.test(d.text)));
 let narration=[...story.narration],characterActions=[...(story.character_actions||[])];
 const impossibleArrival=t=>crossover.test(t)&&/\b(?:arriv\w*|enters?|lands?|aa (?:gaya|gaye|gayi)|andar aata|pahunch\w*)\b/i.test(t);
 const before=narration.length;
 narration=narration.filter(t=>!impossibleArrival(t));
 if(narration.length!==before){
  narration.push((world.kind==='train'?'Train':'Café')+' ki is duniya mein yeh baat ek kalpana reh jaati hai; scene apne maujooda logon ke saath aage badhta hai.');
  corrections.push('removed_out_of_world_arrival');
 }
 dialogue=dialogue.filter(d=>!impossibleArrival(d.text));
 characterActions=characterActions.filter(a=>!impossibleArrival(a.text));
 if(dialogue.length!==story.dialogue.length)corrections.push('removed_unassessed_medical_claim');
 if((world.boundary||world.incident)&&world.requested_contact){
  const mainCast=world.main_cast||['Arohi','Naina'];
  dialogue=dialogue.filter(d=>!mainCast.includes(d.character));
  narration=narration.filter(t=>!/\b(?:hug|gale|baahon|embrace|kandhe|sparsh)\b/i.test(t));
  characterActions=characterActions.filter(a=>!mainCast.includes(a.character));
  characterActions.push({character:mainCast[0],text:mainCast[0]+' apni doori banaye rakhti hai. Pichhli ghatna ke baad uski marzi ko waqt aur jagah chahiye.'});
  corrections.push('preserved_contact_boundary');
 }
 if(world.party_reset_requested){
  narration=narration.filter(t=>!/\b(?:clap|clapping|muskur|happy|confetti|cake|party|surprise)\w*/i.test(t));
  narration.push('Surprise keh dene se pehle ki ghatna nahi badalti; madad aur jo hua uski jaanch abhi zaroori hai.');
  dialogue=dialogue.filter(d=>!/\b(?:happy opening|congratulations|sab theek|sab kuch theek)\b/i.test(d.text));
  corrections.push('preserved_incident_after_retraction');
 }
 for(const role of world.required_speakers){
  if(!dialogue.some(d=>d.character===role)){
   const entry=world.essential_lines?.[role]||essential[role];
   if(entry){dialogue.push({character:role,...entry});corrections.push('essential_response:'+role);}
  }
 }
 const priority=world.required_speakers.map(role=>dialogue.find(d=>d.character===role)).filter(Boolean);
 dialogue=[...priority,...dialogue.filter(d=>!priority.includes(d))].slice(0,8);
 return {...story,narration,character_actions:characterActions,dialogue,world_corrections:corrections};
}
