import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { errorMessage, isMustChangePassword } from '../api/http';
import { maskPhone, normalizePhone } from '../utils/phone';

function apiError(status: number, message: unknown, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('fail', 'ERR', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { statusCode: status, message, ...(code ? { code } : {}) },
  });
}

describe('errorMessage', () => {
  it('后端的中文业务错误原样给店员看', () => {
    expect(errorMessage(apiError(400, '余额不足'))).toBe('余额不足');
    expect(errorMessage(apiError(409, '该手机号已开卡'))).toBe('该手机号已开卡');
  });

  it('英文字段校验和服务器故障换成白话', () => {
    expect(errorMessage(apiError(400, ['amountCent must be an integer number']))).toBe(
      '填写的内容格式不对，请检查后再试',
    );
    expect(errorMessage(apiError(500, 'Internal server error'))).toBe('系统出了点问题，请稍后再试');
    expect(errorMessage(apiError(403, 'Forbidden resource'))).toBe('没有权限执行这个操作');
  });

  it('断网', () => {
    expect(errorMessage(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe('连不上服务器，请检查网络后重试');
  });
});

describe('还没改初始密码', () => {
  it('认出服务端的 MUST_CHANGE_PASSWORD，提示原样给员工看', () => {
    const error = apiError(403, '请先修改初始密码', 'MUST_CHANGE_PASSWORD');
    expect(isMustChangePassword(error)).toBe(true);
    expect(errorMessage(error)).toBe('请先修改初始密码');
  });

  it('普通的没有权限不算', () => {
    expect(isMustChangePassword(apiError(403, '无权执行该操作'))).toBe(false);
    expect(isMustChangePassword(apiError(401, '登录已失效', 'MUST_CHANGE_PASSWORD'))).toBe(false);
    expect(isMustChangePassword(new Error('x'))).toBe(false);
  });
});

describe('手机号', () => {
  it('中间四位打码', () => {
    expect(maskPhone('13800138000')).toBe('138****8000');
    expect(maskPhone('')).toBe('');
  });

  it('去掉空格和 +86', () => {
    expect(normalizePhone('+86 138 0013 8000')).toBe('13800138000');
    expect(normalizePhone('138-0013-8000')).toBe('13800138000');
  });
});
