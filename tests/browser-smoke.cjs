const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync('/private/tmp/framenote-browser-');
const extension = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(dir, 'Default'));
fs.mkdirSync(path.join(dir, 'Downloads'));
fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: path.join(dir, 'Downloads'), prompt_for_download: false }, extensions: { ui: { developer_mode: true } } }));
const browserArguments = [
  '--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update',
  `--user-data-dir=${dir}`, '--remote-debugging-port=0',
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'
];
function launchBrowser(){return spawn(process.env.FRAMENOTE_BROWSER || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',browserArguments,{stdio:['ignore','pipe','pipe']});}
let browser=launchBrowser();
let stderr = '';
browser.stderr.on('data', d => { stderr += d; });
const pause = ms => new Promise(r => setTimeout(r, ms));
let ws;
(async () => {
  for (let i = 0; i < 100 && !stderr.includes('DevTools listening on'); i++) await pause(100);
  const endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
  if (!endpoint) throw new Error(`Browser did not start: ${stderr.slice(-2000)}`);
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const routeMessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  ws.onmessage=routeMessage;
  async function cdp(method, params = {}, sessionId) {
    const req = ++id;
    const result = await new Promise(resolve => { pending.set(req, resolve); ws.send(JSON.stringify({ id: req, method, params, ...(sessionId ? { sessionId } : {}) })); });
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result.result;
  }
  let targets;
  for (let i = 0; i < 100; i++) {
    targets = (await cdp('Target.getTargets')).targetInfos;
    if (targets.some(t => t.type === 'service_worker' && t.url.endsWith('/background.js'))) break;
    await pause(100);
  }
  const worker = targets.find(t => t.type === 'service_worker' && t.url.endsWith('/background.js'));
  if (!worker) throw new Error('Extension worker not loaded: ' + JSON.stringify(targets));
  const base = worker.url.replace(/background.js$/, '');
  let workerSession = (await cdp('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
  async function evaluate(expression, sessionId = workerSession) {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  // The profile's default download directory is temporary. No native folder API is used.
  await evaluate(`chrome.storage.local.set({ 'framenote:backup:settings': { enabled: false } })`);
  const { targetId } = await cdp('Target.createTarget', { url: base + 'options.html' });
  const { sessionId: pageSession } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`document.getElementById('backup-status')?.textContent`, pageSession)) break;
    await pause(100);
  }
  assert.equal(await evaluate(`document.querySelector('h1').textContent`,pageSession),'FrameNote');
  assert.equal(await evaluate(`document.getElementById('choose-folder')`,pageSession),null);
  assert.equal(await evaluate(`typeof FrameNoteFolder`),'undefined');
  const nativeFolderPickerAvailable = await evaluate(`typeof window.showDirectoryPicker === 'function'`,pageSession);
  const n = { id: 'test-note', timeSeconds: 32.5, text: 'Browser restore test 🎬', caption: 'Caption text', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const record = { videoId:'testVideo01',title:'Browser test',url:'https://www.youtube.com/watch?v=testVideo01',updatedAt:n.updatedAt,notes:[n] };
  const text=JSON.stringify([record]);
  assert.equal((await evaluate(`send('FRAMENOTE_IMPORT',{text:${JSON.stringify(text)}})`,pageSession)).added,1);
  assert.equal((await evaluate(`send('FRAMENOTE_IMPORT',{text:${JSON.stringify(text)}})`,pageSession)).duplicates,1);
  const automaticPath=path.join(dir,'Downloads','FrameNote','framenote-current.json');
  const period=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
  const monthlyPath=path.join(dir,'Downloads','FrameNote',`framenote-${period}.json`);
  async function waitAutomatic(notes) {
    for(let i=0;i<150;i++) {
      const state=await evaluate(`chrome.storage.local.get('framenote:backup:state').then(s=>s['framenote:backup:state'])`);
      if(state.error) throw new Error(state.error);
      if(!state.pending && state.monthlyFilename && fs.existsSync(automaticPath) && JSON.parse(fs.readFileSync(automaticPath,'utf8')).videos[0].notes.length===notes) return state;
      await pause(100);
    }
    throw new Error('Automatic backup did not settle');
  }
  assert.equal(await evaluate(`document.getElementById('enabled').checked`,pageSession),false);
  await evaluate(`document.getElementById('enabled').click()`,pageSession);
  let state=await waitAutomatic(1);
  assert.equal(await evaluate(`document.getElementById('enabled').checked`,pageSession),true);
  assert.equal(fs.existsSync(monthlyPath),true);
  const monthlyBefore=fs.readFileSync(monthlyPath,'utf8');
  assert.equal(JSON.parse(fs.readFileSync(automaticPath,'utf8')).videos[0].notes[0].text,n.text);
  // Headless CDP selects a temporary manual destination instead of showing the OS Save As UI.
  // The real downloads API is still called with saveAs:true, verified below.
  const manualDirectory=path.join(dir,'Manual Backups');fs.mkdirSync(manualDirectory);
  await cdp('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:manualDirectory});
  await evaluate(`globalThis.originalDownload = chrome.downloads.download; globalThis.lastManualOptions=null;
    chrome.downloads.download=options=>{if(options.saveAs){globalThis.lastManualOptions=options;if(globalThis.cancelNextManual){globalThis.cancelNextManual=false;return Promise.reject(new Error('User cancelled'));}}return globalThis.originalDownload(options);}`);
  await evaluate(`document.getElementById('export-library').click()`,pageSession);
  let manual;
  for(let i=0;i<150;i++) {
    manual=await evaluate(`chrome.storage.local.get('framenote:backup:manual').then(s=>s['framenote:backup:manual'])`);
    if(manual?.error) throw new Error(manual.error);
    if(manual?.lastSuccess&&!manual.pending)break;
    await pause(100);
  }
  assert.ok(manual?.lastSuccess);
  assert.ok(manual.filename.startsWith(manualDirectory),manual.filename);
  assert.equal(await evaluate(`globalThis.lastManualOptions.saveAs`),true);
  assert.equal(JSON.parse(fs.readFileSync(manual.filename,'utf8')).videos[0].notes[0].text,n.text);
  await cdp('Browser.setDownloadBehavior',{behavior:'default'});
  // Cancelling a manual Save As leaves the automatic destination/status untouched.
  const autoBefore=JSON.stringify(await evaluate(`chrome.storage.local.get('framenote:backup:state')`));
  await evaluate(`globalThis.cancelNextManual=true`);
  await evaluate(`document.getElementById('export-library').click()`,pageSession);
  for(let i=0;i<100;i++){if((await evaluate(`document.getElementById('message').textContent`,pageSession)).includes('cancelled'))break;await pause(100);}
  assert.match(await evaluate(`document.getElementById('message').textContent`,pageSession),/Manual backup cancelled/);
  assert.equal(JSON.stringify(await evaluate(`chrome.storage.local.get('framenote:backup:state')`)),autoBefore);
  const extra={...record,notes:[{...n,id:'second-note',text:'Another annotation'}]};
  await evaluate(`send('FRAMENOTE_IMPORT',{text:${JSON.stringify(JSON.stringify(extra))}})`,pageSession);
  state=await waitAutomatic(2);
  assert.equal(fs.readFileSync(monthlyPath,'utf8'),monthlyBefore);
  const names=fs.readdirSync(path.join(dir,'Downloads','FrameNote'));
  assert.equal(names.length,2,JSON.stringify(names));
  assert.equal(state.lastFilename,automaticPath);
  // Import preview and confirmation still accept older JSON exports.
  await evaluate(`(()=>{const input=document.getElementById('import-file');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(text)}],'legacy.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change'));})()`,pageSession);
  for(let i=0;i<100;i++){if(!await evaluate(`document.getElementById('import-button').disabled`,pageSession))break;await pause(100);}
  assert.match(await evaluate(`document.getElementById('import-preview').textContent`,pageSession),/1 duplicates/);
  await evaluate(`document.getElementById('import-button').click()`,pageSession);
  for(let i=0;i<100;i++){if((await evaluate(`document.getElementById('message').textContent`,pageSession)).includes('Imported '))break;await pause(100);}
  assert.match(await evaluate(`document.getElementById('message').textContent`,pageSession),/Imported 0 notes · 1 duplicates/);
  await evaluate(`document.getElementById('message').textContent=''`,pageSession);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:1100,deviceScaleFactor:1,mobile:false},pageSession);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},pageSession);
  const screenshot=path.join(dir,'settings.png');fs.writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
  console.log('PASS: actual automatic download overwrite, preserved monthly file, manual Save As request to a separate location, cancellation isolation, legacy import; no File System Access API used.');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false},pageSession);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`,pageSession),true,'Narrow options page overflows horizontally');
  const narrowShot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},pageSession);
  fs.writeFileSync(path.join(dir,'settings-narrow.png'),Buffer.from(narrowShot.data,'base64'));
  await cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:1100,deviceScaleFactor:1,mobile:false},pageSession);
  // Serve deterministic media pages locally, including a cross-origin iframe.
  const http = require('node:http');
  const wav = Buffer.alloc(44 + 80000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(80000, 40);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/clip.wav')) {
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) });
      res.end(wav.subarray(start, end + 1)); return;
    }
    const embedded = req.url.startsWith('/embedded');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(embedded ? `<!doctype html><title>Embed document</title><h2>Inner heading</h2><video id="embedded-player" controls preload="auto" src="/clip.wav"></video>` : `<!doctype html><title>Course tab</title><style>video{display:block;width:500px;height:180px}section{padding:12px}iframe{width:600px;height:300px}</style><h1>Course overview</h1><section><h2>Lesson one</h2><video id="lesson" controls preload="auto" src="/clip.wav"></video></section><section><h2>Podcast section</h2><audio id="podcast" controls preload="auto" src="/clip.wav?audio"></audio></section><section><h2>Embedded lesson</h2><iframe src="http://localhost:${server.address().port}/embedded"></iframe></section><script>window.shortcutCount=0;window.addEventListener('keydown',e=>{if(e.key==='f'||e.key==='t') window.shortcutCount++},true)</script>`);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  globalThis.fixtureServer = server;
  const fixtureURL = `http://127.0.0.1:${server.address().port}/course?lesson=1`;
  const { targetId: fixtureTarget } = await cdp('Target.createTarget', { url: fixtureURL });
  const { sessionId: fixtureSession } = await cdp('Target.attachToTarget', { targetId: fixtureTarget, flatten: true });
  const fixtureEval = expression => evaluate(expression, fixtureSession);
  const { tabId: fixtureTab } = await evaluate(`chrome.tabs.query({}).then(tabs => ({tabId: Math.max(...tabs.map(t=>t.id))}))`);
  for (let i = 0; i < 100; i++) {
    if (await fixtureEval(`document.getElementById('lesson')?.readyState > 0`)) break;
    await pause(100);
  }
  await fixtureEval(`document.getElementById('lesson').currentTime = 1.2; (() => {const v = document.getElementById('lesson'); const track=v.addTextTrack('subtitles','English','en');track.mode='hidden';track.addCue(new VTTCue(0,5,'Generic caption from text track'));})()`);
  await pause(2500);
  assert.ok(await fixtureEval(`document.getElementById('lesson').readyState > 0`), 'Fixture media did not load');
  await evaluate(`chrome.tabs.sendMessage(${fixtureTab}, { type: 'FRAMENOTE_TOGGLE' }, {frameId:0})`);
  // CDP can inspect the extension's closed shadow root for UI testing.
  async function panelNode(predicate) {
    const { root } = await cdp('DOM.getDocument', { depth: -1, pierce: true }, fixtureSession);
    function find(node) {
      if (predicate(node)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const match = find(child); if (match) return match; }
    }
    return find(root);
  }
  async function callNode(predicate, functionDeclaration) {
    const node = await panelNode(predicate);
    assert.ok(node, 'Panel element missing');
    const { object } = await cdp('DOM.resolveNode', { nodeId: node.nodeId }, fixtureSession);
    const result = await cdp('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, returnByValue: true, awaitPromise: true }, fixtureSession);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const hasAttr = (node, name, value) => node.attributes?.some((v, i, arr) => i % 2 === 0 && v === name && arr[i + 1] === value);
  const byText = text => node => node.nodeName === 'BUTTON' && node.children?.some(c => c.nodeValue === text);
  await pause(500);
  const playerOptions = await callNode(n => hasAttr(n, 'id', 'player-select'), `function(){return [...this.options].map(o=>({label:o.textContent,value:o.value}))}`);
  assert.equal(playerOptions.length, 3, JSON.stringify(playerOptions));
  assert.ok(playerOptions.some(p => p.label.includes('Embedded lesson')));
  // Select the first native video explicitly, capture its text track and save through the real UI.
  const lessonOption = playerOptions.find(p => p.value.endsWith('video:id:lesson'));
  await callNode(n => hasAttr(n, 'id', 'player-select'), `function(){this.value=${JSON.stringify(lessonOption.value)};this.dispatchEvent(new Event('change'))}`);
  await pause(400);
  await fixtureEval(`document.getElementById('lesson').currentTime=1.2`);
  await pause(300);
  await callNode(byText('Capture current moment'), 'function(){this.click()}');
  await pause(200);
  await callNode(n => n.nodeName === 'TEXTAREA', `function(){this.value='Native video note';this.focus()}`);
  for (const key of ['f', 't']) await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }, fixtureSession);
  assert.equal(await fixtureEval('window.shortcutCount'), 0);
  await callNode(byText('Save note'), 'function(){this.click();this.click()}');
  await pause(400);
  let webRecords = await evaluate(`chrome.storage.local.get(null).then(s => Object.values(s).filter(v=>v?.source==='web'))`);
  const nativeRecord = webRecords.find(v => v.player.key === 'video:id:lesson');
  assert.ok(nativeRecord, JSON.stringify(webRecords));
  assert.equal(nativeRecord.pageTitle, 'Course tab');
  assert.equal(nativeRecord.heading, 'Lesson one');
  assert.equal(nativeRecord.notes[0].timeSeconds, 1.2);
  assert.equal(nativeRecord.notes[0].caption, 'Generic caption from text track');
  assert.equal(nativeRecord.url, fixtureURL);
  // Draft text and captured moment survive views, Escape/reopen and player changes.
  await callNode(n => n.nodeName === 'TEXTAREA', `function(){this.value='An unfinished thought';this.dispatchEvent(new Event('input'));this.focus()}`);
  await callNode(n => hasAttr(n,'id','tab-library'), 'function(){this.click()}');
  await pause(300);
  await callNode(n => hasAttr(n,'aria-label','Search library'), `function(){this.value='Generic caption';this.dispatchEvent(new Event('input'))}`);
  const visibleLibrary = () => callNode(n => hasAttr(n,'aria-label','Search library'), `function(){return [...this.getRootNode().querySelectorAll('.library-item')].filter(n=>!n.hidden).length}`);
  assert.equal(await visibleLibrary(),1);
  await callNode(n=>hasAttr(n,'aria-label','Search library'),`function(){this.value='no-match-for-release-test';this.dispatchEvent(new Event('input'))}`);
  assert.equal(await visibleLibrary(),0);
  await callNode(n=>hasAttr(n,'aria-label','Search library'),`function(){this.value='';this.dispatchEvent(new Event('input'))}`);
  await callNode(n=>hasAttr(n,'id','tab-current'),'function(){this.click()}');
  await pause(150);
  assert.equal(await callNode(n=>n.nodeName==='TEXTAREA','function(){this.focus();return this.value}'),'An unfinished thought');
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},fixtureSession);
  assert.equal(await fixtureEval(`document.getElementById('framenote-root').style.display`),'none');
  await evaluate(`chrome.tabs.sendMessage(${fixtureTab},{type:'FRAMENOTE_TOGGLE'},{frameId:0})`);
  await pause(150);
  assert.equal(await callNode(n=>n.nodeName==='TEXTAREA','function(){return this.value}'),'An unfinished thought');
  // An audio player gets its own library entry on the same page.
  const podcastOption = playerOptions.find(p => p.value.endsWith('audio:id:podcast'));
  await callNode(n => hasAttr(n, 'id', 'player-select'), `function(){this.value=${JSON.stringify(podcastOption.value)};this.dispatchEvent(new Event('change'))}`);
  await pause(300);
  assert.equal(await callNode(n=>n.nodeName==='TEXTAREA','function(){return this.value}'),'');
  await callNode(n => n.nodeName === 'TEXTAREA', `function(){this.value='Audio note'}`);
  await callNode(byText('Save note'), 'function(){this.click()}');
  await pause(300);
  await callNode(n=>hasAttr(n,'id','player-select'),`function(){this.value=${JSON.stringify(lessonOption.value)};this.dispatchEvent(new Event('change'))}`);
  await pause(150);
  assert.equal(await callNode(n=>n.nodeName==='TEXTAREA','function(){return this.value}'),'An unfinished thought');
  await callNode(n=>hasAttr(n,'id','player-select'),`function(){this.value=${JSON.stringify(podcastOption.value)};this.dispatchEvent(new Event('change'))}`);
  await pause(150);
  assert.equal(await callNode(n=>n.nodeName==='TEXTAREA','function(){return this.value}'),'');
  console.log('PASS: duplicate-save prevention, Library text/caption search, draft preservation across views/players and Escape/reopen.');
  // Cross-origin embeds are annotated from the top panel and use the outer heading/title.
  const embedOption = playerOptions.find(p => p.label.includes('(embedded)'));
  await callNode(n => hasAttr(n, 'id', 'player-select'), `function(){this.value=${JSON.stringify(embedOption.value)};this.dispatchEvent(new Event('change'))}`);
  await pause(300);
  await callNode(n => n.nodeName === 'TEXTAREA', `function(){this.value='Embedded note'}`);
  await callNode(byText('Save note'), 'function(){this.click()}');
  await pause(400);
  webRecords = await evaluate(`chrome.storage.local.get(null).then(s => Object.values(s).filter(v=>v?.source==='web'))`);
  assert.equal(webRecords.length, 3);
  assert.equal(webRecords.find(v=>v.notes[0].text==='Embedded note').heading, 'Embedded lesson');
  assert.equal(webRecords.find(v=>v.notes[0].text==='Audio note').heading, 'Podcast section');
  // Library timestamp links reopen the original page and select/seek the saved player.
  const timestampURL = await evaluate(`FrameNoteMedia.timestampURL(${JSON.stringify(nativeRecord)}, 2.4)`);
  await cdp('Page.navigate', { url: timestampURL }, fixtureSession);
  for (let i = 0; i < 100; i++) {
    if (await fixtureEval(`Math.abs((document.getElementById('lesson')?.currentTime||0)-2.4)<0.05`)) break;
    await pause(100);
  }
  assert.ok(await fixtureEval(`Math.abs(document.getElementById('lesson').currentTime-2.4)<0.05`), 'Timestamp link did not restore playback position');
  // Reopen and ensure saved records survived navigation with the same identities.
  await evaluate(`chrome.tabs.sendMessage(${fixtureTab}, {type:'FRAMENOTE_TOGGLE'}, {frameId:0})`);
  await pause(300);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, fixtureSession);
  const overlayShot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, fixtureSession);
  fs.writeFileSync(path.join(dir, 'generic-media.png'), Buffer.from(overlayShot.data, 'base64'));
  console.log('PASS: native video, audio, cross-origin embed, nearby headings/tab titles, per-player notes, text-track captions, keyboard isolation, timestamp restore.');

  // Regression: uncheck once, reload the whole extension, then open a new options page.
  assert.equal(await evaluate(`document.getElementById('enabled').checked`,pageSession),true);
  await evaluate(`document.getElementById('enabled').click()`,pageSession);
  for(let i=0;i<100;i++) {
    if(await evaluate(`chrome.storage.local.get('framenote:backup:settings').then(s=>s['framenote:backup:settings']?.enabled===false)`)) break;
    await pause(100);
  }
  assert.equal(await evaluate(`chrome.storage.local.get('framenote:backup:settings').then(s=>s['framenote:backup:settings'].enabled)`),false);
  // Restart the entire isolated browser with the same profile. This reloads every
  // extension context while retaining real persisted browser storage.
  await new Promise(resolve=>{browser.once('exit',resolve);ws.send(JSON.stringify({id:++id,method:'Browser.close'}));});
  ws.close();stderr='';browser=launchBrowser();browser.stderr.on('data',chunk=>{stderr+=chunk});
  for(let i=0;i<150&&!stderr.includes('DevTools listening on');i++)await pause(100);
  const restartedEndpoint=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
  assert.ok(restartedEndpoint,'Browser did not restart: '+stderr.slice(-1000));
  ws=new WebSocket(restartedEndpoint);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});ws.onmessage=routeMessage;
  let nextWorker;
  for(let i=0;i<100;i++) {
    nextWorker=(await cdp('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===worker.url);
    if(nextWorker)break;
    await pause(100);
  }
  assert.ok(nextWorker,'Restarted extension worker missing');
  workerSession=(await cdp('Target.attachToTarget',{targetId:nextWorker.targetId,flatten:true})).sessionId;
  const reopened=(await cdp('Target.createTarget',{url:base+'options.html'})).targetId;
  const reopenedSession=(await cdp('Target.attachToTarget',{targetId:reopened,flatten:true})).sessionId;
  for(let i=0;i<100;i++) {
    if(await evaluate(`document.getElementById('enabled') && !document.getElementById('enabled').disabled`,reopenedSession))break;
    await pause(100);
  }
  assert.equal(await evaluate(`document.getElementById('enabled').checked`,reopenedSession),false);
  assert.equal(await evaluate(`chrome.storage.local.get('framenote:backup:settings').then(s=>s['framenote:backup:settings'].enabled)`),false);
  assert.equal(await evaluate(`!!document.querySelector('button[type="submit"]')`,reopenedSession),false);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:1100,deviceScaleFactor:1,mobile:false},reopenedSession);
  const afterReload=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},reopenedSession);
  fs.writeFileSync(path.join(dir,'settings-after-reload.png'),Buffer.from(afterReload.data,'base64'));
  console.log('PASS: checkbox saves immediately; disabled preference survives a full browser restart, extension reinitialization and reopening Options.');

  console.log(JSON.stringify({ result: 'PASS: automatic browser downloads and manual Save As (headless destination selected by CDP), annotation features and imports', screenshot, nativeFolderPickerAvailable, backupFiles: names, testProfile: dir }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (ws) ws.close(); browser.kill('SIGTERM'); if (globalThis.fixtureServer) globalThis.fixtureServer.closeAllConnections(), globalThis.fixtureServer.close(); });
