import { renewLogin } from './api';
import { saveRenewed, tokenToRenew } from './session';

let renewing = false;

/**
 * 小程序每次回到前台时调用。到了续期时间就在后台换一张新的登录，会员感觉不到。
 * 没网、接口暂时不通就等下次打开再续。账号被停用时接口回 401，请求层会清掉本机登录并回到登录页。
 */
export function keepLoginFresh(): void {
  const token = tokenToRenew();
  if (!token || renewing) {
    return;
  }
  renewing = true;
  renewLogin()
    .then((result) => {
      saveRenewed(token, result.accessToken, result.expiresIn);
    })
    .catch(() => undefined)
    .finally(() => {
      renewing = false;
    });
}
