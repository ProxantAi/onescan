import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedResults,rejection,canAnalyzeCapture,waveformPath,MAX_BYTES,chooseMime} from './core.mjs';
test('rejected or malformed engine results never become pulse cards',()=>{
 assert.equal(acceptedResults({results:[{accepted:false,heart_rate_bpm:72},{accepted:true,heart_rate_bpm:null},{accepted:true,heart_rate_bpm:NaN},{accepted:true,heart_rate_bpm:900}]}).length,0);
 const partial={results:[{accepted:true,heart_rate_bpm:74},{accepted:false,heart_rate_bpm:null}]};
 assert.equal(acceptedResults(partial).length,1);
});
test('recovery follows actual API reason, not a fabricated movement diagnosis',()=>{
 assert.equal(rejection({capture_quality:{reason:'poor_lighting'},results:[{reason:'low_signal_quality'}]}).code,'poor_lighting');
 assert.match(rejection({error:{code:'video_too_short',message:'Graba al menos 20 segundos.'}}).message,/20/);
});
test('short, empty and oversized captures cannot be analyzed',()=>{
 assert.equal(canAnalyzeCapture(19.9,1000),false); assert.equal(canAnalyzeCapture(30,0),false);
 assert.equal(canAnalyzeCapture(30,MAX_BYTES+1),false); assert.equal(canAnalyzeCapture(30,1000),true);
});
test('waveform handles constant and missing signals without nonfinite SVG coordinates',()=>{
 assert.equal(waveformPath([]),''); assert.equal(waveformPath([null,NaN]),'');
 assert.ok(!/NaN|Infinity/.test(waveformPath([1,1,1])));
});
test('recording selects supported browser format, including Safari MP4',()=>{
 assert.equal(chooseMime({isTypeSupported:x=>x==='video/mp4'}),'video/mp4');
 assert.equal(chooseMime({isTypeSupported:()=>false}),'');
});
import {readFileSync} from 'node:fs';
test('camera and navigation elements cannot collide with SVG symbol IDs',()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(new Set(ids).size,ids.length,'Duplicate IDs break camera selectors');
 assert.match(html,/<video id="camera"/);
});
