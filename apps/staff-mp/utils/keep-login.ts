import { renewSession } from './api';
import { renewDue } from './renew';
import { loadSession, saveRenewed } from './session';

let renewing = false;

/**
 * 小程序每次回到前台时调用。到了续期时间就在后台换一张新的登录，店员感觉不到。
 * 没网、接口暂时不通就等下次打开再续。员工被停用、改过或被重置过密码时接口回 401，
 * 请求层会清掉本机登录并回到登录页。
 */
export function keepLoginFresh(): void {
  const session = loadSession();
  if (!session || renewing || !renewDue(session, Date.now())) {
    return;
  }
  renewing = true;
  renewSession(session.token)
    .then((login) => {
      saveRenewed(session.token, login);
    })
    .catch(() => undefined)
    .finally(() => {
      renewing = false;
    });
}
