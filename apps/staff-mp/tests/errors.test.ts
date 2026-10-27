import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ApiError, errorMessage, messageOf, toApiError } from '../utils/errors';

test('服务端的中文原因直接给店员看', () => {
  assert.equal(errorMessage(400, { statusCode: 400, message: '余额不足，当前余额 70.00 元' }), '余额不足，当前余额 70.00 元');
  assert.equal(errorMessage(409, { message: '这笔流水已经冲正过' }), '这笔流水已经冲正过');
  assert.equal(errorMessage(403, { message: ['无权操作该门店'] }), '无权操作该门店');
  assert.equal(errorMessage(401, { message: '账号未开通' }), '账号未开通');
});

test('英文和技术信息换成白话', () => {
  assert.equal(errorMessage(400, { message: ['amountCent must be an integer number'] }), '提交的内容有误，请检查后重试');
  assert.equal(errorMessage(401, { message: 'Unauthorized' }), '登录已过期，请重新登录');
  assert.equal(errorMessage(500, { message: '数据库连接失败' }), '系统开小差了，请稍后再试');
  assert.equal(errorMessage(0, null), '网络不稳定，请检查网络后重试');
  assert.equal(errorMessage(404, 'Not Found'), '提交的内容有误，请检查后重试');
});

test('网络不通或服务端出错时，结果不确定，只能用同一个请求号重试', () => {
  assert.equal(toApiError(0, null).uncertain, true);
  assert.equal(toApiError(502, null).uncertain, true);
  assert.equal(toApiError(400, null).uncertain, false);
  assert.equal(toApiError(409, null).uncertain, false);
});

test('非接口错误也不暴露技术细节', () => {
  assert.equal(messageOf(new Error('TypeError: x is undefined')), '系统开小差了，请稍后再试');
  assert.equal(messageOf(new ApiError(400, '会员还没开卡')), '会员还没开卡');
});
