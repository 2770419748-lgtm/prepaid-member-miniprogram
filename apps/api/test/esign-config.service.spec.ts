import { ConfigService } from '@nestjs/config';
import { EsignConfigService } from '../src/esign-config/esign-config.service';

describe('EsignConfigService', () => {
  /**
   * Nest ConfigService.get 先读 process.env，再读构造参数。
   * CI 会把 ESIGN_PRODUCTION_ENABLED=false 写进环境，因此这里用只返回注入值的替身，避免被进程环境盖掉。
   */
  function createService(env: Record<string, string | boolean> = {}): EsignConfigService {
    const config = {
      get: (key: string) => (Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined),
    } as unknown as ConfigService;
    return new EsignConfigService(config);
  }

  it('defaults esign.production.enabled to false', () => {
    const service = createService();
    expect(service.productionEnabled).toBe(false);
    expect(() => service.assertSandboxUnlessEnabled('SANDBOX')).not.toThrow();
    expect(() => service.assertSandboxUnlessEnabled('PRODUCTION')).toThrow(
      /esign\.production\.enabled is false/,
    );
  });

  it('treats explicit false strings as disabled', () => {
    const service = createService({ ESIGN_PRODUCTION_ENABLED: 'false' });
    expect(service.productionEnabled).toBe(false);
    expect(() => service.assertSandboxUnlessEnabled('PRODUCTION')).toThrow(
      /production signing is refused/,
    );
  });

  it('allows production target only when the flag is true', () => {
    const service = createService({ ESIGN_PRODUCTION_ENABLED: 'true' });
    expect(service.productionEnabled).toBe(true);
    expect(() => service.assertSandboxUnlessEnabled('PRODUCTION')).not.toThrow();
  });

  it('falls back to the sandbox host', () => {
    const service = createService();
    expect(service.apiHost).toBe('https://smlopenapi.esign.cn');
  });

  it('targets the sandbox gateway by default', () => {
    expect(createService().resolveTarget()).toEqual({ env: 'SANDBOX', baseUrl: 'https://smlopenapi.esign.cn' });
  });

  it('refuses the production gateway while the switch is off', () => {
    const service = createService({ ESIGN_API_HOST: 'https://openapi.esign.cn' });
    expect(() => service.resolveTarget()).toThrow(/production signing is refused/);
  });

  it('marks the production gateway as PRODUCTION once the switch is on', () => {
    const service = createService({ ESIGN_API_HOST: 'https://openapi.esign.cn', ESIGN_PRODUCTION_ENABLED: 'true' });
    expect(service.resolveTarget()).toEqual({ env: 'PRODUCTION', baseUrl: 'https://openapi.esign.cn' });
  });

  it('refuses unknown hosts, plain http, and a local fake sandbox in production', () => {
    expect(() => createService({ ESIGN_API_HOST: 'https://esign.example.com' }).resolveTarget()).toThrow();
    expect(() => createService({ ESIGN_API_HOST: 'http://smlopenapi.esign.cn' }).resolveTarget()).toThrow(/https/);
    expect(createService({ ESIGN_API_HOST: 'http://127.0.0.1:9999' }).resolveTarget().env).toBe('SANDBOX');
    expect(() =>
      createService({ ESIGN_API_HOST: 'http://127.0.0.1:9999', NODE_ENV: 'production' }).resolveTarget(),
    ).toThrow();
  });
});
