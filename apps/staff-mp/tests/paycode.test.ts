import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiError } from '../utils/errors';
import { cleanScanned, consumeEntryUrl, needsRescan, validUntilText } from '../utils/paycode';

test('扫到的内容去掉空白和换行', () => {
  assert.equal(cleanScanned(' 8681 2345 6789 012345\n'), '868123456789012345');
});

test('扫码后带着会员、码和有效期去填金额', () => {
  assert.equal(
    consumeEntryUrl('member-1', '868123456789012345', '2026-10-27T10:25:00.000Z'),
    '/pages/entry/entry?kind=CONSUME&memberId=member-1&payCode=868123456789012345&until=2026-10-27T10%3A25%3A00.000Z',
  );
});

test('有效期按北京时间显示', () => {
  assert.equal(validUntilText('2026-10-27T10:25:00.000Z'), '18:25 前有效');
});

test('码过期、用过、不是这位会员的、不是你扫的：请顾客刷新重扫', () => {
  assert.equal(needsRescan(new ApiError(400, '扫码已超过 5 分钟，请顾客刷新会员码后重新扫')), true);
  assert.equal(needsRescan(new ApiError(409, '这张会员码已经用过了，请顾客刷新会员码后重新扫')), true);
  assert.equal(needsRescan(new ApiError(403, '这张会员码不是你在这家门店扫的，请重新扫码')), true);
  assert.equal(needsRescan(new ApiError(400, '请先扫顾客的会员码')), true);
});

test('余额不足、网络问题不用重扫', () => {
  assert.equal(needsRescan(new ApiError(400, '余额不足')), false);
  assert.equal(needsRescan(new ApiError(0, '网络不稳定，请检查网络后重试')), false);
  assert.equal(needsRescan(new Error('会员码')), false);
});
