import test from 'node:test';
import assert from 'node:assert/strict';
import {METRIC_ROWS,modelName,metricValue,qualityLabel,respirationNote,resultViewItems} from './results.mjs';

test('switch compares the same results and preserves the actual fallback model',()=>{
 const open={engine:'open-rppg',accepted:true,heart_rate_bpm:72};
 const legacy={engine:'rPPG-Toolbox',model_used:'pos_fallback',accepted:false,heart_rate_bpm:null};
 const data={results:[open,legacy]};
 assert.deepEqual(resultViewItems(data,'compare'),[open,legacy]);
 assert.deepEqual(resultViewItems(data,'open-rppg'),[open]);
 assert.deepEqual(resultViewItems(data,'rPPG-Toolbox'),[legacy]);
 assert.match(modelName(legacy),/POS_FALLBACK/);
});
test('missing and rejected metrics never become zero or accepted readings',()=>{
 const row=METRIC_ROWS.find(x=>x[0]==='ln(RMSSD)');
 assert.equal(metricValue({accepted:true,heart_rate_bpm:72,hrv:{}},row[2]),'No disponible');
 assert.equal(metricValue({accepted:false,heart_rate_bpm:72,hrv:{lnrmssd:3.4}},row[2]),'Sin resultado');
 assert.equal(metricValue({accepted:true,heart_rate_bpm:72,hrv:{lnrmssd:0}},row[2]),'0.0');
});
test('signal quality retains units and unavailable respiration explains the next step',()=>{
 assert.match(qualityLabel({quality:{sqi:.8}}),/SQI 0.80/);
 assert.match(qualityLabel({quality:{snr_db:4}}),/SNR 4.0 dB/);
 assert.match(respirationNote({accepted:true,respiration:{status:'full_resolution_signal_unavailable'}}),/no entrega la señal completa/);
 assert.match(respirationNote({accepted:true,respiration:{status:'insufficient_contiguous_intervals'}}),/60 s/);
});
