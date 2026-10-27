import { fetchStores, StoreView } from '../../utils/api';
import { Point } from '../../utils/geo';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';
import { StoreCard, toStoreCards } from '../../utils/stores';

type LocationState = 'unknown' | 'granted' | 'denied';

Page({
  data: {
    loading: true,
    error: '',
    cards: [] as StoreCard[],
    locationState: 'unknown' as LocationState,
  },

  stores: [] as StoreView[],
  here: null as Point | null,

  onLoad() {
    if (!ensureLogin()) {
      return;
    }
    this.load();
    // 会员以前同意过定位，就直接算距离；没同意过不主动弹窗，等会员自己点。
    wx.getSetting({
      success: (res) => {
        const granted = res.authSetting['scope.userLocation'];
        if (granted === true) {
          this.locate();
        } else if (granted === false) {
          this.setData({ locationState: 'denied' });
        }
      },
    });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      this.stores = await fetchStores();
      this.setData({ loading: false, error: '', cards: toStoreCards(this.stores, this.here) });
    } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
    }
  },

  retry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },

  locate() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.here = { latitude: res.latitude, longitude: res.longitude };
        this.setData({ locationState: 'granted', cards: toStoreCards(this.stores, this.here) });
      },
      fail: (res) => {
        if (/auth|deny|denied/i.test(res.errMsg)) {
          this.setData({ locationState: 'denied' });
        } else {
          wx.showToast({ title: '暂时没拿到位置，请稍后再试', icon: 'none' });
        }
      },
    });
  },

  /** 「开启定位」：拒绝过的要去设置页打开，没问过的直接请求。 */
  enableLocation() {
    if (this.data.locationState !== 'denied') {
      this.locate();
      return;
    }
    wx.openSetting({
      success: (res) => {
        if (res.authSetting['scope.userLocation']) {
          this.locate();
        }
      },
    });
  },

  findStore(event: WechatMiniprogram.TouchEvent): StoreView | undefined {
    const id = String(event.currentTarget.dataset.id ?? '');
    return this.stores.find((store) => store.id === id);
  },

  /** 先在微信地图里显示门店位置，会员可以再选腾讯、高德或百度地图导航。 */
  navigate(event: WechatMiniprogram.TouchEvent) {
    const store = this.findStore(event);
    if (!store) {
      return;
    }
    if (store.lat == null || store.lng == null) {
      wx.showToast({ title: '这家门店还没标位置，请先电话联系', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: store.lat,
      longitude: store.lng,
      name: store.name,
      address: store.address ?? '',
      scale: 16,
    });
  },

  call(event: WechatMiniprogram.TouchEvent) {
    const store = this.findStore(event);
    if (!store) {
      return;
    }
    if (!store.phone) {
      wx.showToast({ title: '这家门店还没留电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber: store.phone, fail: () => undefined });
  },
});
