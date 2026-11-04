import { openMemberHome } from '../../utils/mode';
import { saveSession as saveMemberSession } from '../../utils/session';
import { fetchOwnMemberSession } from './api';

/**
 * 工作台「切到我的会员卡」：员工自己也可以是会员。换一张自己手机号的会员登录，进会员首页看余额、出示会员码。
 * 员工登录留着，会员页「我的」里点「回到工作台」就回来，不用重新登录。
 */
export async function switchToMyMemberCard(): Promise<void> {
  const login = await fetchOwnMemberSession();
  saveMemberSession(login.accessToken, login.expiresIn);
  openMemberHome();
}
