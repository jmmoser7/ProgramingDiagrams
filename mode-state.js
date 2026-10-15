'use strict';

// HTTP pages share their saved board. Browsers may isolate localStorage for
// every file:// page, so a transition between views carries a copy
// in the destination fragment. Fragments never go to a web server.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.ProgramModeState = api; api.read(); }
})(typeof window !== 'undefined' ? window : null, function (root) {
  const KEY = 'program-board-v4';
  const MARK = '#pb-mode=';
  const MAX_FRAGMENT = 16 * 1024 * 1024;
  let incoming;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  function valid(state) {
    return !!(state && typeof state === 'object' && state.board &&
      Array.isArray(state.board.rows) && Array.isArray(state.board.stickies) && Array.isArray(state.board.columns));
  }

  function capture(source) {
    const raw = typeof source === 'function' ? source() : source;
    if (raw && typeof raw.flushEdits === 'function') raw.flushEdits();
    const shared = raw && raw.modeState;
    const value = shared || raw;
    if (!value) return null;
    const engine = value.engine || (root && root.ProgramBoard);
    const board = value.board || (value.model && engine && engine.capture(value.model));
    const state = { board: board, view: value.view || {}, camera: Object.prototype.hasOwnProperty.call(value,'camera') ? value.camera : { x: 0, y: 0, z: 1 } };
    if (!valid(state)) return null;
    if (value.ephemeral || (raw && raw.ephemeral) || (root && /[?&](fresh|perf|demo)(?:[=&]|$)/.test(root.location.search))) state.ephemeral = true;
    return clone(state);
  }

  function encode(state) {
    if (!valid(state)) return '';
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 16384));
    return MARK + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(fragment) {
    if (typeof fragment !== 'string' || !fragment.startsWith(MARK) || fragment.length > MAX_FRAGMENT) return null;
    try {
      let text = fragment.slice(MARK.length).replace(/-/g, '+').replace(/_/g, '/');
      text += '='.repeat((4 - text.length % 4) % 4);
      const binary = atob(text);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return valid(state) ? state : null;
    } catch (err) { return null; }
  }

  function persist(state) {
    if (!root || !valid(state) || state.ephemeral) return false;
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (err) { return false; }
  }

  function latest() {
    if (!root) return null;
    try { const state = JSON.parse(root.localStorage.getItem(KEY) || 'null'); return valid(state) ? state : null; } catch (err) { return null; }
  }

  function subscribe(listener) {
    if (!root || typeof root.addEventListener !== 'function') return () => {};
    const handler = event => {
      if (event.key !== KEY || !event.newValue) return;
      try { const state = JSON.parse(event.newValue); if (valid(state)) listener(state); } catch (err) { /* ignore malformed external writes */ }
    };
    root.addEventListener('storage',handler);
    return () => root.removeEventListener('storage',handler);
  }

  // Preserve independent cell/field edits from another view while a local
  // editor was open. On a direct conflict, the committing edit wins. Rows
  // follow stable cell IDs. Imported zero-area rows have no cell yet, so
  // establish their correspondence separately before applying row edits.
  function reconcile(base, local, remote) {
    if (!valid(local)) return valid(remote) ? clone(remote) : null;
    if (!valid(base) || !valid(remote) || local.board.fileName !== base.board.fileName) return clone(local);
    const baselineIds=new Set(base.board.stickies.map(s=>s.id));
    if(baselineIds.size && !local.board.stickies.some(s=>baselineIds.has(s.id)))return clone(local);
    const out = clone(remote), eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    function mergeFields(before, after, target, skip) {
      for (const key of new Set([...Object.keys(before || {}),...Object.keys(after || {})])) {
        if (skip && skip.has(key) || eq(before && before[key],after && after[key])) continue;
        if (after && Object.prototype.hasOwnProperty.call(after,key)) target[key] = clone(after[key]); else delete target[key];
      }
    }
    mergeFields(base.board,local.board,out.board,new Set(['rows','stickies','columns','gradients']));
    out.board.columns = [...new Set([...out.board.columns,...local.board.columns])];
    const before = new Map(base.board.stickies.map(s=>[s.id,s])), current = new Map(out.board.stickies.map(s=>[s.id,s]));
    function rowCorrespondence(board) {
      const matched = new Map(), used = new Set(), cells = new Map(board.stickies.map(s=>[s.id,s]));
      const drawn = new Set(base.board.stickies.map(s=>s.rowIndex));
      function link(index, target) {
        if (!base.board.rows[index] || !board.rows[target] || used.has(target)) return;
        matched.set(index,target);used.add(target);
      }
      const rowId=row=>row && typeof row.id==='string' ? row.id : '';
      const ids=new Map();
      board.rows.forEach((row,index)=>{const id=rowId(row);if(id)ids.set(id,ids.has(id)?null:index);});
      for(let index=0;index<base.board.rows.length;index++){
        const id=rowId(base.board.rows[index]);
        if(id&&ids.has(id)&&ids.get(id)!==null)link(index,ids.get(id));
      }
      for (const old of base.board.stickies) {
        const cell=cells.get(old.id);if(cell&&!matched.has(old.rowIndex))link(old.rowIndex,cell.rowIndex);
      }
      // Saved boards with row IDs never infer a missing row's identity from
      // its contents. The fallback below supports snapshots predating IDs.
      const hasRowIds=board.rows.some(row=>rowId(row));
      const pending=base.board.rows.map((row,index)=>index).filter(index=>!drawn.has(index)&&!matched.has(index)&&(!rowId(base.board.rows[index])||!hasRowIds));
      const available=()=>board.rows.map((row,index)=>index).filter(index=>!used.has(index));
      const fields=index=>base.board.rows[index].fields || {};
      const nameKey=base.board.nameKey;
      const sameName=(index,target)=>nameKey && fields(index)[nameKey] !== '' && fields(index)[nameKey] != null && eq(fields(index)[nameKey],board.rows[target].fields[nameKey]);
      const sameRow=(index,target)=>Object.keys(fields(index)).every(key=>eq(fields(index)[key],board.rows[target].fields[key]))&&!!base.board.rows[index].dropped===!!board.rows[target].dropped;
      const score=(index,target)=>Object.keys(fields(index)).reduce((sum,key)=>sum+(key!==base.board.areaKey&&fields(index)[key]!==''&&fields(index)[key]!=null&&eq(fields(index)[key],board.rows[target].fields[key])?(key===nameKey?4:1):0),0);
      // A plain table edit keeps indices. Only use that shortcut when the
      // cell anchors and identifiable omitted rows also show no insertion
      // or sorting; a remote duplicate can otherwise occupy the old index.
      const samePositions=base.board.rows.length===board.rows.length && base.board.stickies.every(s=>cells.has(s.id)&&cells.get(s.id).rowIndex===s.rowIndex);
      const movedRow=pending.some(index=>{
        const candidates=available(),exact=candidates.filter(target=>sameRow(index,target)),names=candidates.filter(target=>sameName(index,target));
        const best=Math.max(0,...candidates.map(target=>score(index,target))),metadata=candidates.filter(target=>score(index,target)===best);
        return exact.length===1&&exact[0]!==index || names.length===1&&names[0]!==index || best>0&&metadata.length===1&&metadata[0]!==index;
      });
      if(samePositions&&!movedRow)for(const index of pending)link(index,index);
      for (const index of pending) {
        if(matched.has(index))continue;
        const matches=available().filter(target=>sameRow(index,target));
        if(matches.length===1)link(index,matches[0]);
      }
      for (const index of pending) {
        if(matched.has(index))continue;
        const matches=available().filter(target=>sameName(index,target));
        if(matches.length===1)link(index,matches[0]);
      }
      // When both sides changed a dormant row's name, other authored
      // metadata can still identify it. Require a unique best match in
      // both directions; shared empty fields and zero areas are not IDs.
      for (const index of pending) {
        if(matched.has(index))continue;
        const candidates=available(), best=Math.max(0,...candidates.map(target=>score(index,target)));
        const targets=candidates.filter(target=>score(index,target)===best);
        if(!best||!targets.length)continue;
        const target=targets[0], peers=pending.filter(other=>!matched.has(other)&&score(other,target)>=best);
        if(peers.length!==1)continue;
        if(targets.length===1){link(index,target);continue;}
        // An activated cell precedes its copies in the cell list, even
        // when row sorting changes their order. Resolve only identical
        // new-cell candidates belonging to one identifiable source row.
        const candidatesByCreation=board.stickies.filter(cell=>targets.includes(cell.rowIndex)&&!before.has(cell.id));
        if(candidatesByCreation.length===targets.length&&targets.every(other=>eq(board.rows[other],board.rows[target])))link(index,candidatesByCreation[0].rowIndex);
      }
      return matched;
    }
    const localRows=rowCorrespondence(local.board), remoteRows=rowCorrespondence(out.board), rowTargets=new Map();
    for(const [index,localIndex] of localRows){
      const targetIndex=remoteRows.get(index);if(targetIndex===undefined)continue;
      const oldRow=base.board.rows[index],row=local.board.rows[localIndex],targetRow=out.board.rows[targetIndex];
      rowTargets.set(localIndex,targetIndex);
      mergeFields(oldRow.fields,row.fields,targetRow.fields);
      mergeFields(oldRow,row,targetRow,new Set(['fields']));
    }
    for (const s of local.board.stickies) {
      const old = before.get(s.id), row = local.board.rows[s.rowIndex];
      if (!old) {
        if (!current.has(s.id)) {
          const copy=clone(s);
          if(rowTargets.has(s.rowIndex)){
            copy.rowIndex=rowTargets.get(s.rowIndex);
            // Concurrent activations of the same omitted row are one cell;
            // the committing activation keeps its locally assigned ID.
            out.board.stickies=out.board.stickies.filter(cell=>{
              if(cell.rowIndex!==copy.rowIndex||before.has(cell.id))return true;
              current.delete(cell.id);return false;
            });
          }else{
            copy.rowIndex=out.board.rows.length;out.board.rows.push(clone(row));rowTargets.set(s.rowIndex,copy.rowIndex);
          }
          out.board.stickies.push(copy);current.set(copy.id,copy);
        }
        continue;
      }
      const target = current.get(s.id); if (!target) continue;
      mergeFields(old,s,target,new Set(['rowIndex']));
    }
    out.board.gradients = out.board.gradients || {};
    mergeFields(base.board.gradients || {},local.board.gradients || {},out.board.gradients);
    out.view = out.view || {};mergeFields(base.view || {},local.view || {},out.view);
    if(!eq(base.camera,local.camera))out.camera=clone(local.camera);
    return out;
  }

  // Returns a fragment so navigation also works when storage is blocked.
  function store(state) {
    if (!valid(state)) return '';
    persist(state);
    return encode(state);
  }

  function read() {
    if (incoming !== undefined) return incoming;
    incoming = null;
    if (!root || !root.location.hash.startsWith(MARK)) return incoming;
    incoming = decode(root.location.hash);
    if (incoming) persist(incoming);
    try {
      root.history.replaceState(null, '', root.location.pathname + root.location.search);
    } catch (err) {
      // Some browsers disallow replaceState on file origins. The fragment
      // still provides the board and remains usable on reload.
    }
    return incoming;
  }

  function href(target, state) {
    if (!root) return target + (valid(state) ? encode(state) : '');
    const url = new URL(target, root.location.href);
    // State handoff is only for our three sibling views, never a remote URL.
    if (!/\/(index|iso|pack)\.html$/.test(url.pathname) || new URL('.', url).href !== new URL('.', root.location.href).href) return url.href;
    if (!valid(state)) return url.href;
    const stored = persist(state);
    if (state.ephemeral) url.searchParams.set('fresh', '');
    if (root.location.protocol === 'file:' || url.protocol === 'file:' || !stored || state.ephemeral) url.hash = encode(state);
    return url.href;
  }

  return { capture: capture, store: store, read: read, href: href, encode: encode, decode: decode, latest: latest, readLatest: latest, subscribe: subscribe, reconcile: reconcile };
});
