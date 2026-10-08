import {TARGET_SECONDS, STOP_SECONDS, MIN_SECONDS, MAX_BYTES, acceptedResults, rejection, chooseMime, canAnalyzeCapture, waveformPath, diagnostics} from './core.mjs';
import {METRIC_ROWS,modelName,metricValue,qualityLabel,respirationNote,resultViewItems} from './results.mjs';
import {FaceRing} from './face-ring.mjs';
import {CameraGuide} from './guide-camera.mjs';
import {RecordingMonitor,turnDirection,GuideFeedback,GUIDE_STEPS} from './pose.mjs';
const $ = selector => document.querySelector(selector);
const screens = [...document.querySelectorAll('.screen')];
const icons = name => `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const send = (type, value = {}) => window.parent.postMessage({isStreamlitMessage:true, type, ...value}, window.location.origin);
const emit = value => send('streamlit:setComponentValue', {value, dataType:'json'});
const freshId = () => crypto.randomUUID();
let args = {ready:false}, screen = 'prepare', stream = null, recorder = null, chunks = [], bytes = 0;
let started = 0, elapsed = 0, tick = null, lastLighting = 0, pendingId = null, lastResponse = null, busy = false;
let stoppedForSize = false, toastTimer, lightingSamples = 0, faceGuide = null, cameraAttempt = 0, captureAborted = false, recordingDuration = TARGET_SECONDS, retryData = null;
const lightCanvas = document.createElement('canvas'); lightCanvas.width = lightCanvas.height = 48;
const lightContext = lightCanvas.getContext('2d', {willReadFrequently:true});
const guideFeedback=new GuideFeedback();
const faceRing=new FaceRing($('.face-oval'));
let resultView='compare';
function frameHeight() {
  // Measure content, not the iframe's previous height (which prevents shrinking).
  const padding=getComputedStyle(document.body);
  const height=Math.ceil($('.app-shell').getBoundingClientRect().height+parseFloat(padding.paddingTop)+parseFloat(padding.paddingBottom));
  send('streamlit:setFrameHeight', {height});
}
new ResizeObserver(frameHeight).observe($('.app-shell'));
window.addEventListener('resize',frameHeight);
function dialogBounds() {
  // A Streamlit iframe can be taller than the visible page. Keep dialogs in
  // the visible slice, including when the parent page has been scrolled.
  let top=0,height=window.innerHeight;
  try {
    if(window.frameElement) {
      const box=window.frameElement.getBoundingClientRect();
      const viewport=window.parent.visualViewport;
      const start=viewport?.offsetTop || 0,end=start+(viewport?.height || window.parent.innerHeight);
      top=Math.max(0,start-box.top);
      height=Math.max(0,Math.min(window.innerHeight,end-box.top)-top);
    }
  } catch { /* Standalone/cross-origin previews use their own viewport. */ }
  document.documentElement.style.setProperty('--dialog-top',`${top+16}px`);
  document.documentElement.style.setProperty('--dialog-height',`${Math.max(0,height-32)}px`);
}
function openDialog(id) {dialogBounds();$('#'+id).showModal();}
function refreshDialogBounds() {if(document.querySelector('dialog[open]'))dialogBounds();}
window.addEventListener('resize',refreshDialogBounds);
try {
  window.parent.addEventListener('scroll',refreshDialogBounds,{passive:true});
  window.parent.addEventListener('resize',refreshDialogBounds);
  window.parent.visualViewport?.addEventListener('resize',refreshDialogBounds);
  window.parent.visualViewport?.addEventListener('scroll',refreshDialogBounds);
} catch { /* No access to a cross-origin host is required. */ }
function show(next) {
  screen = next;
  for (const panel of screens) panel.hidden = panel.id !== next;
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.classList.toggle('selected', button.dataset.nav === (next === 'results' ? 'results' : 'scan'));
    button.disabled = busy;
  }
  $('#menu-button').disabled = $('#help-button').disabled = busy;
  frameHeight();
  requestAnimationFrame(() => $('.app-shell').scrollIntoView({block:'start',behavior:'auto'}));
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 4500); }
function releaseCamera() {
  cameraAttempt++;faceGuide?.close();faceGuide=null;
  if (tick) {clearInterval(tick); tick = null;}
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  $('#camera').srcObject = null;
}
function reset() {
  if (busy) return;
  releaseCamera(); chunks = []; bytes = 0; pendingId = null;
  $('#seconds').textContent = '0'; $('#timer-ring').style.strokeDashoffset = 320.443;
  $('#stop').disabled = true; $('#upload').value = '';
  emit({id:freshId(), action:'reset'}); args.result = null; show('prepare');
}
function retry(data) {
  busy = false; releaseCamera();
  const reason = rejection(data);
  $('#retry-message').textContent = reason.message;
  const cleanCapture=data.capture_quality?.accepted===true && reason.code==='low_signal_quality';
  $('#retry-title').textContent=cleanCapture?'No pudimos estimar el pulso':'Mejoremos la toma';
  $('#retry-intro').textContent=cleanCapture?'La captura se completó, pero el resultado no fue concluyente.':'Sigue estos consejos para mejorar la captura.';
  retryData=data;
  $('#advice-one').textContent=reason.hints[0];$('#advice-two').textContent=reason.hints[1];
  const paragraphs=document.querySelectorAll('.advice-card p');
  paragraphs[0].textContent=reason.code==='low_signal_quality'?'Una señal débil puede ocurrir incluso con el rostro bien colocado.':'Prepara la toma antes de repetir.';
  paragraphs[1].textContent=reason.code==='low_signal_quality'?'Puedes elegir 30 segundos para la siguiente toma.':'Si necesitas ayuda, abre los consejos.';
  $('#retry-context').textContent=reason.context;
  $('#retry-details').hidden=!(data.video || data.capture_quality || data.results?.length);
  $('#retry-diagnostics').textContent=JSON.stringify(diagnostics(data),null,2);
  $('#retry-summary').innerHTML=(data.results || []).map(item=>`<div class="detail-row"><strong>${escape(item.engine)}</strong><span>${escape(item.reason || 'Sin resultado')}</span></div>`).join('');
  show('retry');
}
function renderResults(data, preserveView=false) {
  busy=false;releaseCamera();
  if(!acceptedResults(data).length){retry(data);return;}
  const all=data.results || [];
  if(!preserveView)resultView=all.length>1?'compare':all[0].engine;
  const visible=resultViewItems(data,resultView);
  $('#results-intro').textContent=all.length>1?'Una captura, dos formas de analizarla.':'Resultados de tu última captura.';
  const choices=[['compare','Comparar'],['open-rppg','FacePhys'],['rPPG-Toolbox',modelName(all.find(x=>x.engine==='rPPG-Toolbox') || {engine:'rPPG-Toolbox'})]];
  $('#result-switch').innerHTML=choices.map(([key,label])=>`<button type="button" data-result-view="${key}" aria-pressed="${key===resultView}" ${key!=='compare' && !all.some(x=>x.engine===key)?'disabled':''}>${escape(label)}</button>`).join('');
  for(const button of $('#result-switch').querySelectorAll('button'))button.addEventListener('click',()=>{resultView=button.dataset.resultView;renderResults(data,true);});
  const seconds=data.video?.duration_sec;
  $('#result-window').textContent=Number.isFinite(seconds)?`${seconds.toFixed(0)} segundos · ${seconds<45?'Ventana corta de variabilidad':'Métricas experimentales'}`:'Métricas experimentales';
  $('#result-cards').classList.toggle('pair',visible.length>1);
  $('#result-cards').innerHTML=visible.map(item=>{
    const name=escape(modelName(item));
    if(!acceptedResults({results:[item]}).length)return `<article class="result-card rejected"><div class="result-label">${name}</div><h2>Sin resultado</h2><p>${escape(rejection({results:[item]}).message)}</p><span class="status-pill dim">${item.reason==='engine_error'?'Cálculo no disponible':'Señal insuficiente'}</span></article>`;
    const wave=waveformPath(item.bvp_waveform);
    return `<article class="result-card"><div class="result-label">${icons('pulse')}${name}</div><div class="pulse-number">${item.heart_rate_bpm.toFixed(0)}</div><p class="pulse-unit">latidos/min</p>${wave?`<svg class="pulse-wave" viewBox="0 0 300 60" aria-label="Señal de pulso estimada"><path d="${wave}"/></svg>`:''}<span class="status-pill good">${icons('check')}Señal aceptada</span><p class="quality-score">${escape(qualityLabel(item))}</p></article>`;
  }).join('');
  $('#metric-comparison').innerHTML=`<table><caption>Estimaciones por motor</caption><thead><tr><th scope="col">Métrica</th>${visible.map(x=>`<th scope="col">${escape(modelName(x))}</th>`).join('')}</tr></thead><tbody>${METRIC_ROWS.map(([name,unit,get])=>`<tr><th scope="row">${name}</th>${visible.map(item=>`<td>${escape(metricValue(item,get,unit))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('#metric-notes').innerHTML=`<span>La variabilidad es del pulso de cámara; no equivale a HRV de ECG.${Number.isFinite(seconds) && seconds<45?' En esta toma la ventana es corta.':''}</span>`+visible.map(item=>`<span><strong>${escape(modelName(item))}:</strong> ${escape(respirationNote(item))}</span>`).join('');
  const difference=acceptedResults(data).length===2?data.comparison?.difference_bpm:null;
  const referenceErrors=data.comparison?.reference_errors || [];
  $('#comparison-note').textContent=Number.isFinite(difference)?`Diferencia de pulso: ${difference.toFixed(1)} latidos/min. La coincidencia entre motores no demuestra precisión.`:all.length===1?'Para comparar ambos, selecciona “Comparar ambos métodos” en el menú antes de la próxima captura.':'Solo un motor obtuvo una señal suficiente en esta toma.';
  $('#technical-results').innerHTML=visible.map(item=>{
    if(!acceptedResults({results:[item]}).length)return `<p class="small">${escape(modelName(item))}: ${escape(rejection({results:[item]}).message)}</p>`;
    const beats=item.heartbeats || [];
    const error=referenceErrors.find(x=>x.engine===item.engine)?.absolute_error_bpm;
    return `<div class="detail-row"><strong>${escape(modelName(item))}</strong><span>${escape(item.model_used)}</span></div><p class="small">${escape(qualityLabel(item))}. SQI y SNR usan escalas distintas y no se promedian.</p>`+
      (Number.isFinite(error)?`<p class="small">Error frente a tu referencia simultánea: ${error.toFixed(1)} latidos/min.</p>`:'')+
      (item.warnings || []).map(text=>`<p class="small">${escape(text)}</p>`).join('')+
      (beats.length?`<details class="beat-details"><summary>${beats.length} intervalos entre pulsos</summary><p class="small">Inicio y fin son picos de pulso consecutivos, relativos a la señal analizada.</p><div class="beat-scroll"><table><thead><tr><th>Inicio (s)</th><th>Fin (s)</th><th>Duración (ms)</th></tr></thead><tbody>${beats.map(x=>`<tr><td>${x.start_location_sec.toFixed(3)}</td><td>${x.end_location_sec.toFixed(3)}</td><td>${x.duration_ms.toFixed(1)}</td></tr>`).join('')}</tbody></table></div></details>`:'')+
      `<pre>${escape(JSON.stringify({quality:item.quality,interval_quality:item.interval_quality,respiration:item.respiration,processing_seconds:item.processing_seconds},null,2))}</pre>`;
  }).join('')+`<pre>${escape(JSON.stringify({video:data.video,capture_quality:data.capture_quality,variability_window:data.variability_window,comparison:data.comparison},null,2))}</pre>`;
  show('results');
}
function options() {
  const reference = $('#use-reference').checked ? Number($('#reference').value) : null;
  if (reference !== null && (!Number.isFinite(reference) || reference < 30 || reference > 220)) throw new Error('La referencia debe estar entre 30 y 220 latidos/min.');
  return {selected:$('#selected').value, legacy_model:$('#legacy-model').value, reference_bpm:reference};
}
async function submit(blob, mime) {
  if (!blob.size || blob.size > MAX_BYTES) {retry({error:{code:'invalid_video',message:'El video debe pesar menos de 50 MB.'}}); return;}
  busy = true; show('processing');
  try {
    const settings = options();
    const video = await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    pendingId = freshId();
    emit({action:'analyze', id:pendingId, video, mime, ...settings});
  } catch (error) { retry({error:{code:'invalid_video',message:error.message || 'No se pudo enviar la grabación.'}}); }
}
function showExposure(light) {
  if(!Number.isFinite(light))return;
  const good=light>=40 && light<=225;
  $('#light-status').className=`status-pill ${good?'good':'dim'}`;
  $('#light-status span').textContent=good?'Luz adecuada':light<40?'Busca más luz':'Evita luz directa';
}
function checkLight(now) {
  if (now - lastLighting < 800 || !$('#camera').videoWidth) return;
  lastLighting = now;
  try {
    const video = $('#camera');
    // This checks exposure only, not pulse quality or successful face detection.
    lightContext.drawImage(video,video.videoWidth*.32,video.videoHeight*.2,video.videoWidth*.36,video.videoHeight*.55,0,0,48,48);
    const pixels = lightContext.getImageData(0,0,48,48).data;
    let total = 0; for (let i=0;i<pixels.length;i+=4) total += pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114;
    const light = total/(pixels.length/4), good = light >= 40 && light <= 225;
    lightingSamples++;
    showExposure(light);
  } catch { $('#light-status span').textContent = 'Mantén una luz uniforme'; }
}
function guideState(state) {
  showExposure(state.brightness);
  const feedback=guideFeedback.update(state,performance.now()),labels=['Frente','Giro 1','Giro 2','Centro'];
  const titles={front:'Mira al frente',left:'Gira un poquito',right:'Ahora al otro lado',steady:'Vuelve al centro'};
  const hints={missing:'Coloca tu rostro dentro del óvalo',multiple:'Debe aparecer solo tu rostro',closer:'Acércate un poco',farther:'Aléjate un poco',center:'Centra tu rostro en el óvalo',level:'Mantén la cabeza a la altura de tus ojos',light:'Busca luz uniforme frente a ti',turn:state.stage==='steady'?'Mira al frente para comenzar':state.stage==='front'?'Mira a la cámara':'Sigue la flecha. Solo necesitas un giro pequeño',hold:state.stage==='steady'?'Mantente quieto. La captura comenzará sola':'Así está bien. Mantén un momento',ready:'Listo. Comenzamos la captura'};
  const displayStage=feedback.confirming?GUIDE_STEPS[feedback.completedStep]:state.stage;
  const direction=turnDirection(displayStage),side=Boolean(direction),example=$('#guide-example');
  const exampleAsset=side?'guide-avatar-turn.webp':'guide-avatar-front.webp';
  if(example.getAttribute('src')!==exampleAsset)example.src=exampleAsset;
  example.classList.toggle('mirror',direction==='left');
  example.alt=side?'Ejemplo del giro que debes imitar':'Ejemplo del rostro al frente';
  $('#guide-example-label').textContent=feedback.confirming?'Posición completada':side?'Un poco hacia este lado':'Mira al frente';
  const cue=$('#turn-cue');cue.hidden=!side || feedback.confirming;cue.classList.toggle('left',direction==='left');
  cue.setAttribute('aria-label',direction==='left'?'Gira hacia la izquierda de la pantalla':'Gira hacia la derecha de la pantalla');
  $('.face-oval').classList.toggle('detected',state.reason==='hold' || feedback.confirming);
  faceRing.update(feedback.progress);
  const notice=$('#guide-notice');notice.hidden=false;notice.classList.toggle('confirmed',feedback.confirming);
  $('#guide-check').hidden=!feedback.confirming;
  const noticeText=feedback.confirming?`${labels[feedback.completedStep]} listo`:state.reason==='hold'?'Mantén la posición':`Paso ${state.step+1} de 4 · ${labels[state.step]}`;
  if($('#guide-notice-text').textContent!==noticeText)$('#guide-notice-text').textContent=noticeText;
  const completedBadge=$('#guide-completed');completedBadge.hidden=feedback.lastCompleted<0;
  const completedText=feedback.lastCompleted<0?'':state.done?'✓ Preparación lista':`✓ ${labels[feedback.lastCompleted]} completado`;
  if(completedBadge.textContent!==completedText)completedBadge.textContent=completedText;
  const captureTitle=feedback.confirming?'¡Listo!':titles[state.stage];
  const captureHint=feedback.confirming?(state.done?'Preparación lista. Comenzamos la captura':'Paso completado. Sigue con la siguiente indicación'):hints[state.reason] || 'Sigue la guía';
  if($('#capture-title').textContent!==captureTitle)$('#capture-title').textContent=captureTitle;
  if($('#capture-hint').textContent!==captureHint)$('#capture-hint').textContent=captureHint;
  for(const [i,item] of [...document.querySelectorAll('.guide-progress > span')].entries()) {
    item.classList.toggle('complete',i<state.step || state.done);item.classList.toggle('active',i===state.step && !state.done);
    item.querySelector('b').textContent=i<state.step || state.done?'✓':i+1;
    item.setAttribute('aria-label',`${labels[i]}${i<state.step || state.done?', completado':i===state.step?', actual':', pendiente'}`);
  }
  $('.guide-progress').setAttribute('aria-valuenow',state.done?4:state.step);
}
function abortCapture(code) {
  captureAborted=true;
  if(recorder?.state==='recording')recorder.stop();
  retry({error:{code}});
}
function monitorCapture(pose,now,monitor) {
  const state=monitor.update(pose,now),good=!state.code;
  showExposure(pose.brightness);
  const messages={no_face:'No vemos tu rostro',multiple_faces:'Debe aparecer solo tu rostro',poor_lighting:'Mejora la luz sobre tu rostro',face_out_of_frame:'Vuelve al centro del óvalo',face_not_front:'Mira al frente'};
  $('#face-status').className=`status-pill ${good?'good':'dim'}`;
  $('#face-status span').textContent=good?'Rostro centrado':messages[state.code];
  $('.face-oval').classList.toggle('attention',!good);
  $('#capture-hint').textContent=good?'Mira al frente y evita hablar':messages[state.code];
  if(state.stop)abortCapture(state.code);
}
function startRecording() {
  if(!stream?.active)throw new Error('La cámara dejó de estar disponible.');
  // Guided turns stay outside the video. Reuse the worker at only 2 FPS
  // while recording to catch face/lighting issues without main-thread inference.
  const monitor=new RecordingMonitor();
  $('#face-guide').hidden=$('#cancel-guide').hidden=$('#turn-cue').hidden=$('#guide-notice').hidden=$('#guide-completed').hidden=true;$('#face-status').hidden=false;
  $('#record-timer').hidden=$('#stop').hidden=false;
  $('#capture-title').textContent='Mantente quieto';
  $('#capture-hint').textContent='Mira al frente y evita hablar';
  $('.face-oval').classList.remove('detected');
  faceRing.update(0);
  const mime=chooseMime(MediaRecorder);
  recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:4_000_000});
  const activeRecorder=recorder,attempt=cameraAttempt;
  recorder.addEventListener('dataavailable',event=>{
    if(captureAborted || attempt!==cameraAttempt)return;
    if(event.data.size){chunks.push(event.data);bytes+=event.data.size;}
    if(bytes>MAX_BYTES && activeRecorder.state==='recording'){stoppedForSize=true;activeRecorder.stop();}
  });
  recorder.addEventListener('error',()=>{
    if(attempt!==cameraAttempt)return;
    captureAborted=true;chunks=[];bytes=0;
    if(activeRecorder.state==='recording')activeRecorder.stop();
    retry({error:{code:'invalid_video',message:'La cámara no pudo completar la grabación.'}});
  });
  recorder.addEventListener('stop',async()=>{
    if(captureAborted || attempt!==cameraAttempt)return;
    const duration=(performance.now()-started)/1000;
    releaseCamera();
    if(stoppedForSize || !canAnalyzeCapture(duration,bytes)) {
      chunks=[];busy=false;
      retry({error:{code:stoppedForSize?'invalid_video':'video_too_short',message:stoppedForSize?'La grabación superó 50 MB.':`Grabaste ${Math.floor(duration)} segundos. Necesitamos al menos ${MIN_SECONDS}.`}});return;
    }
    const blob=new Blob(chunks,{type:activeRecorder.mimeType || mime || 'video/webm'});chunks=[];
    await submit(blob,blob.type);
  },{once:true});
  recorder.start(500);started=performance.now();elapsed=0;
  faceGuide?.monitor((pose,now)=>monitorCapture(pose,now,monitor));
  $('#stop').disabled=false;
  tick=setInterval(()=>{
    elapsed=(performance.now()-started)/1000;
    $('#seconds').textContent=Math.min(recordingDuration,Math.floor(elapsed));
    $('.timer').setAttribute('aria-valuenow',Math.min(recordingDuration,Math.floor(elapsed)));
    $('#timer-ring').style.strokeDashoffset=320.443*(1-Math.min(elapsed/recordingDuration,1));
    if(!faceGuide)checkLight(performance.now());
    if(elapsed>=recordingDuration+(recordingDuration===60?-.1:STOP_SECONDS-TARGET_SECONDS) && activeRecorder.state==='recording'){$('#stop').disabled=true;activeRecorder.stop();}
  },100);
}
async function startCamera() {
  if(busy)return;
  if(!args.ready){toast('El análisis se está iniciando. Intenta de nuevo en unos momentos.');return;}
  busy=true;show('record');$('#camera-loading').hidden=false;
  $('#camera-loading').textContent='Encendiendo tu cámara…';
  $('#stop').disabled=true;$('#seconds').textContent='0';$('#timer-ring').style.strokeDashoffset=320.443;
  $('#record-timer').hidden=$('#stop').hidden=true;$('#face-guide').hidden=false;$('#cancel-guide').hidden=false;
  $('#light-status').className='status-pill';$('#light-status span').textContent='Comprobando luz…';
  guideFeedback.reset();guideState({stage:'front',step:0,reason:'waiting',progress:0});
  recordingDuration=[20,30,60].includes(Number($('#capture-duration').value))?Number($('#capture-duration').value):TARGET_SECONDS;
  $('#duration-label').textContent=` / ${recordingDuration} s`;$('#record-timer').setAttribute('aria-valuemax',recordingDuration);
  $('#face-status').hidden=true;$('.face-oval').classList.remove('attention');
  chunks=[];bytes=0;stoppedForSize=false;captureAborted=false;lightingSamples=0;recorder=null;
  const attempt=++cameraAttempt;
  try {
    options();
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)throw Object.assign(new Error('Este navegador no permite grabar video. Usa Safari o Chrome actualizado, o sube un video.'),{name:'UnsupportedCamera'});
    const acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
    if(attempt!==cameraAttempt){acquired.getTracks().forEach(track=>track.stop());return;}
    stream=acquired;
    const video=$('#camera');
    const playing=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('No se pudo iniciar la cámara.')),12000);
      video.addEventListener('loadeddata',()=>{clearTimeout(timeout);resolve();},{once:true});
    });
    video.srcObject=stream;
    await Promise.all([video.play(),playing]);
    if(attempt!==cameraAttempt)return;
    $('#camera-loading').textContent='Preparando la guía…';
    checkLight(performance.now());
    faceGuide=new CameraGuide(video,{
      onState:state=>{$('#camera-loading').hidden=true;guideState(state);},
      onReady:()=>{
        if(attempt!==cameraAttempt)return;
        clearInterval(tick);tick=null;
        try{startRecording();}catch{retry({error:{code:'invalid_video',message:'No se pudo iniciar la grabación. Intenta de nuevo.'}});}
      },
      onError:code=>{
        if(attempt!==cameraAttempt)return;
        if(recorder?.state==='recording') {faceGuide=null;$('#face-status').className='status-pill dim';$('#face-status span').textContent='Revisión de rostro no disponible';}
        else retry({error:{code}});
      },
    });
    faceGuide.start();
    stream.getVideoTracks()[0].addEventListener('ended',()=>{
      if(attempt!==cameraAttempt)return;
      if(recorder?.state==='recording')recorder.stop();
      else retry({error:{code:'camera_missing'}});
    });
  } catch(error) {
    if(attempt!==cameraAttempt)return;
    const code=['NotAllowedError','SecurityError'].includes(error.name)?'camera_denied':['NotFoundError','NotReadableError'].includes(error.name)?'camera_missing':'invalid_video';
    retry({error:{code,...(code==='invalid_video'?{message:error.name==='UnsupportedCamera'?error.message:'No se pudo iniciar la cámara. Intenta de nuevo o sube un video.'}:{})}});
  }
}
$('#cancel-guide').addEventListener('click',()=>{busy=false;reset();});
$('#start').addEventListener('click',startCamera);
$('#stop').addEventListener('click',() => {if(recorder?.state==='recording') {elapsed=(performance.now()-started)/1000;$('#stop').disabled=true;recorder.stop();}});
for (const id of ['retry-start','new-capture']) $('#'+id).addEventListener('click',reset);
for (const id of ['help-button','more-tips']) $('#'+id).addEventListener('click',() => {openDialog('help-dialog'); frameHeight();});
$('#menu-button').addEventListener('click',() => {openDialog('menu-dialog');frameHeight();});
for(const close of document.querySelectorAll('.close-dialog')) close.addEventListener('click',() => close.closest('dialog').close());
for(const button of document.querySelectorAll('[data-nav]')) button.addEventListener('click',() => {
  if (busy) return;
  if (button.dataset.nav==='results') {
    if (args.result) renderResults(args.result); else toast('Todavía no tienes una captura. Pulsa Estoy listo para comenzar.');
  } else {releaseCamera();show('prepare');}
});
function captureMode(seconds) {
  $('#capture-duration').value=String(seconds);
  for(const button of document.querySelectorAll('[data-duration]'))button.setAttribute('aria-pressed',Number(button.dataset.duration)===seconds);
  $('#capture-mode-note').textContent=seconds===60?'Más tiempo para explorar variabilidad y respiración. Estimaciones experimentales.':`Captura de ${seconds} segundos para estimar tu pulso.`;
}
for(const button of document.querySelectorAll('[data-duration]'))button.addEventListener('click',()=>captureMode(Number(button.dataset.duration)));
$('#capture-duration').addEventListener('change',()=>captureMode(Number($('#capture-duration').value)));
$('#selected').addEventListener('change',() => {$('#model-label').hidden=$('#selected').value==='open_rppg';});
$('#use-reference').addEventListener('change',() => {$('#reference-label').hidden=!$('#use-reference').checked;});
$('#upload').addEventListener('change', async () => {
  const file = $('#upload').files[0];
  if (!file || busy) return;
  if (!args.ready) {toast('El análisis no está disponible por ahora.');return;}
  $('#menu-dialog').close();
  const extension = file.name.split('.').pop().toLowerCase();
  const mime = file.type || ({mov:'video/quicktime',mkv:'video/x-matroska',avi:'video/x-msvideo',mp4:'video/mp4',webm:'video/webm'}[extension]);
  await submit(file,mime);
});
$('#logout').addEventListener('click',() => {if(!busy) {releaseCamera();emit({id:freshId(),action:'logout'});}});
$('#export-diagnostics').addEventListener('click',()=>{
  if(!retryData)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(diagnostics(retryData),null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='proxant-selfie-diagnostico.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('#export').addEventListener('click',() => {
  if(!args.result) return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(args.result,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='proxant-selfie-resultados.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('message',event => {
  if(event.source!==window.parent || event.origin!==window.location.origin || event.data?.type!=='streamlit:render') return;
  args=event.data.args || {};
  $('#account-name').textContent=args.user_name || 'Mi cuenta';
  $('#service-notice').hidden=Boolean(args.ready);
  $('#start').disabled=!args.ready;
  if(args.result && args.response_id && args.response_id!==lastResponse) {
    lastResponse=args.response_id;pendingId=null;renderResults(args.result);
    // Release the base64 upload from the component widget's stored value.
    emit({id:args.response_id,action:'ack'});
  }
  frameHeight();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden && recorder?.state==='recording')abortCapture('capture_interrupted');});
window.addEventListener('pagehide',()=>{captureAborted=true;if(recorder?.state==='recording')recorder.stop();releaseCamera();});
send('streamlit:componentReady',{apiVersion:1});frameHeight();
