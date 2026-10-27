Page({
  data: { from: '' },
  onLoad(options) {
    this.setData({ from: options.from });
  },
  call() {
    wx.makePhoneCall({ phoneNumber: '0571-88886666' });
  },
});
