import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { EsignApiError, EsignClient, EsignFetchInit } from '../src/esign/client/esign.client';
import { EsignConfigService } from '../src/esign-config/esign-config.service';

function configWith(env: Record<string, string>): EsignConfigService {
  const config = {
    get: (key: string) => (Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined),
  } as unknown as ConfigService;
  return new EsignConfigService(config);
}

const sandbox = {
  ESIGN_APP_ID: 'app-1',
  ESIGN_APP_SECRET: 'secret-1',
  ESIGN_API_HOST: 'https://smlopenapi.esign.cn',
};

function clientWith(env: Record<string, string>, reply: unknown = { code: 0, data: { signFlowId: 'f1' } }) {
  const calls: { url: string; init?: EsignFetchInit }[] = [];
  const client = new EsignClient(configWith(env));
  client.fetchImpl = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(reply),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  };
  return { client, calls };
}

const flowInput = {
  title: '权益单',
  fileId: 'file-1',
  fileName: '权益单.pdf',
  memberPhone: '13800138000',
  memberPosition: { page: 2, x: 200, y: 300 },
  sealPosition: { page: 2, x: 400, y: 300 },
  notifyUrl: null,
  redirectUrl: null,
};

describe('EsignClient', () => {
  it('signs requests to the sandbox gateway and reports SANDBOX', async () => {
    const { client, calls } = clientWith(sandbox);
    const result = await client.createSignFlow(flowInput);
    expect(result).toEqual({ signFlowId: 'f1', env: 'SANDBOX' });
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe('https://smlopenapi.esign.cn/v3/sign-flow/create-by-file');
    const headers = init!.headers!;
    const md5 = createHash('md5').update(init!.body!).digest('base64');
    expect(headers['Content-MD5']).toBe(md5);
    expect(headers['X-Tsign-Open-App-Id']).toBe('app-1');
    expect(headers['X-Tsign-Open-Auth-Mode']).toBe('Signature');
    const toSign = `POST\n*/*\n${md5}\napplication/json; charset=UTF-8\n\n/v3/sign-flow/create-by-file`;
    expect(headers['X-Tsign-Open-Ca-Signature']).toBe(createHmac('sha256', 'secret-1').update(toSign).digest('base64'));
    expect(JSON.stringify(headers)).not.toContain('secret-1');
  });

  it('refuses the production gateway while the switch is off, without sending anything', async () => {
    const { client, calls } = clientWith({ ...sandbox, ESIGN_API_HOST: 'https://openapi.esign.cn' });
    await expect(client.createSignFlow(flowInput)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(client.getSignFlowDetail('f1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(calls).toHaveLength(0);
  });

  it('allows the production gateway only when the switch is on, and reports PRODUCTION', async () => {
    const { client } = clientWith({
      ...sandbox,
      ESIGN_API_HOST: 'https://openapi.esign.cn',
      ESIGN_PRODUCTION_ENABLED: 'true',
    });
    await expect(client.createSignFlow(flowInput)).resolves.toEqual({ signFlowId: 'f1', env: 'PRODUCTION' });
  });

  it('refuses unknown gateways', async () => {
    const { client, calls } = clientWith({ ...sandbox, ESIGN_API_HOST: 'https://esign.example.com' });
    await expect(client.getSignFlowDetail('f1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(calls).toHaveLength(0);
  });

  it('needs sandbox credentials', async () => {
    const { client, calls } = clientWith({ ESIGN_API_HOST: 'https://smlopenapi.esign.cn' });
    await expect(client.getSignFlowDetail('f1')).rejects.toThrow('电子签沙箱未配置');
    expect(calls).toHaveLength(0);
  });

  it('turns e-sign business errors into a 502 with the e-sign message', async () => {
    const { client } = clientWith(sandbox, { code: 1435002, message: '流程不存在' });
    const error = await client.getSignFlowDetail('f1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EsignApiError);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as EsignApiError).esignMessage).toBe('流程不存在');
  });

  it('picks the last occurrence of each keyword', async () => {
    const { client } = clientWith(sandbox, {
      code: 0,
      data: {
        keywordPositions: [
          {
            keyword: '会员签字',
            searchResult: true,
            positions: [
              { pageNum: 1, coordinates: [{ positionX: 10, positionY: 20 }] },
              { pageNum: 3, coordinates: [{ positionX: 30, positionY: 40 }] },
            ],
          },
          { keyword: '商家盖章', searchResult: false, positions: [] },
        ],
      },
    });
    const found = await client.findKeywords('file-1', ['会员签字', '商家盖章']);
    expect(found.get('会员签字')).toEqual({ page: 3, x: 30, y: 40 });
    expect(found.get('商家盖章')).toBeNull();
  });
});
