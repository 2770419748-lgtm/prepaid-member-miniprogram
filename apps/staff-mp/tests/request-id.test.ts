import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { newRequestId } from '../utils/request-id';

test('请求号符合服务端格式', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(newRequestId(), /^[A-Za-z0-9_-]{8,64}$/);
  }
  assert.match(newRequestId(0, () => 0), /^[A-Za-z0-9_-]{8,64}$/);
  assert.match(newRequestId(Date.now(), () => 0.999999), /^[A-Za-z0-9_-]{8,64}$/);
});

test('每次点确认生成不同的号', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    ids.add(newRequestId());
  }
  assert.equal(ids.size, 1000);
});
