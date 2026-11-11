const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('backup-data.js', 'utf8');
const PREFIX = 'framenote:v1:video:';
const STATE = 'framenote:backup:state';
const SETTINGS = 'framenote:backup:settings';
function note(id = 'note-1', text = 'Hello') {
  return { id, text, caption: 'Subtitles', timeSeconds: 12.3,
    createdAt: '2026-11-11T09:00:00.000Z', updatedAt: '2026-11-11T09:00:00.000Z' };
}
function video(notes = [note()]) {
  return { videoId: 'testVideo01', title: 'A video', url: 'https://www.youtube.com/watch?v=testVideo01',
    updatedAt: '2026-11-11T09:00:00.000Z', notes };
}
function data() {
  const context = vm.createContext({ TextEncoder, URL });
  vm.runInContext(fs.readFileSync('media-info.js', 'utf8'), context);
  vm.runInContext(source, context);
  return context.FrameNoteData;
}
const D = data();
test('legacy single-video, library, and versioned backups restore Unicode, captions and fractional timestamps', () => {
  const v = video([note('one', 'Olá 👋 <script>')]);
  for (const value of [v, [v], { format: 'framenote-backup', version: 1, videos: [v] }]) {
    const parsed = D.parse(JSON.stringify(value));
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [v]);
  }
});
test('validates the entire file and canonicalizes untrusted URLs', () => {
  for (const invalid of ['bad json', '{}', JSON.stringify([video(), { nope: true }]),
    JSON.stringify(video([note(), note()])), JSON.stringify(video([{ ...note(), timeSeconds: -1 }])),
    JSON.stringify(video([{ ...note(), updatedAt: 'invalid' }])),
    JSON.stringify({ format: 'framenote-backup', version: 2, videos: [] })]) assert.throws(() => D.parse(invalid));
  assert.throws(() => D.parse(' '.repeat(D.MAX_BYTES + 1)), /20 MB/);
  const parsed = D.parse(JSON.stringify({ ...video(), url: 'javascript:alert(1)' }));
  assert.equal(parsed[0].url, video().url);
});
test('merge is idempotent, adds missing notes, and preserves conflicting current notes', () => {
  const existing = video([note(), note('local', 'Local only')]);
  const incoming = video([note('note-1', 'Older content'), note('new', 'Imported')]);
  const result = D.merge({ [PREFIX + existing.videoId]: existing }, D.parse(JSON.stringify(incoming)));
  assert.equal(result.summary.added, 1);
  assert.equal(result.summary.conflicts, 1);
  const merged = result.writes[PREFIX + existing.videoId];
  assert.equal(merged.notes.length, 3);
  assert.equal(merged.notes[0].text, 'Hello');
  const again = D.merge(result.writes, D.parse(JSON.stringify(incoming)));
  assert.equal(again.summary.added, 0);
  assert.equal(again.summary.duplicates, 1);
  assert.equal(Object.keys(again.writes).length, 0);
});
function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
function worker(seed = {}, options = {}) {
  const store = structuredClone(options.fresh ? seed : { [SETTINGS]: { enabled: true }, ...seed }), files = options.files || new Map(), downloads = options.downloads || [], alarms = new Map();
  let clock = new Date(options.time || '2026-11-11T09:00:00Z').getTime();
  let failDownload = false, cancelManual = false, holdManual = false, releaseManual, manualReadyResolve;
  const manualReady = new Promise(resolve=>{manualReadyResolve=resolve});
  const changes = event();
  const chrome = {
    storage: { onChanged: changes, local: {
      async get(key) {
        if (key === null) return structuredClone(store);
        const names = Array.isArray(key) ? key : [key];
        return structuredClone(Object.fromEntries(names.map(name=>[name,store[name]])));
      },
      async set(writes) {
        const diff = Object.fromEntries(Object.entries(writes).map(([key,value])=>[key,{oldValue:store[key],newValue:structuredClone(value)}]));
        Object.assign(store,structuredClone(writes));
        for(const listener of changes.listeners) listener(diff,'local');
      }
    } },
    alarms: { onAlarm:event(),async get(name){return alarms.get(name)},async create(name,config){alarms.set(name,config)} },
    downloads: { onChanged:event(),
      async download(request) {
        if(failDownload) throw new Error('Disk unavailable');
        if(request.saveAs && cancelManual) throw new Error('User cancelled');
        const create = () => {
          let filename = (request.saveAs ? '/Chosen/Manual/' : '/Downloads/') + request.filename;
          if(request.conflictAction==='uniquify') {
            const original=filename;let n=1;
            while(files.has(filename)||downloads.some(d=>d.filename===filename&&d.state==='in_progress')) filename=original.replace(/\.json$/,` (${n++}).json`);
          }
          const id=downloads.reduce((n,d)=>Math.max(n,d.id),0)+1;
          downloads.push({id,byExtensionId:'extension-id',filename,state:'in_progress',exists:true,url:request.url,request});
          return id;
        };
        if(request.saveAs&&holdManual) return new Promise(resolve=>{releaseManual=()=>resolve(create());manualReadyResolve()});
        return create();
      },
      async search(query) {
        let found=downloads.filter(d=>!d.hidden && (query.id===undefined||query.id===d.id) && (!query.state||query.state===d.state) && (query.exists===undefined||query.exists===d.exists) && (!query.filenameRegex||new RegExp(query.filenameRegex).test(d.filename)));
        if(query.limit) found=found.slice(0,query.limit);
        return structuredClone(found);
      }
    },
    runtime:{id:'extension-id',onInstalled:event(),onStartup:event(),onMessage:event(),getURL:p=>`chrome-extension://extension-id/${p}`,async openOptionsPage(){}},
    action:{onClicked:event()},tabs:{async sendMessage(){}}
  };
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
  const context=vm.createContext({chrome,console:{...console,warn(){}},TextEncoder,URL,crypto:webcrypto,Date:ClockDate,setTimeout});
  context.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(name,'utf8'),context));
  vm.runInContext(fs.readFileSync('background.js','utf8'),context);
  async function idle(){let previous;do{previous=vm.runInContext('queue',context);await previous}while(previous!==vm.runInContext('queue',context))}
  async function emit(target,value){for(const listener of target.listeners)listener(value);await idle()}
  async function complete(id){
    const item=downloads.find(d=>d.id===id);item.state='complete';files.set(item.filename,decodeURIComponent(item.url.split(',')[1]));
    await emit(chrome.downloads.onChanged,{id,state:{current:'complete'}});
  }
  async function finishAll(){await idle();for(let n=0;n<20;n++){const item=downloads.find(d=>d.state==='in_progress');if(!item)return;await complete(item.id)}throw new Error('Backup loop')}
  function send(type,fields={},fromOptions=true){return new Promise(resolve=>{const sender={id:chrome.runtime.id,url:fromOptions?chrome.runtime.getURL('options.html'):'https://www.youtube.com/watch?v=testVideo01'};const handled=chrome.runtime.onMessage.listeners[0]({type,...fields},sender,resolve);if(!handled)resolve(undefined)})}
  return {chrome,store,files,downloads,alarms,idle,emit,send,complete,finishAll,
    time(value){clock=new Date(value).getTime()},fail(value=true){failDownload=value},cancel(value=true){cancelManual=value},hold(){holdManual=true},async waitForManual(){await manualReady},release(){releaseManual()}};
}
const CURRENT='/Downloads/FrameNote/framenote-current.json';
const MONTHLY='/Downloads/FrameNote/framenote-2026-11.json';
test('automatic downloads replace the current file after edits and preserve the monthly snapshot',async()=>{
  const original=video(),w=worker({[PREFIX+original.videoId]:original});
  await w.emit(w.chrome.runtime.onInstalled,{});
  assert.equal(w.downloads.length,1);assert.equal(w.store[STATE].lastSuccess,undefined);
  assert.equal(w.downloads[0].request.saveAs,false);assert.equal(w.downloads[0].request.conflictAction,'uniquify');
  await w.finishAll();assert.equal(w.files.size,2);
  const monthly=w.files.get(MONTHLY),current=w.files.get(CURRENT);
  w.time('2026-11-12T09:00:00Z');
  assert.equal((await w.send('FRAMENOTE_SAVE',{baseline:original,record:video([note(),note('new','Second note')])},false)).ok,true);
  await w.finishAll();
  assert.equal(w.files.size,2);assert.notEqual(w.files.get(CURRENT),current);assert.equal(w.files.get(MONTHLY),monthly);
  assert.equal(JSON.parse(w.files.get(CURRENT)).videos[0].notes.length,2);
  assert.equal(w.downloads.at(-1).request.conflictAction,'overwrite');
  const count=w.downloads.length;w.time('2026-11-13T09:00:00Z');await w.emit(w.chrome.alarms.onAlarm,{name:'framenote:backup:check'});
  assert.equal(w.downloads.length,count,'unchanged library must not create daily snapshots');
});
test('first active run of a new month snapshots the whole library without edits; missed months are not fabricated',async()=>{
  const w=worker({[PREFIX+'testVideo01']:video()});await w.emit(w.chrome.runtime.onStartup,{});await w.finishAll();
  const current=w.files.get(CURRENT);w.time('2026-12-01T09:00:00Z');await w.emit(w.chrome.alarms.onAlarm,{name:'framenote:backup:check'});await w.finishAll();
  assert.equal(w.files.size,3);assert.equal(w.files.get(CURRENT),current);assert.ok(w.files.has('/Downloads/FrameNote/framenote-2026-12.json'));
  w.time('2027-02-06T09:00:00Z');await w.emit(w.chrome.runtime.onStartup,{});await w.finishAll();assert.equal(w.files.size,4);assert.equal(w.files.has('/Downloads/FrameNote/framenote-2027-01.json'),false);
});
test('first-use filenames preserve older backups and later writes update the numbered current file',async()=>{
  const files=new Map([[CURRENT,'old current'],[MONTHLY,'old monthly']]);
  const original=video(),w=worker({[PREFIX+original.videoId]:original},{files});await w.emit(w.chrome.runtime.onStartup,{});await w.finishAll();
  assert.equal(files.get(CURRENT),'old current');assert.equal(files.get(MONTHLY),'old monthly');
  assert.equal(w.store[STATE].currentName,'framenote-current (1).json');
  await w.send('FRAMENOTE_SAVE',{baseline:original,record:video([note('updated')])},false);await w.finishAll();
  assert.equal(files.size,4);assert.equal(JSON.parse(files.get('/Downloads/FrameNote/framenote-current (1).json')).videos[0].notes[0].id,'updated');
});
test('fresh empty installs do not create or overwrite backups; deliberate deletion can empty an established current backup',async()=>{
  const empty=worker();await empty.emit(empty.chrome.runtime.onStartup,{});assert.equal(empty.downloads.length,0);
  const original=video(),w=worker({[PREFIX+original.videoId]:original});await w.emit(w.chrome.runtime.onStartup,{});await w.finishAll();const monthly=w.files.get(MONTHLY);
  await w.send('FRAMENOTE_SAVE',{baseline:original,record:video([])},false);await w.finishAll();assert.equal(JSON.parse(w.files.get(CURRENT)).videos[0].notes.length,0);assert.equal(w.files.get(MONTHLY),monthly);
});
test('history can recover a monthly snapshot across reinstalls; missing history alone does not cause repeated snapshots',async()=>{
  const seed={[PREFIX+'testVideo01']:video()},first=worker(seed);await first.emit(first.chrome.runtime.onStartup,{});await first.finishAll();
  const next=worker(seed,{files:first.files,downloads:first.downloads});await next.emit(next.chrome.runtime.onStartup,{});await next.finishAll();
  assert.equal(next.downloads.filter(d=>d.request.filename.includes('2026-11')).length,1);
  const count=next.downloads.length;next.downloads.forEach(d=>d.hidden=true);await next.emit(next.chrome.alarms.onAlarm,{name:'framenote:backup:check'});assert.equal(next.downloads.length,count);
});
test('failed downloads report errors only after failure and retry after five minutes',async()=>{
  const w=worker({[PREFIX+'testVideo01']:video()});await w.emit(w.chrome.runtime.onStartup,{});
  w.downloads[0].state='interrupted';w.downloads[0].error='FILE_NO_SPACE';await w.emit(w.chrome.downloads.onChanged,{id:1,state:{current:'interrupted'}});
  assert.equal(w.store[STATE].lastSuccess,undefined);assert.match(w.store[STATE].error,/FILE_NO_SPACE/);assert.equal(w.downloads.length,1);
  w.time('2026-11-11T09:06:00Z');await w.emit(w.chrome.alarms.onAlarm,{name:'framenote:backup:check'});await w.finishAll();assert.equal(w.store[STATE].error,null);
  w.fail();assert.equal((await w.send('FRAMENOTE_BACKUP_NOW')).ok,false);assert.match(w.store[STATE].error,/Disk unavailable/);
});
test('worker restart resumes an outstanding download and backs up edits made while it was downloading',async()=>{
  const first=worker({[PREFIX+'testVideo01']:video()});await first.emit(first.chrome.runtime.onStartup,{});
  first.store[PREFIX+'testVideo01']=video([note(),note('queued')]);
  const next=worker(first.store,{downloads:first.downloads,files:first.files});await next.emit(next.chrome.runtime.onStartup,{});assert.equal(next.downloads.length,1);await next.finishAll();
  assert.equal(JSON.parse(next.files.get(CURRENT)).videos[0].notes.length,2);assert.ok(next.alarms.has('framenote:backup:check'));
});
test('manual backup always requests Save As, works when automatic backups are off, and tracks completion separately',async()=>{
  const w=worker({[PREFIX+'testVideo01']:video(),[SETTINGS]:{enabled:false}});await w.emit(w.chrome.runtime.onStartup,{});assert.equal(w.downloads.length,0);
  const response=await w.send('FRAMENOTE_MANUAL_BACKUP');assert.equal(response.ok,true);assert.equal(w.downloads[0].request.saveAs,true);assert.equal(w.downloads[0].request.filename.includes('/'),false);
  assert.equal(w.store['framenote:backup:manual'].lastSuccess,undefined);await w.finishAll();assert.ok(w.store['framenote:backup:manual'].lastSuccess);assert.equal(w.store[STATE].lastSuccess,undefined);assert.match(w.store['framenote:backup:manual'].filename,/^\/Chosen\/Manual\//);
  assert.equal(await w.send('FRAMENOTE_MANUAL_BACKUP',{},false),undefined);
});
test('cancelling Save As does not change automatic backup state or create a file',async()=>{
  const w=worker({[PREFIX+'testVideo01']:video()});await w.emit(w.chrome.runtime.onStartup,{});await w.finishAll();const before=JSON.stringify(w.store[STATE]),count=w.files.size;
  w.cancel();assert.equal((await w.send('FRAMENOTE_MANUAL_BACKUP')).value.cancelled,true);assert.equal(JSON.stringify(w.store[STATE]),before);assert.equal(w.files.size,count);
});
test('an open manual Save As dialog does not block saving annotations', {timeout:3000}, async()=>{
  const original=video(),w=worker({[PREFIX+original.videoId]:original,[SETTINGS]:{enabled:false}});w.hold();const manual=w.send('FRAMENOTE_MANUAL_BACKUP');await w.waitForManual();
  const saved=await w.send('FRAMENOTE_SAVE',{baseline:original,record:video([note(),note('during-dialog')])},false);assert.equal(saved.ok,true);assert.equal(w.store[PREFIX+original.videoId].notes.length,2);
  w.release();assert.equal((await manual).ok,true);
});
test('imports remain non-destructive and concurrent saves merge before the downloaded snapshot',async()=>{
  const original=video(),w=worker({[PREFIX+original.videoId]:original});
  assert.equal((await w.send('FRAMENOTE_IMPORT',{text:JSON.stringify([original,{}])})).ok,false);assert.equal(w.store[PREFIX+original.videoId].notes.length,1);
  await Promise.all([w.send('FRAMENOTE_IMPORT',{text:JSON.stringify(video([note('imported')]))}),w.send('FRAMENOTE_SAVE',{baseline:original,record:video([note('note-1','Edited'),note('new')])},false)]);await w.finishAll();
  assert.equal(JSON.parse(w.files.get(CURRENT)).videos[0].notes.length,3);
  const restored=worker({[SETTINGS]:{enabled:false}});assert.equal((await restored.send('FRAMENOTE_IMPORT',{text:w.files.get(CURRENT)})).value.added,3);
});

test('web media backups retain tab titles, nearby headings and safe per-player identities', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync('media-info.js', 'utf8'), context);
  const M = context.FrameNoteMedia;
  const url = 'https://course.example/lesson?chapter=3#section';
  const player = { frame: 'top', key: 'video:id:lesson', source: 'https://cdn.example/movie.mp4' };
  const v = { ...video(), videoId: M.webId(url, player), source: 'web', url, player,
    pageTitle: 'Course title', heading: 'Chapter three', title: 'Chapter three · Course title' };
  const restored = D.parse(JSON.stringify({ format: 'framenote-backup', version: 1, videos: [v] }))[0];
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), v);
  assert.notEqual(M.webId(url, player), M.webId(url, { ...player, key: 'audio:id:podcast' }));
  assert.notEqual(M.webId(url, player), M.webId('https://other.example/lesson', player));
  const link = M.timestampURL(v, 42.5);
  assert.equal(M.pageURL(link), url);
  assert.equal(new URL(link).hash, '#section');
  assert.equal(new URL(link).searchParams.get('chapter'), '3');
  assert.equal(new URL(link).searchParams.get('framenote'), `${v.videoId}:42.5`);
  assert.equal(M.youtubeId('https://notyoutube.example/watch?v=testVideo01'), null);
  assert.equal(M.youtubeId('https://www.youtube.com/watch?v=testVideo01&t=12s'), 'testVideo01');
  for (const invalid of [
    { ...v, url: 'javascript:alert(1)' }, { ...v, url: 'file:///private/notes' },
    { ...v, url: 'https://user:password@course.example/lesson' },
    { ...v, videoId: 'web:0000000000000000' }, { ...v, player: null }
  ]) assert.throws(() => D.parse(JSON.stringify(invalid)));
});


test('fresh installs default to no automatic downloads until explicitly enabled; saved opt-in survives reload',async()=>{
  const w=worker({[PREFIX+'testVideo01']:video()},{fresh:true});
  await w.emit(w.chrome.runtime.onStartup,{});
  await w.send('FRAMENOTE_IMPORT',{text:JSON.stringify(video([note('imported')]))});
  await w.idle();
  await w.emit(w.chrome.alarms.onAlarm,{name:'framenote:backup:check'});
  assert.equal(w.downloads.length,0);
  assert.equal((await w.send('FRAMENOTE_MANUAL_BACKUP')).ok,true);
  await w.finishAll();
  assert.equal(w.downloads.length,1);
  assert.equal(w.downloads[0].request.saveAs,true);
  assert.equal((await w.send('FRAMENOTE_BACKUP_SETTINGS',{enabled:true})).ok,true);
  await w.finishAll();
  assert.ok(w.files.has(CURRENT));
  const reloaded=worker(w.store,{fresh:true,files:w.files,downloads:w.downloads});
  assert.equal(reloaded.store[SETTINGS].enabled,true);
  await reloaded.emit(reloaded.chrome.runtime.onStartup,{});
  assert.equal(reloaded.store[SETTINGS].enabled,true);
});

test('turning automatic backups off persists through reload and prevents later scheduled/annotation downloads',async()=>{
  const original=video(),w=worker({[PREFIX+original.videoId]:original});
  await w.emit(w.chrome.runtime.onStartup,{});await w.finishAll();
  assert.equal((await w.send('FRAMENOTE_BACKUP_SETTINGS',{enabled:false})).ok,true);
  const before=w.downloads.length;
  const reloaded=worker(w.store,{fresh:true,files:w.files,downloads:w.downloads});
  await reloaded.emit(reloaded.chrome.runtime.onStartup,{});
  await reloaded.send('FRAMENOTE_SAVE',{baseline:original,record:video([note(),note('after-reload')])},false);
  await reloaded.idle();
  await reloaded.emit(reloaded.chrome.alarms.onAlarm,{name:'framenote:backup:check'});
  assert.equal(reloaded.store[SETTINGS].enabled,false);
  assert.equal(reloaded.downloads.length,before);
});
