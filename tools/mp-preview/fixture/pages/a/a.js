const { label } = require('../../utils/label');

Page({
  data: { list: [{ id: 'x1', name: '甲' }, { id: 'x2', name: '乙' }], mode: 'b', picked: '', phone: '', reason: '', refreshed: 0, launched: false, far: 0 },
  onLoad() {
    this.setData({ launched: getApp().globalData.launched });
  },
  pick(event) {
    this.setData({ picked: label(event.currentTarget.dataset.itemId) });
  },
  onPhone(event) {
    this.setData({ phone: event.detail.code || event.detail.errMsg });
  },
  ask() {
    wx.showModal({ title: '原因', editable: true, placeholderText: '填写原因' }).then((res) => {
      if (res.confirm) this.setData({ reason: res.content });
    });
  },
  locate() {
    wx.getLocation({ type: 'gcj02' }).then((res) => this.setData({ far: res.latitude }), (err) => this.setData({ far: err.errMsg }));
  },
  onPullDownRefresh() {
    this.setData({ refreshed: this.data.refreshed + 1 });
    wx.stopPullDownRefresh();
  },
});
