import {TARGET_SECONDS, MIN_SECONDS, MAX_BYTES, acceptedResults, rejection, chooseMime, canAnalyzeCapture, waveformPath} from './core.mjs';
const $ = selector => document.querySelector(selector);
const screens = [...document.querySelectorAll('.screen')];
const icons = name => `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const send = (type, value = {}) => window.parent.postMessage({isStreamlitMessage:true, type, ...value}, window.location.origin);
const emit = value => send('streamlit:setComponentValue', {value, dataType:'json'});
const freshId = () => crypto.randomUUID();
let args = {ready:false}, screen = 'prepare', stream = null, recorder = null, chunks = [], bytes = 0;
let started = 0, elapsed = 0, tick = null, lastLighting = 0, pendingId = null, lastResponse = null, busy = false;
let stoppedForSize = false, toastTimer, lightingSamples = 0;
const lightCanvas = document.createElement('canvas'); lightCanvas.width = lightCanvas.height = 48;
const lightContext = lightCanvas.getContext('2d', {willReadFrequently:true});
function frameHeight() { send('streamlit:setFrameHeight', {height:Math.ceil(document.documentElement.scrollHeight)}); }
new ResizeObserver(frameHeight).observe(document.body);
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
  const ordinary = ['low_signal_quality','excessive_motion','no_face'].includes(reason.code);
  const titles = ordinary ? ['Coloca el teléfono a la altura de tus ojos','Quédate quieto durante la grabación'] : reason.hints;
  $('#advice-one').textContent = titles[0]; $('#advice-two').textContent = titles[1];
  const paragraphs = document.querySelectorAll('.advice-card p');
  paragraphs[0].textContent = ordinary ? 'Así podremos ver mejor tu rostro.' : 'Prepara la toma antes de repetir.';
  paragraphs[1].textContent = ordinary ? 'Evita mover el teléfono y tu rostro.' : 'Si necesitas ayuda, abre los consejos.';
  $('#retry-context').textContent = ordinary ? 'La luz o el movimiento pueden afectar la señal.' : 'Sigue estas recomendaciones antes de intentar otra vez.';
  show('retry');
}
function renderResults(data) {
  busy = false; releaseCamera();
  const accepted = acceptedResults(data);
  if (!accepted.length) {retry(data); return;}
  $('#result-cards').innerHTML = accepted.map(item => {
    const name = item.engine === 'open-rppg' ? 'Open-rppg' : 'Método original';
    const wave = waveformPath(item.bvp_waveform);
    return `<article class="result-card"><div class="result-label">${icons('pulse')}${name}</div><div class="pulse-number">${item.heart_rate_bpm.toFixed(0)}<span class="pulse-unit">latidos/min</span></div>${wave ? `<svg class="pulse-wave" viewBox="0 0 300 60" aria-label="Señal de pulso estimada"><path d="${wave}"/></svg>` : ''}<span class="status-pill good">${icons('check')}Señal suficiente para estimar</span></article>`;
  }).join('');
  const difference = data.comparison?.difference_bpm;
  $('#comparison-note').textContent = Number.isFinite(difference) ? `Diferencia: ${difference.toFixed(1)} latidos/min. La coincidencia entre métodos no demuestra precisión.` : 'La precisión de estas estimaciones aún está en evaluación.';
  $('#technical-results').innerHTML = (data.results || []).map(item => {
    const name = item.engine === 'open-rppg' ? 'Open-rppg' : 'Método original';
    if (!accepted.includes(item)) return `<div class="detail-row"><strong>${name}</strong><span>${escape(rejection({results:[item]}).message)}</span></div>`;
    const hrv = item.hrv || {};
    return `<div class="detail-row"><strong>${name}</strong><span>${escape(item.model_used)}</span></div>` +
      [['Pulso',item.heart_rate_bpm,'latidos/min'],['Variabilidad · RMSSD',hrv.rmssd_ms,'ms'],['Variabilidad · SDNN',hrv.sdnn_ms,'ms'],['Procesamiento',item.processing_seconds,'s']].filter(x => Number.isFinite(x[1])).map(([name,value,unit]) => `<div class="detail-row"><span>${name}</span><span>${value.toFixed(1)} ${unit}</span></div>`).join('') +
      (item.warnings || []).map(text => `<p class="small">${escape(text)}</p>`).join('');
  }).join('') + `<p class="small">La variabilidad del pulso de cámara no equivale a una medición mediante ECG.</p><pre>${escape(JSON.stringify({video:data.video,capture_quality:data.capture_quality,comparison:data.comparison},null,2))}</pre>`;
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
    $('#light-status').className = `status-pill ${good ? 'good' : 'dim'}`;
    $('#light-status span').textContent = good ? 'Luz adecuada' : light < 40 ? 'Busca más luz' : 'Evita luz directa';
  } catch { $('#light-status span').textContent = 'Mantén una luz uniforme'; }
}
async function startCamera() {
  if (busy) return;
  if (!args.ready) {toast('El análisis se está iniciando. Intenta de nuevo en unos momentos.'); return;}
  busy = true; show('record'); $('#camera-loading').hidden = false;
  $('#stop').disabled = true; $('#seconds').textContent = '0'; $('#timer-ring').style.strokeDashoffset = 320.443;
  $('#light-status').className = 'status-pill'; $('#light-status span').textContent = 'Comprobando luz…';
  chunks = []; bytes = 0; stoppedForSize = false; lightingSamples = 0;
  try {
    options();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Object.assign(new Error('Este navegador no permite grabar video. Usa Safari o Chrome actualizado, o sube un video.'), {name:'UnsupportedCamera'});
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
    const video = $('#camera');
    video.srcObject = stream;
    const playing = new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('No se pudo iniciar la cámara.')),12000);
      video.addEventListener('loadeddata', () => {clearTimeout(timeout); resolve();}, {once:true});
    });
    await video.play(); await playing;
    $('#camera-loading').hidden = true;
    const mime = chooseMime(MediaRecorder);
    recorder = new MediaRecorder(stream, {...(mime ? {mimeType:mime} : {}), videoBitsPerSecond:4_000_000});
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) {chunks.push(event.data); bytes += event.data.size;}
      if (bytes > MAX_BYTES && recorder.state === 'recording') {stoppedForSize = true; recorder.stop();}
    });
    recorder.addEventListener('error', () => {
      chunks=[]; bytes=0; retry({error:{code:'invalid_video',message:'La cámara no pudo completar la grabación.'}});
    });
    recorder.addEventListener('stop', async () => {
      const duration = elapsed;
      releaseCamera();
      if (stoppedForSize || !canAnalyzeCapture(duration,bytes)) {
        chunks=[]; busy=false;
        retry({error:{code:stoppedForSize?'invalid_video':'video_too_short',message:stoppedForSize?'La grabación superó 50 MB.':`Grabaste ${Math.floor(duration)} segundos. Necesitamos al menos ${MIN_SECONDS}.`}}); return;
      }
      const blob = new Blob(chunks,{type:recorder.mimeType || mime || 'video/webm'}); chunks=[];
      await submit(blob,blob.type);
    }, {once:true});
    recorder.start(500); started=performance.now(); elapsed=0;
    $('#stop').disabled=false;
    tick=setInterval(() => {
      elapsed=(performance.now()-started)/1000;
      $('#seconds').textContent=Math.min(TARGET_SECONDS,Math.floor(elapsed));
      $('.timer').setAttribute('aria-valuenow',Math.min(TARGET_SECONDS,Math.floor(elapsed)));
      $('#timer-ring').style.strokeDashoffset=320.443*(1-Math.min(elapsed/TARGET_SECONDS,1));
      checkLight(performance.now());
      if (elapsed >= TARGET_SECONDS && recorder.state==='recording') {$('#stop').disabled=true;recorder.stop();}
    },100);
    stream.getVideoTracks()[0].addEventListener('ended', () => {if(recorder?.state==='recording') recorder.stop();});
  } catch(error) {
    busy=false;releaseCamera();
    const code=['NotAllowedError','SecurityError'].includes(error.name) ? 'camera_denied' : ['NotFoundError','NotReadableError'].includes(error.name) ? 'camera_missing' : 'invalid_video';
    retry({error:{code,...(code==='invalid_video'?{message:error.name==='UnsupportedCamera' ? error.message : 'No se pudo iniciar la cámara. Intenta de nuevo o sube un video.'}: {})}});
  }
}
$('#start').addEventListener('click',startCamera);
$('#stop').addEventListener('click',() => {if(recorder?.state==='recording') {elapsed=(performance.now()-started)/1000;$('#stop').disabled=true;recorder.stop();}});
for (const id of ['retry-start','new-capture']) $('#'+id).addEventListener('click',reset);
for (const id of ['help-button','more-tips']) $('#'+id).addEventListener('click',() => {$('#help-dialog').showModal(); frameHeight();});
$('#menu-button').addEventListener('click',() => {$('#menu-dialog').showModal();frameHeight();});
for(const close of document.querySelectorAll('.close-dialog')) close.addEventListener('click',() => close.closest('dialog').close());
for(const button of document.querySelectorAll('[data-nav]')) button.addEventListener('click',() => {
  if (busy) return;
  if (button.dataset.nav==='results') {
    if (args.result) renderResults(args.result); else toast('Todavía no tienes una captura. Pulsa Estoy listo para comenzar.');
  } else {releaseCamera();show('prepare');}
});
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
window.addEventListener('pagehide',releaseCamera);
send('streamlit:componentReady',{apiVersion:1});frameHeight();
