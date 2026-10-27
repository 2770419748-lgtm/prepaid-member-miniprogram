Page({
  data: { items: [] },
  onLoad() {
    this.setData({ items: Array.from({ length: 40 }, (_, i) => i) });
  },
  onReachBottom() {
    this.setData({ items: this.data.items.concat(Array.from({ length: 10 }, (_, i) => this.data.items.length + i)) });
  },
});
