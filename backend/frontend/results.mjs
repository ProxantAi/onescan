import {acceptedResults} from './core.mjs';

export function modelName(item) {
  if(item.engine==='open-rppg')return 'FacePhys';
  const model=String(item.model_used || 'EfficientPhys');
  if(model.toLowerCase().includes('fallback'))return `${model.toUpperCase()} · respaldo`;
  return {efficientphys:'EfficientPhys',pos:'POS',chrom:'CHROM'}[model.toLowerCase()] || model;
}
export const METRIC_ROWS = [
  ['RMSSD','ms',x=>x.hrv?.rmssd_ms], ['SDNN','ms',x=>x.hrv?.sdnn_ms],
  ['ln(RMSSD)','',x=>x.hrv?.lnrmssd], ['pNN50','%',x=>x.hrv?.pnn50_percent],
  ['Respiración','resp/min',x=>x.respiration?.rate_bpm],
  ['Intervalos válidos','',x=>x.interval_quality?.status==='accepted'?x.heartbeats?.length:null],
];
export function metricValue(item,get,unit='') {
  if(!acceptedResults({results:[item]}).length)return 'Sin resultado';
  const value=get(item);
  return Number.isFinite(value)?`${value.toFixed(unit || get===METRIC_ROWS[2][2]?1:0)}${unit?' '+unit:''}`:'No disponible';
}
export function qualityLabel(item) {
  if(Number.isFinite(item.quality?.sqi))return `SQI ${item.quality.sqi.toFixed(2)} · mínimo ${item.quality.minimum_sqi ?? .5}`;
  if(Number.isFinite(item.quality?.snr_db))return `SNR ${item.quality.snr_db.toFixed(1)} dB · mínimo ${item.quality.minimum_snr_db ?? 0} dB`;
  return 'Calidad no disponible';
}
export function respirationNote(item) {
  if(!item.accepted)return item.reason==='engine_error'?'Este motor no pudo completar el cálculo.':'Este motor no obtuvo una señal de pulso suficiente.';
  return ({estimated:'Respiración estimada a partir de variaciones entre pulsos.',
    full_resolution_signal_unavailable:'Este motor no entrega la señal completa para calcular latidos y respiración.',
    insufficient_contiguous_intervals:'Respiración: usa el modo de 60 s; requiere al menos 45 s continuos de intervalos válidos.',
    respiratory_modulation_not_clear:'La variación respiratoria no fue suficientemente clara.',
    interval_quality_insufficient:'No hubo suficientes intervalos consistentes para estimar respiración.',
    intervals_not_computable:'No se pudieron detectar intervalos fiables en la señal.'})[item.respiration?.status] || 'Respiración no disponible en esta toma.';
}
export function resultViewItems(data,view='compare') {
  const results=data?.results || [];
  return view==='compare'?results:results.filter(x=>x.engine===view);
}
