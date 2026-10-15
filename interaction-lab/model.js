(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./catalog.js'):root.InteractionCatalog);if(typeof module==='object'&&module.exports)module.exports=api;else root.InteractionModel=api;})(typeof window==='object'?window:globalThis,function(C){
  'use strict';
  const defaults=Object.fromEntries(Object.entries(C.fields).filter(([,f])=>f.section!=='Geometry').map(([k,f])=>[k,f.default]));
  const forbidden=new Set(['__proto__','constructor','prototype']);
  function fresh(){return {version:1,workspaceId:null,document:{},categories:{},prototypes:{},groups:{},objects:{},feedback:[],drafts:{},scenes:{},commits:{},preferenceBaselines:{},activeCase:'gumball-move'};}
  function intersection(arrays){return arrays.length?arrays[0].filter(k=>arrays.every(a=>a.includes(k))):[];}
  function effective(state,c,object){return {...defaults,...c.defaults,...state.document,...state.categories[c.category],...state.prototypes[c.id],...(object?state.groups[c.id+':'+object.group]:{}),...(object?state.objects[c.id+':'+object.id]:{})};}
  function targets(state,scope,c,ids,objects){
    const studies=(ids.length?ids:[c.id]).map(id=>C.cases.find(x=>x.id===id)).filter(Boolean);
    if(scope==='document')return [{store:'document',id:null,cases:C.cases}];
    if(scope==='category')return [{store:'categories',id:c.category,cases:C.cases.filter(x=>x.category===c.category)}];
    if(scope==='prototype')return studies.map(x=>({store:'prototypes',id:x.id,cases:[x]}));
    if(scope==='group')return [...new Set(objects.map(o=>o.group))].map(id=>({store:'groups',id:c.id+':'+id,cases:[c],objects:objects.filter(o=>o.group===id)}));
    return objects.map(o=>({store:'objects',id:c.id+':'+o.id,cases:[c],objects:[o]}));
  }
  function commonKeys(targets){
    const sets=targets.map(t=>intersection(t.cases.map(C.keysFor)));
    let keys=intersection(sets);
    if(targets.length&&targets.every(t=>t.objects)){
      keys=keys.filter(key=>!['gridSize','ortho','orthoAngle','zoomSpeed'].includes(key));
      const obs=targets.flatMap(t=>t.objects);
      keys=keys.concat(['locked']);
      if(obs.every(o=>o.kind==='box'||o.kind==='circle'))keys=keys.concat(['width','height']);
      if(obs.every(o=>o.kind==='box'))keys=keys.concat(['depth','cornerRadius']);
    }
    return keys;
  }
  function bucket(state,t,create=false){if(t.store==='document')return state.document;if(!['categories','prototypes','groups','objects'].includes(t.store)||forbidden.has(t.id))throw new Error('Invalid settings target.');if(!Object.hasOwn(state[t.store],t.id)&&create)state[t.store][t.id]={};return Object.hasOwn(state[t.store],t.id)?state[t.store][t.id]:{};}
  function apply(state,targets,key,value){
    if(!commonKeys(targets).includes(key))throw new Error('Property is not shared by these targets.');
    const field=C.fields[key];
    if(field.type==='number'){value=Number(value);if(!Number.isFinite(value))throw new Error('Enter a finite number.');value=Math.max(field.min,Math.min(field.max,value));}
    if(field.type==='boolean')value=!!value;
    if(field.type==='color'&&!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Use a six-digit color.');
    if(field.type==='enum'&&!field.options.includes(value))throw new Error('Choose a supported '+field.label.toLowerCase()+'.');
    targets.forEach(t=>bucket(state,t,true)[key]=value);
    return value;
  }
  function applySelectionColor(state,color){
    if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Use a six-digit selection color.');
    // This explicit global preference replaces only authored color overrides;
    // ordinary scoped edits still preserve child overrides through apply().
    const buckets=[state.document];
    for(const store of ['categories','prototypes','groups','objects'])for(const values of Object.values(state[store]))if(Object.hasOwn(values,'selectionColor'))buckets.push(values);
    buckets.forEach(values=>values.selectionColor=color);
    return color;
  }
  function cleanBucket(raw){const result={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;for(const [key,value]of Object.entries(raw)){if(forbidden.has(key)||!Object.hasOwn(C.fields,key))continue;const f=C.fields[key];if(f.section==='Geometry')continue;if(f.type==='number'&&typeof value==='number'&&Number.isFinite(value))result[key]=Math.max(f.min,Math.min(f.max,value));if(f.type==='boolean'&&typeof value==='boolean')result[key]=value;if(f.type==='color'&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))result[key]=value;if(f.type==='enum'&&f.options.includes(value))result[key]=value;}return result;}
  function safeData(value,depth=0){
    if(depth>12)return null;
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(typeof value==='string')return value.slice(0,20000);
    if(Array.isArray(value))return value.slice(0,2000).map(item=>safeData(item,depth+1));
    if(value&&typeof value==='object'){const result={};for(const[key,item]of Object.entries(value).slice(0,500))if(!forbidden.has(key))result[key]=safeData(item,depth+1);return result;}
    return null;
  }
  function cleanScene(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||!Array.isArray(raw.objects)||raw.objects.length>500)throw new Error('Invalid scene. Expected version 1 and at most 500 objects.');
    const finite=(value,label,min=-1e7,max=1e7)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid scene '+label+'.');return value;};
    const point=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid scene '+label+'.');return{x:finite(value.x,label+' x'),y:finite(value.y,label+' y')};};
    const ids=new Set();
    const objects=raw.objects.map((o,index)=>{
      if(!o||typeof o!=='object'||Array.isArray(o)||typeof o.id!=='string'||!o.id.length||o.id.length>160||forbidden.has(o.id)||ids.has(o.id))throw new Error('Invalid or duplicate scene object ID at '+index+'.');
      if(!['box','circle','polyline'].includes(o.kind))throw new Error('Unsupported scene geometry kind.');
      ids.add(o.id);
      const result={id:o.id,name:typeof o.name==='string'?o.name.slice(0,160):'Imported object',group:typeof o.group==='string'?o.group.slice(0,160):'Imported',kind:o.kind,x:finite(o.x,'x'),y:finite(o.y,'y'),width:finite(o.width,'width',1,1e6),height:finite(o.height,'height',1,1e6),depth:finite(o.depth??0,'depth',0,1e6),rotation:finite(o.rotation??0,'rotation',-1e9,1e9),color:typeof o.color==='string'&&/^#[0-9a-f]{6}$/i.test(o.color)?o.color:'#c7d8e4',locked:o.locked===true};
      if(o.cornerRadius!==undefined)result.cornerRadius=finite(o.cornerRadius,'corner radius',0,1e6);
      if(o.kind==='polyline'){if(!Array.isArray(o.points)||o.points.length<2||o.points.length>2000)throw new Error('Invalid scene polyline points.');result.points=o.points.map((p,i)=>point(p,'polyline point '+i));}
      return result;
    });
    if(raw.selection!==undefined&&!Array.isArray(raw.selection))throw new Error('Invalid scene selection.');
    const selection=[...new Set((raw.selection||[]).filter(id=>typeof id==='string'&&ids.has(id)))];
    const subSelection=Array.isArray(raw.subSelection)?raw.subSelection.filter(s=>s&&ids.has(s.objectId)&&['vertex','edge','face'].includes(s.kind)&&Number.isInteger(s.index)&&s.index>=0&&s.index<10000).slice(0,2000).map(s=>({key:s.objectId+':'+s.kind+':'+s.index,objectId:s.objectId,kind:s.kind,index:s.index})):[];
    const c=raw.camera||{x:0,y:20,zoom:1,orbit:0};
    const camera={x:finite(c.x,'camera x'),y:finite(c.y,'camera y'),zoom:Math.max(.18,Math.min(7,finite(c.zoom,'camera zoom',Number.MIN_VALUE,1e6))),orbit:finite(c.orbit??0,'camera orbit',-1e9,1e9)};
    return{version:1,objects,selection,subSelection,camera,pivot:raw.pivot==null?null:point(raw.pivot,'pivot'),idSequence:Number.isSafeInteger(raw.idSequence)&&raw.idSequence>0?Math.min(raw.idSequence,1e9):1};
  }
  function preferenceBucket(raw,c,withDefaults=false){
    const values=withDefaults?{...defaults,...c.defaults,...cleanBucket(raw)}:cleanBucket(raw);
    return Object.fromEntries(C.keysFor(c).filter(key=>Object.hasOwn(values,key)).map(key=>[key,values[key]]));
  }
  function preferenceOverrides(raw,c,local=false){
    const result={},prefix=c.id+':';
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
    for(const key of Object.keys(raw).sort()){
      if(!local&&!key.startsWith(prefix))continue;
      const id=local?key:key.slice(prefix.length);
      if(!id.length||id.length>160||forbidden.has(id))continue;
      result[id]=preferenceBucket(raw[key],c);
    }
    return result;
  }
  function preferenceSnapshot(state,c,scene){
    if(!C.cases.some(item=>item.id===c?.id))throw new Error('Unknown interface.');
    const authored=scene===undefined?state.scenes?.[c.id]:scene;
    return{settings:preferenceBucket(effective(state,c),c),groups:preferenceOverrides(state.groups,c),objects:preferenceOverrides(state.objects,c),geometry:authored==null?null:cleanScene({version:1,objects:authored.objects}).objects};
  }
  function cleanPreferenceSnapshot(raw,c){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!raw.settings||typeof raw.settings!=='object'||Array.isArray(raw.settings))return null;
    return{settings:preferenceBucket(raw.settings,c,true),groups:preferenceOverrides(raw.groups,c,true),objects:preferenceOverrides(raw.objects,c,true),geometry:raw.geometry==null?null:cleanScene({version:1,objects:raw.geometry}).objects};
  }
  function seedAcceptedPreferences(state,data){
    if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==1||!data.cases||typeof data.cases!=='object'||Array.isArray(data.cases))throw new Error('Invalid accepted preferences. Expected version 1 and an interface dictionary.');
    const pending=preferenceCases(Object.keys(data.cases)).map(c=>{
      const snapshot=cleanPreferenceSnapshot(data.cases[c.id],c);if(!snapshot)throw new Error('Invalid accepted preference snapshot for '+c.id+'.');
      let scene=null;
      if(snapshot.geometry!==null){
        const used=new Set(snapshot.geometry.map(o=>Number(/-(\d+)$/.exec(o.id)?.[1])).filter(n=>Number.isSafeInteger(n)&&n>0&&n<=1e9));
        let next=Math.max(0,...used)+1;if(next>1e9)next=1;while(used.has(next))next++;
        scene=cleanScene({version:1,objects:snapshot.geometry,idSequence:next});
      }
      return{c,snapshot,scene};
    });
    // Accepted presets are starting values; existing authored overrides always survive.
    for(const{c,snapshot,scene}of pending){
      state.prototypes[c.id]={...snapshot.settings,...state.prototypes[c.id]};
      for(const store of ['groups','objects'])for(const[id,values]of Object.entries(snapshot[store])){const key=c.id+':'+id;state[store][key]={...values,...state[store][key]};}
      if(scene&&!Object.hasOwn(state.scenes,c.id))state.scenes[c.id]=scene;
    }
    return pending.length;
  }
  function preferenceCases(ids){
    if(!Array.isArray(ids))throw new Error('Choose interfaces to commit.');
    return [...new Set(ids)].map(id=>{const c=C.cases.find(item=>item.id===id);if(!c)throw new Error('Unknown interface.');return c;});
  }
  function feedbackId(value,index,used){
    let id=typeof value==='string'&&/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(value)&&!forbidden.has(value)?value:'legacy-feedback-'+index;
    if(used.has(id)){id='legacy-feedback-'+index;while(used.has(id))id+='-copy';}used.add(id);return id;
  }
  function cleanFeedback(raw){
    if(!Array.isArray(raw))return [];
    const used=new Set();return raw.slice(0,2000).filter(n=>n&&typeof n.text==='string'&&n.text.trim()).map((n,index)=>({id:feedbackId(n.id,index,used),text:n.text.trim().slice(0,20000),verdict:['Needs tuning','Feels right','Needs native comparison'].includes(n.verdict)?n.verdict:'Needs tuning',source:n.source==='draft'?'draft':'saved'}));
  }
  function feedbackForCase(state,c){
    const notes=(state.feedback||[]).filter(n=>n.caseId===c.id||n.prototypeIds?.includes(c.id));
    const result=cleanFeedback(notes);
    if(typeof state.drafts?.[c.id]==='string'&&state.drafts[c.id].trim())result.push({id:'draft:'+c.id,text:state.drafts[c.id].trim().slice(0,20000),verdict:'Needs tuning',source:'draft'});
    return cleanFeedback(result);
  }
  function commitPreferences(state,caseIds,scenes){
    const studies=preferenceCases(caseIds),savedAt=new Date().toISOString();
    // Validate the entire batch before replacing any accepted preference.
    const pending=studies.map(c=>[c.id,{snapshot:preferenceSnapshot(state,c,scenes?.[c.id]),feedback:feedbackForCase(state,c),revision:(Number.isSafeInteger(state.commits?.[c.id]?.revision)?state.commits[c.id].revision:0)+1,savedAt,backgroundRequested:false}]);
    if(!state.commits)state.commits={};
    const result={};for(const[id,entry]of pending){state.commits[id]=entry;result[id]=JSON.parse(JSON.stringify(entry));}return result;
  }
  function initializePreferences(state,scenes){
    const pending=C.cases.filter(c=>!state.preferenceBaselines?.[c.id]).map(c=>[c.id,preferenceSnapshot(state,c,scenes?.[c.id])]);
    if(!state.preferenceBaselines)state.preferenceBaselines={};
    for(const[id,snapshot]of pending)state.preferenceBaselines[id]=snapshot;
    return pending.length;
  }
  function preferenceStatus(state,c,scene){
    const entry=state.commits?.[c.id];
    const current=preferenceSnapshot(state,c,scene),baseline=entry?.snapshot||state.preferenceBaselines?.[c.id]||preferenceSnapshot(fresh(),c,scene);
    const settingsDirty=JSON.stringify(current)!==JSON.stringify(baseline),feedback=feedbackForCase(state,c),feedbackDirty=JSON.stringify(feedback)!==JSON.stringify(entry?.feedback||[]),dirty=settingsDirty||feedbackDirty;
    return{committed:!!entry,dirty,settingsDirty,feedbackDirty,feedback,revision:entry?.revision||0,savedAt:entry?.savedAt||null,state:dirty?'altered':entry?'committed':'unaltered'};
  }
  function restorePreferences(state,caseIds){
    const studies=preferenceCases(caseIds),geometry={};
    for(const c of studies){
      const entry=state.commits?.[c.id];if(!entry)continue;
      const snapshot=cleanPreferenceSnapshot(entry.snapshot,c);if(!snapshot)continue;
      state.prototypes[c.id]={...snapshot.settings};
      for(const store of ['groups','objects']){
        const prefix=c.id+':';for(const key of Object.keys(state[store]))if(key.startsWith(prefix))delete state[store][key];
        for(const[id,values]of Object.entries(snapshot[store]))state[store][prefix+id]={...values};
      }
      geometry[c.id]=snapshot.geometry;
    }
    return geometry;
  }
  function validate(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1)throw new Error('Unsupported lab file. Expected version 1.');
    const state=fresh();state.document=cleanBucket(raw.document);
    if(typeof raw.workspaceId==='string'&&/^[a-z0-9_-]{1,100}$/i.test(raw.workspaceId)&&!forbidden.has(raw.workspaceId))state.workspaceId=raw.workspaceId;
    ['categories','prototypes','groups','objects'].forEach(store=>{if(raw[store]&&typeof raw[store]==='object'&&!Array.isArray(raw[store]))for(const [key,value]of Object.entries(raw[store]))if(!forbidden.has(key)&&key.length<340&&(store==='categories'?C.categories.some(c=>c.id===key):store==='prototypes'?C.cases.some(c=>c.id===key):C.cases.some(c=>key.startsWith(c.id+':'))))state[store][key]=cleanBucket(value);});
    const feedbackIds=new Set();state.feedback=Array.isArray(raw.feedback)?raw.feedback.filter(n=>n&&typeof n.text==='string'&&C.cases.some(c=>c.id===n.caseId)).slice(-2000).map((n,index)=>({...safeData(n),id:feedbackId(n.id,index,feedbackIds),caseId:n.caseId,text:n.text.slice(0,20000),prototypeIds:Array.isArray(n.prototypeIds)?n.prototypeIds.filter(id=>C.cases.some(c=>c.id===id)):[],createdAt:typeof n.createdAt==='string'&&Number.isFinite(Date.parse(n.createdAt))?n.createdAt:null,verdict:['Needs tuning','Feels right','Needs native comparison'].includes(n.verdict)?n.verdict:'Needs tuning',scope:['document','category','prototype','group','object'].includes(n.scope)?n.scope:'prototype',selection:Array.isArray(n.selection)?n.selection.filter(id=>typeof id==='string').slice(0,500):[]})):[];
    if(C.cases.some(c=>c.id===raw.activeCase))state.activeCase=raw.activeCase;
    for(const c of C.cases){if(typeof raw.drafts?.[c.id]==='string')state.drafts[c.id]=raw.drafts[c.id].slice(0,20000);const scene=raw.scenes?.[c.id];if(scene!==undefined)state.scenes[c.id]=cleanScene(scene);const commit=raw.commits?.[c.id];if(commit&&Number.isSafeInteger(commit.revision)&&commit.revision>0&&typeof commit.savedAt==='string'&&Number.isFinite(Date.parse(commit.savedAt))){const snapshot=cleanPreferenceSnapshot(commit.snapshot,c);if(snapshot)state.commits[c.id]={snapshot,feedback:cleanFeedback(commit.feedback),revision:commit.revision,savedAt:new Date(commit.savedAt).toISOString(),backgroundRequested:commit.backgroundRequested===true};}const baseline=cleanPreferenceSnapshot(raw.preferenceBaselines?.[c.id],c);if(baseline)state.preferenceBaselines[c.id]=baseline;}
    return state;
  }
  return {fresh,defaults,intersection,effective,targets,commonKeys,bucket,apply,applySelectionColor,validate,cleanScene,seedAcceptedPreferences,cleanFeedback,feedbackForCase,preferenceSnapshot,commitPreferences,initializePreferences,preferenceStatus,restorePreferences};
});
