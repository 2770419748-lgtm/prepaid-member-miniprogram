import { createHmac } from 'crypto';
import {
  callbackSignature,
  contentMd5,
  requestSignature,
  signatureMatches,
  signedPath,
  stringToSign,
} from '../src/esign/client/esign-signature';

describe('esign signature', () => {
  it('builds the v3 string to sign line by line', () => {
    const body = '{"docTemplateId":"t1"}';
    const md5 = contentMd5(body);
    expect(md5).toBe('fAqrCOhNnzpEUhoA8q7v6g==');
    expect(
      stringToSign({
        method: 'post',
        pathWithQuery: '/v3/files/create-by-doc-template',
        contentMd5: md5,
        contentType: 'application/json; charset=UTF-8',
      }),
    ).toBe(
      'POST\n*/*\nfAqrCOhNnzpEUhoA8q7v6g==\napplication/json; charset=UTF-8\n\n/v3/files/create-by-doc-template',
    );
  });

  it('leaves Content-MD5 and Content-Type empty for a GET without body', () => {
    expect(contentMd5(null)).toBe('');
    expect(stringToSign({ method: 'GET', pathWithQuery: '/v3/sign-flow/f1/detail', contentMd5: '', contentType: '' })).toBe(
      'GET\n*/*\n\n\n\n/v3/sign-flow/f1/detail',
    );
  });

  it('sorts query parameters by name and keeps bare names for empty values', () => {
    expect(signedPath('/v3/x', { pageSize: '10', a: '', pageNum: '1' })).toBe('/v3/x?a&pageNum=1&pageSize=10');
    expect(signedPath('/v3/x')).toBe('/v3/x');
  });

  it('signs with HMAC-SHA256 and base64', () => {
    const expected = createHmac('sha256', 'secret').update('GET\n*/*\n\n\n\n/v3/x').digest('base64');
    expect(requestSignature('secret', 'GET\n*/*\n\n\n\n/v3/x')).toBe(expected);
  });

  it('verifies callbacks over timestamp + sorted query values + raw body, in lowercase hex', () => {
    const raw = Buffer.from('{"action":"SIGN_FLOW_COMPLETE","signFlowId":"f1"}');
    const expected = createHmac('sha256', 'secret')
      .update(`1700000000000${'v1v2'}${raw.toString()}`)
      .digest('hex');
    expect(callbackSignature('secret', '1700000000000', { b: 'v2', a: 'v1' }, raw)).toBe(expected);
    expect(signatureMatches(expected, expected.toUpperCase())).toBe(true);
    expect(signatureMatches(expected, expected.slice(1))).toBe(false);
  });
});
