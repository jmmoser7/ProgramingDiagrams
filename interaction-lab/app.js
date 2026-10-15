(function () {
  'use strict';
  const C=window.InteractionCatalog, M=window.InteractionModel;
  const $=id=>document.getElementById(id), storageKey='feel-interaction-workspace-v1';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state=M.fresh(), storageAvailable=true, stage, batch=[], scope='prototype', selected=[], objects=[], events=[], tab='study', saveTimer, toastTimer, transitioning=false, recoveryRaw=null, recoverySafe=true, loadProblem=false, rangeAnchor=null, presentationMenu=null, presentationTrigger=null, loadedWorkspace=false;
  let workerJobs=[],workerResolutions=[],workerAvailable=false,workerPolling=false,workerTimer=null,workerLastView='',workerWorkspace=null;
  const submitting=new Set();
  const commitFingerprints=new Map();
  const feedbackFingerprints=new Map();
  try {
    const saved=localStorage.getItem(storageKey);recoveryRaw=localStorage.getItem(storageKey+'-recovery');
    if(saved){try{state=M.validate(JSON.parse(saved));loadedWorkspace=true;}catch(error){loadProblem=true;recoveryRaw=saved;try{localStorage.setItem(storageKey+'-recovery',saved);}catch(backupError){recoverySafe=false;}}}
  } catch(error) { storageAvailable=false; }
  if(!loadedWorkspace&&window.InteractionAcceptedPreferences){try{M.seedAcceptedPreferences(state,window.InteractionAcceptedPreferences);}catch(error){console.warn('Accepted prototype preferences could not load:',error.message);}}
  function ensureWorkspaceId(){if(!state.workspaceId)state.workspaceId=typeof window.crypto?.randomUUID==='function'?window.crypto.randomUUID():'feel-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
  ensureWorkspaceId();
  let active=C.cases.find(c=>c.id===state.activeCase)||C.cases[0], category=active.category;
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3400);}
  function save(immediate=false){
    clearTimeout(saveTimer);
    const perform=()=>{if(!recoverySafe){$('save-state').textContent='Previous data protected — export new changes';return;}try{localStorage.setItem(storageKey,JSON.stringify(state));storageAvailable=true;$('save-state').textContent='Drafts saved locally · commit in the sidebar';}catch(error){storageAvailable=false;$('save-state').textContent='Storage unavailable — export to keep changes';}};
    if(immediate)perform();else saveTimer=setTimeout(perform,200);
  }
  function effective(object,c=active){return M.effective(state,c,object);}
  function stageSettings(){return {...effective(),typeFilter:$('type-filter').value};}
  function selectedObjects(){return objects.filter(o=>selected.includes(o.id));}
  function currentTargets(){let targetsObjects=selectedObjects();if(scope==='group'&&targetsObjects.length){const groups=new Set(targetsObjects.map(o=>o.group));targetsObjects=objects.filter(o=>groups.has(o.group));}return M.targets(state,scope,active,batch,targetsObjects);}
  function rememberScene(){if(stage?.serialize)state.scenes[active.id]=stage.serialize();}
  function refreshStage(){stage?.setSettings(stageSettings());}
  function visibleCases(){const query=$('search').value.trim().toLowerCase();return C.cases.filter(c=>c.category===category&&(!query||(c.title+' '+c.gesture+' '+c.expected).toLowerCase().includes(query)));}
  function caseScene(c){return c.id===active.id&&stage?stage.serialize():state.scenes[c.id]||{version:1,objects:window.InteractionStage.makeScene(),selection:[],subSelection:[],camera:{x:0,y:20,zoom:1,orbit:0},pivot:null,idSequence:1};}
  function allScenes(useActive=true){return Object.fromEntries(C.cases.map(c=>[c.id,useActive?caseScene(c):state.scenes[c.id]||{version:1,objects:window.InteractionStage.makeScene(),selection:[],subSelection:[],camera:{x:0,y:20,zoom:1,orbit:0},pivot:null,idSequence:1}]));}
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
  async function digest(value){const bytes=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  async function prepareCommitFingerprints(){if(!window.crypto?.subtle)return;await Promise.all(Object.entries(state.commits).map(async([id,entry])=>{const signature=canonical(entry.snapshot),feedbackSignature=canonical(entry.feedback||[]),cached=commitFingerprints.get(id);if(cached?.signature===signature&&cached.feedbackSignature===feedbackSignature)return;const [hash,feedbackHash]=await Promise.all([digest(signature),digest(feedbackSignature)]);commitFingerprints.set(id,{signature,hash,feedbackSignature,feedbackHash});}));await Promise.all(C.cases.flatMap(c=>M.feedbackForCase(state,c)).map(async n=>{const key=canonical(n);if(!feedbackFingerprints.has(key))feedbackFingerprints.set(key,await digest(key));}));}
  function currentJob(c){const entry=state.commits[c.id],fingerprint=commitFingerprints.get(c.id);if(!entry||workerWorkspace!==state.workspaceId||fingerprint?.signature!==canonical(entry.snapshot)||fingerprint.feedbackSignature!==canonical(entry.feedback||[]))return null;return workerJobs.filter(j=>j.caseId===c.id&&j.revision===entry.revision&&j.commitSavedAt===entry.savedAt&&j.fingerprint===fingerprint.hash&&j.feedbackFingerprint===fingerprint.feedbackHash).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]||null;}
  function feedbackReceipt(c,n){const hash=feedbackFingerprints.get(canonical(n));return workerWorkspace===state.workspaceId&&hash?workerResolutions.find(r=>r.caseId===c.id&&r.feedbackHash===hash):null;}
  function preferenceStatus(c){const result=M.preferenceStatus(state,c,caseScene(c)),job=currentJob(c),pendingFeedback=result.feedback.filter(n=>!feedbackReceipt(c,n));let status=result.state;if(result.committed&&!result.dirty){if(job?.status==='addressed'&&result.feedback.length&&!pendingFeedback.length)status='addressed';else if(pendingFeedback.length)status='review';else if(job?.status==='applied')status='applied';}return {...result,state:status,pendingFeedback,job};}
  function commitTargets(){return batch.length?batch.slice():[active.id];}
  function commitPreferences(ids){rememberScene();M.commitPreferences(state,ids,allScenes());ids.forEach(id=>state.commits[id].backgroundRequested=true);save(true);renderLibrary();renderFeedback();toast(storageAvailable&&recoverySafe?`${ids.length===1?'Interface':ids.length+' interfaces'} locked in with written feedback. Settings apply queued; comments need implementation.`:'Preferences locked for this session. Export the workspace to keep them.');void enqueueCommits(ids);}
  async function workerRequest(url,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(url,{cache:'no-store',...options,signal:controller.signal});if(!response.ok)throw new Error('Background worker unavailable ('+response.status+').');return await response.json();}finally{clearTimeout(timer);}}
  async function acceptWorkerStatus(data,workspaceId){if(workspaceId!==state.workspaceId)return;await prepareCommitFingerprints();if(workspaceId!==state.workspaceId)return;workerAvailable=true;workerWorkspace=workspaceId;workerJobs=Array.isArray(data.jobs)?data.jobs:[];workerResolutions=Array.isArray(data.feedbackResolutions)?data.feedbackResolutions:[];const view=JSON.stringify([workerJobs,workerResolutions,[...feedbackFingerprints.keys()]]);if(view!==workerLastView){workerLastView=view;renderLibrary();renderFeedback();}else renderWorkerStatus();}
  async function enqueueCommits(ids){
    if(!/^https?:$/.test(location.protocol)){workerAvailable=false;renderWorkerStatus();return;}
    const workspaceId=state.workspaceId,commits={};
    for(const id of ids){const entry=state.commits[id],key=id+':'+entry?.savedAt;if(!entry?.backgroundRequested||submitting.has(key))continue;commits[id]={snapshot:entry.snapshot,feedback:entry.feedback||[],revision:entry.revision,savedAt:entry.savedAt};submitting.add(key);}
    if(!Object.keys(commits).length)return;renderWorkerStatus();
    try{const data=await workerRequest('/api/preferences/commits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId,commits})});await acceptWorkerStatus(data,workspaceId);}catch(error){if(workspaceId===state.workspaceId){workerAvailable=false;renderWorkerStatus();}}finally{Object.entries(commits).forEach(([id,entry])=>submitting.delete(id+':'+entry.savedAt));renderWorkerStatus();}
  }
  async function pollWorker(){
    clearTimeout(workerTimer);if(workerPolling)return;if(!/^https?:$/.test(location.protocol)){renderWorkerStatus();return;}workerPolling=true;const workspaceId=state.workspaceId;
    try{const data=await workerRequest('/api/preferences/status?workspaceId='+encodeURIComponent(workspaceId));await acceptWorkerStatus(data,workspaceId);if(workspaceId===state.workspaceId){const missing=Object.keys(state.commits).filter(id=>state.commits[id].backgroundRequested&&!currentJob(C.cases.find(c=>c.id===id)));if(missing.length)await enqueueCommits(missing);}}
    catch(error){if(workspaceId===state.workspaceId){workerAvailable=false;renderWorkerStatus();}}finally{workerPolling=false;workerTimer=setTimeout(()=>void pollWorker(),2500);}
  }
  function renderWorkerStatus(){
    const el=$('worker-status');if(!el)return;const statuses=commitTargets().map(id=>preferenceStatus(C.cases.find(c=>c.id===id))),jobs=statuses.map(s=>s.job).filter(Boolean),failed=jobs.find(j=>j.status==='failed'),pending=statuses.reduce((total,s)=>total+s.pendingFeedback.length,0),unsubmitted=statuses.some(s=>s.feedbackDirty);
    let message='Background worker ready',status='ready';
    if(!/^https?:$/.test(location.protocol)){message='Open the local preview to apply changes in the background.';status='offline';}
    else if(submitting.size){message='Queueing locked-in preferences…';status='working';}
    else if(!workerAvailable){message='Worker offline · requested changes stay saved for retry.';status='offline';}
    else if(failed){message='Checks failed. Update to retry. '+(failed.message||'');status='failed';}
    else if(jobs.some(j=>j.status==='working')){message='Applying prototype preferences and running checks…';status='working';}
    else if(jobs.some(j=>j.status==='queued')){message='Queued for background apply';status='queued';}
    else if(pending){message=`${pending} feedback ${pending===1?'request':'requests'} awaiting implementation.${unsubmitted?' Update to include current feedback in the commit.':' Settings validation does not resolve comments.'}`;status='review';}
    else if(unsubmitted){message='Feedback implementation recorded. Update to include it in the locked revision.';status='ready';}
    else if(jobs.length&&jobs.every(j=>j.status==='addressed')){message='Addressed · feedback implementation recorded and settings verified';status='addressed';}
    else if(jobs.length&&jobs.every(j=>['applied','addressed'].includes(j.status))){message='Settings applied and verified · no unresolved committed feedback';status='applied';}
    else if(jobs.some(j=>j.status==='superseded')){message='A newer revision replaced this request. Update to queue again.';status='queued';}
    el.textContent=message;el.dataset.worker=status;
  }
  function revertPreferences(){
    const ids=commitTargets(),restored=M.restorePreferences(state,ids);transitioning=true;
    for(const[id,geometry]of Object.entries(restored)){if(!geometry)continue;const c=C.cases.find(x=>x.id===id),scene=caseScene(c);scene.objects=geometry;const valid=new Set(geometry.map(o=>o.id));scene.selection=scene.selection.filter(id=>valid.has(id));scene.subSelection=[];state.scenes[id]=scene;if(id===active.id)stage.restore(scene);}
    transitioning=false;objects=stage.getObjects();selected=stage.getSelection();refreshStage();rememberScene();renderLibrary();renderInspector();save(true);toast('Restored the last locked-in preferences.');
  }
  function renderCommitControls(){
    const ids=commitTargets(),statuses=ids.map(id=>preferenceStatus(C.cases.find(c=>c.id===id))),committed=statuses.filter(s=>s.committed),dirty=statuses.filter(s=>s.dirty);
    $('batch-count').textContent=batch.length?`${batch.length} interfaces selected`:'Current interface';
    $('commit-selected').textContent=(committed.length?'Update & lock in':'Commit preferences')+(ids.length>1?` (${ids.length})`:'');
    $('revert-committed').disabled=!statuses.some(s=>s.committed&&s.settingsDirty);
    $('commit-summary').textContent=ids.length===1?(statuses[0].state==='addressed'?`Addressed · revision ${statuses[0].revision}`:statuses[0].state==='applied'?`Settings applied · revision ${statuses[0].revision}`:statuses[0].state==='review'?`Locked in · ${statuses[0].pendingFeedback.length} feedback pending`:statuses[0].state==='committed'?`Locked in · revision ${statuses[0].revision}`:statuses[0].state==='altered'?'Altered · settings or feedback changed. Update to lock them in.':'Unaltered · commit when you are ready.'):`${dirty.length} altered · ${statuses.filter(s=>s.state==='addressed').length} addressed · ${committed.length} committed`;
    renderWorkerStatus();
  }
  function renderLibrary(){
    const query=$('search').value.trim().toLowerCase();
    $('total-count').textContent=C.cases.length;
    $('category-list').innerHTML=C.categories.map(cat=>{const count=C.cases.filter(c=>c.category===cat.id&&(!query||(c.title+' '+c.gesture+' '+c.expected).toLowerCase().includes(query))).length;return `<button class="category-row ${category===cat.id?'active':''}" data-category="${cat.id}" aria-pressed="${category===cat.id}"><span class="category-icon" aria-hidden="true">${cat.icon}</span><span>${cat.name}</span><small>${count.toString().padStart(2,'0')}</small></button>`;}).join('');
    $('category-label').textContent=C.categories.find(c=>c.id===category).name.toUpperCase();
    $('case-list').innerHTML=visibleCases().map(c=>{const s=preferenceStatus(c),label={unaltered:'Unaltered',altered:'Altered',committed:'Locked in',applied:'Settings applied',review:'Feedback pending',addressed:'Addressed'}[s.state],action=s.committed?'Update':'Commit',work=s.state==='committed'&&['queued','working'].includes(s.job?.status)?' · '+s.job.status:s.pendingFeedback.length&&s.state!=='review'?` · ${s.pendingFeedback.length} feedback pending`:'';return `<div class="case-row ${active.id===c.id?'active':''} ${batch.includes(c.id)?'marked':''}" data-state="${s.state}"><input type="checkbox" data-mark="${c.id}" aria-label="Mark ${escape(c.title)} for bulk editing" ${batch.includes(c.id)?'checked':''}><button class="case-open" data-case="${c.id}" aria-current="${active.id===c.id}"><span>${escape(c.title)}</span><small><i class="preference-dot" data-state="${s.state}"></i>${label}${work}</small></button><button class="case-commit" data-commit="${c.id}" aria-label="${action} ${escape(c.title)} preferences" title="${action} and lock in this interface’s current preferences">${action}</button></div>`;}).join('')||'<p class="empty-help">No matching studies in this category. Try another category or search term.</p>';
    renderCommitControls();
  }
  function renderStudy(){
    const cat=C.categories.find(c=>c.id===active.category),source=C.sources[active.source];
    $('study-breadcrumb').textContent='INTERACTION LIBRARY / '+cat.name.toUpperCase();$('study-title').textContent=active.title;$('study-description').textContent=active.gesture;$('study-number').textContent=String(C.cases.indexOf(active)+1).padStart(2,'0');$('study-status').textContent=active.status;$('scene-hint').textContent=active.gesture;
    $('study-panel').innerHTML=`<div class="study-grid"><div><h3>What to look for</h3><p>${escape(active.expected)}</p><h3>Evaluate the feel</h3><p>${escape(active.question)}</p><a class="source-link" href="${escape(source[0])}" target="_blank" rel="noreferrer">${escape(source[1])} ↗</a></div><div><h3>Evidence & fidelity</h3><div class="fidelity">${escape(active.fidelity)}</div><p class="muted" style="margin-top:10px">Live Rhino observations and the full categorized findings are in the <a class="source-link" href="docs/interaction-language/README.md" target="_blank">research report ↗</a>. Every setting here is a lab preset.</p></div></div>`;
    $('feedback-text').value=state.drafts[active.id]||'';renderFeedback();
  }
  function chooseCase(id){
    closePresentationMenu();
    const c=C.cases.find(c=>c.id===id);if(!c)return;
    rememberScene();const savedScene=state.scenes[id];transitioning=true;active=c;state.activeCase=id;category=c.category;selected=[];events=[];
    $('type-filter').value=c.variant==='filter'&&c.category==='subobject'?'subobjects':'all';
    stage.setCase(c);stage.reset();stage.setSettings(stageSettings());
    if(savedScene&&stage.restore){try{stage.restore(savedScene);}catch(error){toast('Saved scene could not be restored; fresh geometry loaded.');}}
    transitioning=false;objects=stage.getObjects();selected=stage.getSelection();renderLibrary();renderStudy();renderInspector();renderEvents();save();
  }
  function inheritedValue(t,key){
    const c=t.cases[0]||active,object=t.objects?.[0];
    const current=effective(object,c);
    if(C.fields[key].section==='Geometry'&&object&&current[key]===undefined)return object[key]??C.fields[key].default;
    return current[key]??C.fields[key].default;
  }
  function valueInfo(targets,key){
    const all=targets.flatMap(t=>t.objects?.length?t.objects.map(object=>effective(object,t.cases[0])[key]??object[key]??C.fields[key].default):t.cases.map(c=>{
      if(t.store==='document')return {...M.defaults,...state.document}[key];
      if(t.store==='categories')return {...M.defaults,...state.document,...state.categories[t.id]}[key];
      return effective(undefined,c)[key];
    }));
    const first=all[0]??C.fields[key].default;
    return {value:first,mixed:all.some(v=>v!==first),override:targets.some(t=>Object.hasOwn(M.bucket(state,t),key))};
  }
  const hoverIcons={none:'<path d="M5 5l14 14M19 5L5 19"/>',outline:'<rect x="4" y="4" width="16" height="16" rx="2"/>',fill:'<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity=".45" stroke="none"/>','outline-fill':'<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity=".25"/>',bounds:'<rect x="2" y="2" width="20" height="20" stroke-dasharray="3 2"/><path d="M7 9l7-3 4 8-9 4z" opacity=".4"/>',corners:'<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',halo:'<circle cx="12" cy="12" r="9" opacity=".2" stroke-width="5"/><rect x="6" y="6" width="12" height="12" rx="2"/>'};
  function presentationChoices(key){
    if(key!=='hoverPresentation')return C.cursorChoices;
    const labels={none:'No highlight',outline:'Outline',fill:'Fill','outline-fill':'Outline + fill',bounds:'Bounding box',corners:'Corner brackets',halo:'Halo'};
    return C.fields[key].options.map(value=>({value,label:labels[value],group:'Geometry feedback',icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${hoverIcons[value]}</svg>`}));
  }
  function closePresentationMenu(restoreFocus=false){
    if(!presentationMenu)return;const key=presentationTrigger?.dataset.presentation;presentationMenu.remove();presentationMenu=null;presentationTrigger?.setAttribute('aria-expanded','false');presentationTrigger=null;if(restoreFocus&&key)$('prop-'+key)?.focus();
  }
  function openPresentationMenu(trigger){
    if(presentationTrigger===trigger){closePresentationMenu(true);return;}
    closePresentationMenu();presentationTrigger=trigger;trigger.setAttribute('aria-expanded','true');
    const key=trigger.dataset.presentation,field=C.fields[key],choices=presentationChoices(key),info=valueInfo(currentTargets(),key),r=trigger.getBoundingClientRect();
    presentationMenu=document.createElement('div');presentationMenu.className='presentation-menu';presentationMenu.setAttribute('aria-label',field.label+' options');
    presentationMenu.style.width=Math.min(340,window.innerWidth-24)+'px';presentationMenu.style.left=Math.max(12,Math.min(r.right-340,window.innerWidth-352))+'px';
    const maxHeight=Math.min(460,window.innerHeight-24);presentationMenu.style.maxHeight=maxHeight+'px';presentationMenu.style.top=Math.max(12,Math.min(r.bottom+6,window.innerHeight-maxHeight-12))+'px';
    presentationMenu.innerHTML=`<div class="presentation-menu-title"><strong>${escape(field.label)}</strong><span>${choices.length} options</span><button type="button" data-close-presentation aria-label="Close presentation menu">×</button></div><div class="presentation-preview" aria-label="Presentation preview"><span class="presentation-icon"></span><span>Hover an option to preview</span><small>Try the cursor here</small></div><input class="presentation-search" type="search" placeholder="Find a presentation…" aria-label="Search ${escape(field.label.toLowerCase())} options"><div class="presentation-option-list" role="listbox" aria-label="${escape(field.label)}"></div>`;
    document.body.append(presentationMenu);
    const list=presentationMenu.querySelector('.presentation-option-list'),search=presentationMenu.querySelector('input'),preview=presentationMenu.querySelector('.presentation-preview');
    function previewChoice(choice){preview.querySelector('.presentation-icon').innerHTML=choice.icon;preview.querySelector('span+span').textContent=choice.label;preview.querySelector('small').textContent=key==='hoverPresentation'?'Geometry feedback style':'Try the cursor here';preview.style.cursor=key==='hoverPresentation'?'default':choice.value;}
    function renderOptions(){const query=search.value.trim().toLowerCase(),shown=choices.filter(c=>(c.label+' '+c.value+' '+c.group).toLowerCase().includes(query));let group='';list.innerHTML=shown.map(c=>{let header='';if(c.group!==group){group=c.group;header=`<div class="presentation-group">${escape(group)}</div>`;}return header+`<button type="button" role="option" aria-selected="${!info.mixed&&c.value===info.value}" data-choice="${escape(c.value)}" aria-label="${escape(c.label)}"><span class="presentation-icon" aria-hidden="true">${c.icon}</span><span>${escape(c.label)}</span>${!info.mixed&&c.value===info.value?'<span class="presentation-check" aria-hidden="true">✓</span>':''}</button>`;}).join('')||'<p class="presentation-no-results">No matching options.</p>';}
    renderOptions();if(!info.mixed){const current=choices.find(c=>c.value===info.value);if(current)previewChoice(current);}
    search.addEventListener('input',renderOptions);
    presentationMenu.addEventListener('mouseover',e=>{const button=e.target.closest('[data-choice]');if(button)previewChoice(choices.find(c=>c.value===button.dataset.choice));});
    presentationMenu.addEventListener('focusin',e=>{const button=e.target.closest('[data-choice]');if(button)previewChoice(choices.find(c=>c.value===button.dataset.choice));});
    presentationMenu.addEventListener('click',e=>{if(e.target.closest('[data-close-presentation]')){closePresentationMenu(true);return;}const button=e.target.closest('[data-choice]');if(!button)return;const value=button.dataset.choice;closePresentationMenu();applyProperty(key,value);$('prop-'+key)?.focus();});
    presentationMenu.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePresentationMenu(true);return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;if(e.target===search&&!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const options=[...list.querySelectorAll('[role=option]')],index=options.indexOf(document.activeElement);if(!options.length)return;let next=e.key==='Home'?0:e.key==='End'?options.length-1:e.key==='ArrowDown'?(index+1)%options.length:(index<=0?options.length-1:index-1);options[next].focus();});
    search.focus();
  }
  function renderInspector(){
    closePresentationMenu();
    const targets=currentTargets(),order=['Timing','Targeting','Cursor','Appearance','Precision','Manipulation','Camera','Geometry'],cursorOrder=['cursorPolicy','idleCursor','hoverCursor','cursorScale','hoverPresentation','hoverOpacity'],keys=M.commonKeys(targets).sort((a,b)=>order.indexOf(C.fields[a].section)-order.indexOf(C.fields[b].section)||(C.fields[a].section==='Cursor'?cursorOrder.indexOf(a)-cursorOrder.indexOf(b):0));
    const scopeLabels={prototype:batch.length?`${batch.length} marked ${batch.length===1?'study':'studies'}`:active.title,document:`All ${C.cases.length} studies · ${C.categories.length} categories`,category:C.categories.find(c=>c.id===active.category).name,object:`${selected.length} selected ${selected.length===1?'object':'objects'}`,group:`${targets.length} geometry ${targets.length===1?'group':'groups'}`};
    $('scope-summary').innerHTML=escape(scopeLabels[scope])+'<span class="scope-help">Only properties supported by every target are shown. Explicit child overrides take precedence.</span>';
    $('object-total').textContent=objects.length;
    $('object-list').innerHTML=objects.map(o=>`<label class="object-row"><input type="checkbox" data-object="${escape(o.id)}" ${selected.includes(o.id)?'checked':''}><span>${escape(o.name)}</span><small>${escape(o.group)}${o.locked?' · locked':''}</small></label>`).join('');
    $('property-count').textContent=keys.length;
    if(!targets.length){$('properties').innerHTML='<p class="empty-help">Select geometry in the scene or object list to tune it. Geometry group scope edits every member of each selected object’s group.</p>';return;}
    let section='';
    $('properties').innerHTML=keys.map(key=>{
      const f=C.fields[key],info=valueInfo(targets,key);let html='';if(section!==f.section){section=f.section;html+=`<h3 class="property-section">${escape(section)}</h3>`;}
      let control='';
      if(['idleCursor','hoverCursor','hoverPresentation'].includes(key)){const choices=presentationChoices(key),choice=choices.find(c=>c.value===info.value)||choices[0];control=`<button id="prop-${key}" class="presentation-trigger" data-presentation="${key}" aria-label="${escape(f.label)}" aria-haspopup="listbox" aria-expanded="false" title="${escape(info.mixed?'Mixed values':choice.label)}"><span class="presentation-icon" aria-hidden="true">${choice.icon}</span><span>${escape(info.mixed?'Mixed':choice.label)}</span><span class="presentation-chevron" aria-hidden="true">⌄</span></button>`;}
      else if(f.type==='enum')control=`<select id="prop-${key}" data-property="${key}" aria-label="${escape(f.label)}">${info.mixed?'<option value="mixed" selected>Mixed</option>':''}${f.options.map(v=>`<option value="${escape(v)}" ${!info.mixed&&v===info.value?'selected':''}>${escape(v)}</option>`).join('')}</select>`;
      else if(f.type==='boolean')control=`<select id="prop-${key}" data-property="${key}" aria-label="${escape(f.label)}"><option value="mixed" ${info.mixed?'selected':''} ${info.mixed?'':'hidden'}>Mixed</option><option value="true" ${!info.mixed&&info.value?'selected':''}>On</option><option value="false" ${!info.mixed&&!info.value?'selected':''}>Off</option></select>`;
      else if(f.type==='color')control=`<input id="prop-${key}" data-property="${key}" type="color" value="${escape(info.value)}" aria-label="${escape(f.label)}${info.mixed?' — mixed':''}" title="${info.mixed?'Mixed values. Choose a color to apply to all.':info.value}">`;
      else control=`<input id="prop-${key}" data-property="${key}" type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${info.mixed?'':info.value}" placeholder="${info.mixed?'Mixed':''}" aria-label="${escape(f.label)}"><span>${f.unit||''}</span>`;
      return html+`<div class="property-row ${['idleCursor','hoverCursor','hoverPresentation'].includes(key)?'presentation-row':''}"><label for="prop-${key}">${escape(f.label)}<small>${info.mixed?'Mixed values':f.section==='Geometry'?'Authored scene value':info.override?'Override at this scope':'Inherited'}</small></label><div class="property-value">${control}</div><button class="property-reset" data-reset="${key}" aria-label="Clear ${escape(f.label)} overrides" title="Clear override" ${info.override?'':'disabled'}>↺</button>${key==='selectionColor'?'<button class="selection-color-global" data-selection-color-all>Use this selection color everywhere</button>':''}</div>`;
    }).join('');
  }
  function applyProperty(key,raw,rerender=true){
    const field=C.fields[key];if(!field)return;
    try{
      const targets=currentTargets(),value=M.apply(state,targets,key,field.type==='boolean'?raw==='true':raw);
      if(key==='hoverPresentation')M.apply(state,targets,'prehighlight',value!=='none');
      if(field.section==='Geometry'){
        targets.forEach(t=>delete M.bucket(state,t)[key]);
        stage.updateObjects([...new Set(targets.flatMap(t=>(t.objects||[]).map(o=>o.id)))],{[key]:value});
      }
      refreshStage();rememberScene();
      if(rerender)renderInspector();else{const row=$('prop-'+key)?.closest('.property-row');if(row){row.querySelector('label small').textContent=field.section==='Geometry'?'Authored scene value':'Override at this scope';row.querySelector('.property-reset').disabled=field.section==='Geometry';}}
      renderLibrary();save();
    }catch(error){toast(error.message);}
  }
  function clearOverrides(key){
    currentTargets().forEach(t=>{const b=M.bucket(state,t);if(key)delete b[key];else Object.keys(b).forEach(k=>delete b[k]);});refreshStage();renderInspector();renderLibrary();save();
  }
  function renderFeedback(){
    const notes=M.feedbackForCase(state,active),status=preferenceStatus(active);$('feedback-count').textContent=notes.length||'';
    $('feedback-progress').textContent=notes.length?`${notes.length-status.pendingFeedback.length} implemented · ${status.pendingFeedback.length} pending.${status.feedbackDirty?' Update / Commit to include current written feedback.':''}`:'Commit includes saved observations and the current draft. Comments stay pending until implemented.';
    $('feedback-list').innerHTML=notes.slice().reverse().map(n=>{const receipt=feedbackReceipt(active,n),submitted=state.commits[active.id]?.feedback?.some(item=>canonical(item)===canonical(n));return `<article class="observation" data-feedback-state="${receipt?'addressed':'pending'}"><strong>${escape(n.verdict)}${n.source==='draft'?' · Draft':''}</strong><span class="feedback-badge">${receipt?'Implemented':submitted?'Pending implementation':'Pending · not committed'}</span><p>${escape(n.text)}</p>${receipt?`<div class="feedback-receipt"><b>${escape(receipt.summary)}</b><small>Checked: ${escape(receipt.checks.join(' · '))}</small></div>`:'<small>Saving settings does not resolve this request.</small>'}</article>`;}).join('')||'<p class="muted">Your observations and implementation results will appear here.</p>';
  }
  function renderEvents(){$('event-list').innerHTML=events.slice(0,60).map(e=>`<li><time>${escape(e.time)}</time><b>${escape(e.type)}</b>${escape(e.status||e.detail||'')}</li>`).join('');}
  let lastHover=0;
  function sceneChange(event){
    $('scene-message').textContent=event.status||event.detail||'Ready';$('cursor-value').textContent=event.cursor||$('scene').style.cursor||'default';
    if(event.selection)selected=event.selection;
    if(event.objects)objects=event.objects;
    $('selection-count').textContent=selected.length+' selected';
    const now=Date.now();if(event.type!=='hover'||now-lastHover>1500){if(event.type==='hover')lastHover=now;events.unshift({time:new Date().toLocaleTimeString(),type:event.type||'input',status:event.status,detail:typeof event.detail==='string'?event.detail:''});if(events.length>120)events.length=120;if(tab==='events')renderEvents();}
    if(stage&&!transitioning&&['selection','subselection','transform','rename','context','history','reset','restore','commit','update','duplicate'].includes(event.type)){
      objects=stage.getObjects();selected=stage.getSelection();
      if(!$('properties').contains(document.activeElement))renderInspector();
      rememberScene();renderLibrary();save();
    }
  }
  function setTab(name){tab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===name)));['study','feedback','events'].forEach(id=>$(id+'-panel').hidden=id!==name);if(name==='events')renderEvents();}
  $('category-list').addEventListener('click',e=>{const button=e.target.closest('[data-category]');if(!button)return;const next=button.dataset.category;if(next!==category){batch=[];const query=$('search').value.trim().toLowerCase(),first=C.cases.find(c=>c.category===next&&(!query||(c.title+' '+c.gesture+' '+c.expected).toLowerCase().includes(query)))||C.cases.find(c=>c.category===next);chooseCase(first.id);}});
  $('case-list').addEventListener('click',e=>{
    const commit=e.target.closest('[data-commit]');if(commit){commitPreferences([commit.dataset.commit]);return;}
    const button=e.target.closest('[data-case]');if(!button)return;const id=button.dataset.case,next=C.cases.find(c=>c.id===id);
    if(e.shiftKey){const ids=visibleCases().map(c=>c.id),anchor=ids.indexOf(rangeAnchor||active.id),end=ids.indexOf(id);batch=[...new Set([...batch,...ids.slice(Math.min(anchor<0?end:anchor,end),Math.max(anchor<0?end:anchor,end)+1)])];scope='prototype';$('scope').value=scope;}
    else if(e.ctrlKey||e.metaKey){const previous=batch.length?batch:[active.id];batch=previous.includes(id)?previous.filter(x=>x!==id):[...previous,id];rangeAnchor=id;scope='prototype';$('scope').value=scope;}
    else{batch=[];rangeAnchor=id;}
    if(active.category!==next.category)batch=[];chooseCase(next.id);
  });
  $('case-list').addEventListener('change',e=>{const id=e.target.dataset.mark;if(!id)return;batch=e.target.checked?[...new Set([...batch,id])]:batch.filter(x=>x!==id);rangeAnchor=id;scope='prototype';$('scope').value=scope;renderLibrary();renderInspector();});
  $('search').addEventListener('input',renderLibrary);
  $('select-visible').addEventListener('click',()=>{batch=visibleCases().map(c=>c.id);scope='prototype';$('scope').value=scope;renderLibrary();renderInspector();});
  $('clear-batch').addEventListener('click',()=>{batch=[];renderLibrary();renderInspector();});
  $('commit-selected').addEventListener('click',()=>commitPreferences(commitTargets()));
  $('revert-committed').addEventListener('click',revertPreferences);
  $('scope').addEventListener('change',e=>{scope=e.target.value;renderInspector();});
  $('object-list').addEventListener('change',e=>{const id=e.target.dataset.object;if(!id)return;const ids=e.target.checked?[...new Set([...selected,id])]:selected.filter(x=>x!==id);stage.setSelection(ids);selected=stage.getSelection();renderInspector();});
  $('properties').addEventListener('change',e=>{const key=e.target.dataset.property;if(!key||e.target.value==='mixed'||e.target.value==='')return;const field=C.fields[key];if(['number','color'].includes(field?.type)){if(field.type==='number')e.target.value=String(Math.max(field.min,Math.min(field.max,Number(e.target.value))));return;}applyProperty(key,e.target.value);});
  $('properties').addEventListener('input',e=>{const key=e.target.dataset.property;if(key&&e.target.value!==''&&['number','color'].includes(C.fields[key]?.type))applyProperty(key,e.target.value,false);});
  $('properties').addEventListener('click',e=>{if(e.target.closest('[data-selection-color-all]')){M.applySelectionColor(state,$('prop-selectionColor').value);refreshStage();renderInspector();renderLibrary();save(true);toast('Selection color applied throughout all lab studies, groups and objects.');return;}const presentation=e.target.closest('[data-presentation]');if(presentation){openPresentationMenu(presentation);return;}const button=e.target.closest('[data-reset]');if(button)clearOverrides(button.dataset.reset);});
  document.addEventListener('pointerdown',e=>{if(presentationMenu&&!presentationMenu.contains(e.target)&&!e.target.closest('[data-presentation]'))closePresentationMenu();});
  window.addEventListener('resize',()=>closePresentationMenu());
  $('reset-overrides').addEventListener('click',()=>{clearOverrides();toast('Overrides cleared for this scope.');});
  $('rhino-preset').addEventListener('click',()=>{Object.assign(state.document,{dragThreshold:12,prehighlight:false,selectionColor:'#ffff00',highlightColor:'#000000',cursorPolicy:'native',idleCursor:'auto',hoverCursor:'auto'});state.categories.gumball={...state.categories.gumball,gumballSize:80};refreshStage();renderInspector();renderLibrary();save();toast('Observed Rhino base applied. Child overrides remain in effect.');});
  $('type-filter').addEventListener('change',refreshStage);
  $('reset-scene').addEventListener('click',()=>{delete state.scenes[active.id];stage.reset();objects=stage.getObjects();selected=stage.getSelection();refreshStage();renderInspector();rememberScene();save();toast('Dummy geometry restored. Tuning presets kept.');});
  $('undo').addEventListener('click',()=>stage.undo());$('redo').addEventListener('click',()=>stage.redo());
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  $('feedback-text').addEventListener('input',()=>{state.drafts[active.id]=$('feedback-text').value;save();renderLibrary();renderFeedback();});
  $('save-feedback').addEventListener('click',()=>{const text=$('feedback-text').value.trim();if(!text){toast('Write an observation first.');return;}rememberScene();state.feedback.push({id:typeof crypto?.randomUUID==='function'?crypto.randomUUID():String(Date.now()),caseId:active.id,createdAt:new Date().toISOString(),text,verdict:$('feedback-verdict').value,scope,prototypeIds:batch.slice(),selection:selected.slice(),settings:effective(),objectSettings:Object.fromEntries(selectedObjects().map(o=>[o.id,effective(o)])),overrides:JSON.parse(JSON.stringify(currentTargets().map(t=>({store:t.store,id:t.id,values:M.bucket(state,t)})))),scene:stage.serialize()});delete state.drafts[active.id];$('feedback-text').value='';save(true);renderLibrary();renderFeedback();toast('Observation saved. Commit / Update to submit it for implementation.');});
  $('clear-events').addEventListener('click',()=>{events=[];renderEvents();});
  $('export-button').addEventListener('click',()=>{rememberScene();save(true);const file={...state,exportedAt:new Date().toISOString(),catalogVersion:C.version};const blob=new Blob([JSON.stringify(file,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='feel-workspace-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Workspace exported with presets, geometry and feedback.');});
  $('import-button').addEventListener('click',()=>$('import-file').click());
  $('recovery-button').hidden=!recoveryRaw;
  $('recovery-button').addEventListener('click',()=>{if(!recoveryRaw)return;const blob=new Blob([recoveryRaw],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='feel-workspace-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Recovery copy downloaded.');});
  $('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5*1024*1024)throw new Error('Use a lab file smaller than 5 MB.');const next=M.validate(JSON.parse(await file.text()));transitioning=true;state=next;ensureWorkspaceId();workerJobs=[];workerLastView='';workerWorkspace=null;batch=[];const c=C.cases.find(c=>c.id===state.activeCase),savedScene=state.scenes[c.id];active=c;category=c.category;M.initializePreferences(state,allScenes(false));stage.setCase(c);stage.reset();stage.setSettings(stageSettings());if(savedScene)stage.restore(savedScene);transitioning=false;objects=stage.getObjects();selected=stage.getSelection();renderLibrary();renderStudy();renderInspector();save(true);toast('Workspace imported.');void pollWorker();}catch(error){transitioning=false;toast('Import failed: '+error.message);}e.target.value='';});
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable=true]'))return;if(e.key==='/'){e.preventDefault();$('search').focus();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();rememberScene();save(true);toast(storageAvailable?'Workspace saved on this device.':'Storage unavailable. Export the workspace to preserve it.');}});
  window.addEventListener('beforeunload',()=>{rememberScene();save(true);});
  M.initializePreferences(state,allScenes(false));
  stage=window.InteractionStage.create({canvas:$('scene'),overlay:$('scene-overlay'),caseStudy:active,settings:stageSettings(),resolveSettings:effective,onChange:sceneChange});
  if(state.scenes[active.id]){try{stage.restore(state.scenes[active.id]);}catch(error){toast('Saved scene invalid; using fresh dummy geometry.');}}
  objects=stage.getObjects();selected=stage.getSelection();renderLibrary();renderStudy();renderInspector();save();
  if(!storageAvailable)$('save-state').textContent='Storage unavailable — export to keep changes';
  if(loadProblem)toast('Previous workspace could not load. A recovery copy is available.');
  void pollWorker();
  window.FeelLab={catalog:C,model:M,getState:()=>JSON.parse(JSON.stringify(state)),getStage:()=>stage,chooseCase};
})();
