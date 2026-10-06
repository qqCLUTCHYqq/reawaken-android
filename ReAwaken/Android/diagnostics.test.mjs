import test from 'node:test';
import assert from 'node:assert/strict';
import {BetaDiagnostics,errorCodes,packageCrashCodes,appLogErrorCodes} from './diagnostics.mjs';
test('Exported errors discard credentials, paths, serials, account strings and raw logs',()=>{
  const raw='Permission denied C:\\Users\\Alice\\private password=hunter2 token=secret alice@example.com SERIAL123 https://secret.example/abcdef';
  assert.deepEqual(errorCodes(raw),['ACCESS_DENIED']);
  const d=new BetaDiagnostics();d.fail(Error(raw));d.record('ADB','DEVICE_COMMAND',raw);
  const exported=JSON.stringify(d.report);
  for(const secret of ['Alice','hunter2','secret','alice@example.com','SERIAL123','abcdef'])assert(!exported.includes(secret));
});
test('Crash extraction excludes unrelated processes and all arbitrary messages',()=>{
  const log='Process: com.unrelated.app, PID: 1\njava.lang.UnsatisfiedLinkError password=secret\nProcess: com.square_enix.android_googleplay.khuxww, PID: 2\njava.lang.SecurityException token=secret\nProcess: com.other.app, PID: 3\nOutOfMemoryError\n';
  assert.deepEqual(packageCrashCodes(log),['JAVA_SECURITY_EXCEPTION']);
});
test('A transfer failure never becomes successful placement/hash verification',()=>{
  const d=new BetaDiagnostics();d.validated();d.progress({phase:'installing-apk'});d.progress({phase:'transferring'});d.fail(Error('device offline'));
  assert.equal(d.report.results.obbPlacement,'FAIL');assert.equal(d.report.results.obbHashVerification,'NOT_RUN');assert.equal(d.report.results.launch,'NOT_RUN');
});
test('Routine game logs cannot be reported as file-integrity failures',()=>{
  assert.deepEqual(appLogErrorCodes('I/Game(123): Integrity service ready\nD/Game(123): checksum cached\n'),[]);
  assert.deepEqual(appLogErrorCodes('E/Game(123): java.lang.UnsatisfiedLinkError secret=private\n'),['NATIVE_LIBRARY_LOAD_FAILED']);
});
