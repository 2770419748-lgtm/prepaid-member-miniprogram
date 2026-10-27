import { readFileSync } from 'fs';
import { join } from 'path';

describe('dependencies', () => {
  it('does not include a wechat pay sdk', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = names.filter((name) => /(wechatpay|weixin-pay|wxpay|tenpay)/i.test(name));
    expect(banned).toEqual([]);
  });
});
