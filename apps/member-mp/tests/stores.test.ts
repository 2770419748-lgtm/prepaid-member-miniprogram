import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StoreView } from '../utils/api';
import { distanceMeters, formatDistance } from '../utils/geo';
import { toStoreCards } from '../utils/stores';

const stores: StoreView[] = [
  { id: 'far', name: '远店', address: '远路 1 号', lat: 30.3, lng: 120.2, phone: '0571-1', businessHours: '10:00-22:00' },
  { id: 'nowhere', name: '没坐标的店', address: null, lat: null, lng: null, phone: null, businessHours: null },
  { id: 'near', name: '近店', address: '近路 2 号', lat: 30.2601, lng: 120.1601, phone: '0571-2', businessHours: '09:00-21:00' },
];

test('距离计算与显示', () => {
  const meters = distanceMeters({ latitude: 30.26, longitude: 120.16 }, { latitude: 30.27, longitude: 120.16 });
  assert.ok(Math.abs(meters - 1112) < 5, `约 1.1 公里，实际 ${meters}`);
  assert.equal(formatDistance(0.3), '1m');
  assert.equal(formatDistance(850.4), '850m');
  assert.equal(formatDistance(1234), '1.2km');
  assert.equal(formatDistance(123456), '123km');
});

test('没定位：不显示距离，也不排序', () => {
  const cards = toStoreCards(stores, null);
  assert.deepEqual(cards.map((card) => card.id), ['far', 'nowhere', 'near']);
  assert.ok(cards.every((card) => card.distanceText === ''));
});

test('定位后：近的在前，没坐标的排最后且不编距离', () => {
  const cards = toStoreCards(stores, { latitude: 30.26, longitude: 120.16 });
  assert.deepEqual(cards.map((card) => card.id), ['near', 'far', 'nowhere']);
  assert.equal(cards[0].distanceText, '15m');
  assert.equal(cards[2].distanceText, '');
});

test('没坐标不能导航，没电话不能拨号', () => {
  const card = toStoreCards(stores, null).find((item) => item.id === 'nowhere');
  if (!card) throw new Error('没找到门店');
  assert.equal(card.canNavigate, false);
  assert.equal(card.canCall, false);
  assert.equal(card.address, '');
  assert.equal(card.hours, '');
});
