import { ConfigService } from '@nestjs/config';
import { EsignConfigService } from '../src/esign-config/esign-config.service';

describe('EsignConfigService', () => {
  function createService(env: Record<string, string | boolean> = {}): EsignConfigService {
    return new EsignConfigService(new ConfigService(env));
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
});
