import test from "node:test";
import assert from "node:assert/strict";
import { validateExamRun, validateExamRunOperation } from "../../src/lib/exam-schedule-validation.mjs";

const good = {testId:"10",testRevision:"42",planRevision:"1",runId:null,runRevision:null,kind:"regular",label:"Sesi 1",sessionNumber:1,startLocal:"2030-06-01T07:00",timeZone:"WIB",durationMinutes:60,questionMode:"inherit",participants:[{studentId:"12",placementId:"13"}],questions:[]};

test("pelaksanaan reguler memiliki sesi, waktu valid dan peserta unik",()=>{
  const parsed=validateExamRun(good); assert.equal(parsed.ok,true); assert.equal(parsed.value.startsAt,"2030-06-01T00:00:00.000Z");
  assert.equal(validateExamRun({...good,sessionNumber:null}).ok,false);
  assert.equal(validateExamRun({...good,startLocal:"2030-02-30T07:00"}).ok,false);
  assert.equal(validateExamRun({...good,participants:[good.participants[0],good.participants[0]]}).ok,false);
  assert.equal(validateExamRun({...good,durationMinutes:0}).ok,false);
  assert.equal(validateExamRun({...good,kind:"makeup",sessionNumber:null}).ok,true);
});

test("hanya remidi yang dapat memilih soal khusus",()=>{
  const q={id:"14",revision:"90"};
  assert.equal(validateExamRun({...good,questionMode:"custom",questions:[q]}).ok,false);
  assert.equal(validateExamRun({...good,kind:"remedial",sessionNumber:null,questionMode:"custom",questions:[q]}).ok,true);
  assert.equal(validateExamRun({...good,kind:"remedial",sessionNumber:null,questionMode:"custom",questions:[q,q]}).ok,false);
  assert.equal(validateExamRun({...good,questions:[q]}).ok,false);
});

test("identitas, revisi dan operasi pelaksanaan harus tunggal dan valid",()=>{
  assert.equal(validateExamRun({...good,runId:"5",runRevision:"39"}).ok,true);
  assert.equal(validateExamRun({...good,runId:"5",runRevision:null}).ok,false);
  assert.equal(validateExamRun({...good,runId:null,runRevision:"39"}).ok,false);
  assert.equal(validateExamRun({...good,runId:null,runRevision:"invalid"}).ok,false);
  assert.equal(validateExamRun({...good,testRevision:"0"}).ok,false);
  assert.equal(validateExamRun({...good,planRevision:"-1"}).ok,false);
  assert.equal(validateExamRun({...good,planRevision:"9223372036854775807"}).ok,false);
  const operation={testId:"10",testRevision:"42",planRevision:"1",runId:"5",runRevision:"39",operation:"publish"};
  assert.equal(validateExamRunOperation(operation).ok,true);
  assert.equal(validateExamRunOperation({...operation,operation:"other"}).ok,false);
  assert.equal(validateExamRunOperation({...operation,operation:["publish"]}).ok,false);
  assert.equal(validateExamRunOperation({...operation,operation:{toString:"publish"}}).ok,false);
  assert.equal(validateExamRunOperation({...operation,runId:"00"}).ok,false);
});
