import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isMainlandMobile, maskPhone, normalizePhone } from '../utils/phone';

test('手机号整理规则与服务端一致', () => {
  assert.equal(normalizePhone('138 0013 8000'), '13800138000');
  assert.equal(normalizePhone('+86 138-0013-8000'), '13800138000');
  assert.equal(normalizePhone('8613800138000'), '13800138000');
  assert.equal(normalizePhone('86138'), '86138');
});

test('只认 1 开头的 11 位手机号', () => {
  assert.equal(isMainlandMobile('13800138000'), true);
  assert.equal(isMainlandMobile('1380013800'), false);
  assert.equal(isMainlandMobile('23800138000'), false);
  assert.equal(isMainlandMobile('138001380001'), false);
});

test('中间四位打码', () => {
  assert.equal(maskPhone('13800138000'), '138****8000');
  assert.equal(maskPhone('12345'), '12345');
});
