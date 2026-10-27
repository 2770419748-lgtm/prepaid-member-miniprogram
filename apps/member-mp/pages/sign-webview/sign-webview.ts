import { isSignUrl } from '../../utils/sign';

/** 只放一个 web-view 打开电子签署页面。签完或点返回回到权益单页，那边会核对签署结果。 */
Page({
  data: {
    url: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const url = decodeURIComponent(options.url ?? '');
    this.setData({ url: isSignUrl(url) ? url : '' });
  },
});
