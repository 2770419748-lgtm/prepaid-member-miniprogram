import { keepLoginFresh } from './utils/keep-login';

// 会员小程序入口。登录检查放在各页面 onShow 里（见 utils/session.ts）。
// 登录默认 30 天，每次回到前台时看一下要不要续期，常用就一直不用重新登录。
// 充值和消费只在门店线下记账，这里没有任何支付能力。
App({
  onShow() {
    keepLoginFresh();
  },
});
