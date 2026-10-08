import test from 'node:test';
import assert from 'node:assert/strict';
import {ovalPath,ringProgress} from './face-ring.mjs';
test('oval remains closed with uniform pixel inset in portrait and landscape',()=>{
  assert.equal(ovalPath(200,300),'M 100 5 A 95 145 0 1 1 100 295 A 95 145 0 1 1 100 5');
  assert.equal(ovalPath(300,200),'M 150 5 A 145 95 0 1 1 150 195 A 145 95 0 1 1 150 5');
  assert.equal(ovalPath(0,0),null);
});
test('progress hides the initial round cap and clamps invalid worker values',()=>{
  assert.deepEqual(ringProgress(0),{offset:100,opacity:0});
  assert.deepEqual(ringProgress(.5),{offset:50,opacity:1});
  assert.deepEqual(ringProgress(1.5),{offset:0,opacity:1});
  assert.deepEqual(ringProgress(NaN),{offset:100,opacity:0});
  assert.deepEqual(ringProgress(-1),{offset:100,opacity:0});
});
