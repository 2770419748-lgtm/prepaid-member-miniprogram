// 预览工具自检：node tools/mp-preview/shoot.mjs tools/mp-preview/fixture/scenario.mjs
export default {
  app: '.',
  sheet: { title: '预览工具自检', columns: 3 },
  shots: [
    {
      name: 'fixture-a',
      caption: '列表、条件、点击、手机号、弹窗、定位、下拉刷新',
      route: 'pages/a/a',
      location: { latitude: 30.25, longitude: 120.16 },
      steps: [
        { expectText: '模式乙' },
        { expectText: '已启动' },
        { tap: '.row-1' },
        { expectText: '选中 x2' },
        { tap: '.phone-btn' },
        { expectText: 'preview-phone-code-1' },
        { tap: '.ask-btn' },
        { fill: ['.mp-modal textarea', '金额录错'] },
        { tap: '.mp-modal-confirm' },
        { expectText: '金额录错' },
        { tap: '.loc-btn' },
        { expectText: '30.25' },
        { pullDown: true },
        { expectText: '刷新 1 次' },
      ],
    },
    {
      name: 'fixture-b',
      caption: '切换 tab、触底加载',
      route: 'pages/a/a',
      steps: [{ tap: '.mp-tab[data-path="pages/b/b"]' }, { expectText: '共 40 行' }, { scroll: 99999 }, { expectText: '共 50 行' }],
    },
    {
      name: 'fixture-c',
      caption: '带参数跳转、底部固定栏、拨号',
      route: 'pages/a/a',
      steps: [{ tap: '.to-c' }, { expectText: '来自 a' }, { tap: '.call-btn' }, { expectText: '呼叫' }],
    },
  ],
};
