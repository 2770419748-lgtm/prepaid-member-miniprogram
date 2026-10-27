// 浏览器里的小程序运行时（预览专用）。
// 支持的范围见 tools/mp-preview/README.md：Page / App、常用 wx 接口、WXML 常用语法和 WXSS 的 rpx。
// 页面代码不改一行；没模拟的 wx 接口会在控制台提示并走 fail 回调。

(function () {
  const preview = Object.assign(
    {
      route: null,
      storage: {},
      authSetting: {},
      location: null,
      phoneDeny: false,
      envVersion: 'develop',
      scanResult: null,
    },
    window.__MP_PREVIEW__ || {},
  );
  const query = new URLSearchParams(location.search);
  if (query.get('route')) preview.route = query.get('route');

  const APP = '/app/';
  const SCREEN_WIDTH = 375;
  const RPX = SCREEN_WIDTH / 750;
  const errors = [];

  function reportError(where, error) {
    const message = `${where}: ${error && error.stack ? error.stack : error}`;
    errors.push(message);
    console.error('[mp-preview]', message);
  }

  window.addEventListener('error', (event) => reportError('window', event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => reportError('promise', event.reason));

  // ---------------------------------------------------------------- 文件与模块

  /** 同步读文件。可选文件不存在时服务端回 204，免得控制台刷 404。 */
  function fetchText(path) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${path}?optional=1`, false);
    xhr.send();
    return xhr.status === 200 ? xhr.responseText : null;
  }

  function dirOf(path) {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
  }

  function joinPath(base, relative) {
    const parts = relative.startsWith('/') ? [] : base.split('/').filter(Boolean);
    for (const part of relative.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  const modules = new Map();

  function requireModule(path) {
    const id = path.replace(/\.(js|ts)$/, '');
    if (modules.has(id)) return modules.get(id).exports;
    let real = id;
    let source = fetchText(`${APP}${id}.js`);
    if (source == null) {
      real = `${id}/index`;
      source = fetchText(`${APP}${real}.js`);
    }
    if (source == null) throw new Error(`找不到模块 ${id}`);
    const module = { exports: {} };
    modules.set(id, module);
    const factory = new Function(
      'module',
      'exports',
      'require',
      `${source}\n//# sourceURL=${location.origin}${APP}${real}.js`,
    );
    factory(module, module.exports, (request) => requireModule(joinPath(dirOf(real), request)));
    return module.exports;
  }

  function readJson(path, fallback) {
    const text = fetchText(APP + path);
    return text == null ? fallback : JSON.parse(text);
  }

  // ---------------------------------------------------------------- WXSS

  const TAGS = 'scroll-view|page|view|text|button|image|navigator|input|textarea|icon|label|form|switch|picker|rich-text|canvas';
  const TAG_SELECTOR = new RegExp(`(^|[\\s>+~,(])(${TAGS})(?=$|[\\s>+~,.:#\\[)])`, 'g');

  function convertUnits(css) {
    return css
      .replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${+(parseFloat(n) * RPX).toFixed(4)}px`)
      .replace(/(?:env|constant)\(\s*safe-area-inset-bottom\s*\)/g, 'var(--safe-bottom, 0px)')
      .replace(/(?:env|constant)\(\s*safe-area-inset-(?:top|left|right)\s*\)/g, '0px');
  }

  function matchBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return css.length;
  }

  function mapSelectors(css) {
    let out = '';
    let i = 0;
    while (i < css.length) {
      const open = css.indexOf('{', i);
      if (open < 0) {
        out += css.slice(i);
        break;
      }
      const prelude = css.slice(i, open);
      const close = matchBrace(css, open);
      const body = css.slice(open + 1, close);
      const head = prelude.trim();
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        out += `${prelude}{${mapSelectors(body)}}`;
      } else if (head.startsWith('@')) {
        out += `${prelude}{${body}}`;
      } else {
        out += `${prelude.replace(TAG_SELECTOR, (_, before, tag) => `${before}.wx-${tag}`)}{${body}}`;
      }
      i = close + 1;
    }
    return out;
  }

  function loadWxss(path) {
    const text = fetchText(APP + path);
    if (text == null) return '';
    const withImports = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import\s+["']([^"']+)["']\s*;?/g, (_, file) => loadWxss(joinPath(dirOf(path), file)));
    return mapSelectors(convertUnits(withImports));
  }

  function addStyle(css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }

  // ---------------------------------------------------------------- WXML

  const expressions = new Map();

  function scopeProxy(scope) {
    return new Proxy(scope, {
      has: () => true,
      get: (target, key) => (key === Symbol.unscopables ? undefined : target[key]),
    });
  }

  function evaluate(expression, scope) {
    try {
      let fn = expressions.get(expression);
      if (!fn) {
        fn = new Function('__scope', `with (__scope) { return (${expression}); }`);
        expressions.set(expression, fn);
      }
      return fn(scopeProxy(scope));
    } catch (error) {
      reportError(`表达式 {{${expression}}}`, error);
      return undefined;
    }
  }

  const SINGLE = /^\s*\{\{((?:(?!\}\}|\{\{)[\s\S])+)\}\}\s*$/;
  const MUSTACHE = /\{\{([\s\S]+?)\}\}/g;

  function toText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function interpolate(raw, scope) {
    const single = raw.match(SINGLE);
    if (single) return evaluate(single[1], scope);
    if (!raw.includes('{{')) return raw;
    return raw.replace(MUSTACHE, (_, expression) => toText(evaluate(expression, scope)));
  }

  /** WXML 的布尔属性：空字符串算真，"false" 这样的非空字符串也算真（和真机一样）。 */
  function flag(value) {
    return value === '' || Boolean(value);
  }

  function camel(name) {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  const templates = new Map();

  function loadTemplate(route) {
    if (!templates.has(route)) {
      const text = fetchText(`${APP}${route}.wxml`);
      if (text == null) throw new Error(`找不到 ${route}.wxml`);
      const template = document.createElement('template');
      template.innerHTML = text;
      templates.set(route, template);
    }
    return templates.get(route);
  }

  const EVENT = /^(capture-)?(bind|catch|mut-bind):?(.+)$/;

  function wxTarget(node) {
    let current = node;
    while (current && !current.__wx) current = current.parentElement;
    return current;
  }

  function makeEvent(type, current, target, detail) {
    return {
      type,
      timeStamp: Math.round(performance.now()),
      detail: detail || {},
      target: { id: target ? target.id : '', dataset: target ? { ...target.__dataset } : {} },
      currentTarget: { id: current.id, dataset: { ...current.__dataset } },
      mark: {},
      touches: [],
      changedTouches: [],
    };
  }

  function callHandler(record, name, event) {
    const handler = record.inst[name];
    if (typeof handler !== 'function') {
      console.warn(`[mp-preview] 页面 ${record.route} 没有方法 ${name}`);
      return;
    }
    try {
      handler.call(record.inst, event);
    } catch (error) {
      reportError(`${record.route}.${name}`, error);
    }
  }

  function fire(record, element, type, detail, target) {
    const binding = element.__events[type];
    if (!binding) return false;
    callHandler(record, binding.handler, makeEvent(type, element, target || element, detail));
    return binding.catch;
  }

  function resolveSrc(record, src) {
    if (!src || /^(https?:|data:|blob:)/.test(src)) return src;
    return APP + joinPath(src.startsWith('/') ? '' : dirOf(record.route), src);
  }

  const OBJECT_FIT = { aspectFit: 'contain', aspectFill: 'cover', scaleToFill: 'fill', center: 'none' };

  function renderElement(node, scope, parent, record) {
    const tag = node.localName;
    if (tag === 'block') {
      renderChildren(node.childNodes, scope, parent, record);
      return;
    }
    const domTag = { image: 'img', img: 'img', input: 'input', textarea: 'textarea', text: 'span', canvas: 'canvas' }[tag] || 'div';
    const element = document.createElement(domTag);
    element.__wx = true;
    element.__dataset = {};
    element.__events = {};
    const props = {};
    let className = `wx-${tag === 'img' ? 'image' : tag}`;

    for (const attr of Array.from(node.attributes)) {
      const name = attr.name;
      if (name.startsWith('wx:')) continue;
      const value = interpolate(attr.value, scope);
      const event = name.match(EVENT);
      if (event) {
        element.__events[event[3]] = { handler: value, catch: event[2] === 'catch' };
        if (event[3] === 'tap') element.setAttribute('data-tap', '');
      } else if (name === 'class') {
        className += ` ${toText(value)}`;
      } else if (name === 'style') {
        element.setAttribute('style', convertUnits(toText(value)));
      } else if (name === 'id') {
        element.id = toText(value);
      } else if (name.startsWith('data-')) {
        element.__dataset[camel(name.slice(5))] = value;
      } else {
        props[name] = value;
      }
    }
    element.className = className.trim();
    if ('hidden' in props && flag(props.hidden)) element.style.display = 'none';

    if (tag === 'image' || tag === 'img') {
      element.src = resolveSrc(record, toText(props.src));
      const mode = toText(props.mode) || 'scaleToFill';
      if (mode === 'widthFix') element.style.height = 'auto';
      else element.style.objectFit = OBJECT_FIT[mode] || 'fill';
    }

    if (tag === 'button') {
      const disabled = 'disabled' in props && flag(props.disabled);
      if (props.type) element.dataset.type = toText(props.type);
      if (props.size) element.dataset.size = toText(props.size);
      if (disabled) element.dataset.disabled = '';
      if ('loading' in props && flag(props.loading)) {
        const spinner = document.createElement('span');
        spinner.className = 'mp-btn-loading';
        element.appendChild(spinner);
      }
      element.__disabled = disabled;
      element.__openType = toText(props['open-type']);
    }

    if (tag === 'navigator') {
      element.__nav = {
        url: toText(props.url),
        openType: toText(props['open-type']) || 'navigate',
        delta: Number(props.delta || 1),
      };
    }

    if (tag === 'input' || tag === 'textarea') {
      if (props.placeholder) element.placeholder = toText(props.placeholder);
      if (props.value !== undefined) element.value = toText(props.value);
      if (props.maxlength) element.maxLength = Number(props.maxlength);
      if (tag === 'input') {
        const type = toText(props.type);
        element.type = 'password' in props && flag(props.password) ? 'password' : type === 'number' || type === 'digit' ? 'tel' : 'text';
      }
      if ('disabled' in props && flag(props.disabled)) element.disabled = true;
      element.addEventListener('input', () => {
        fire(record, element, 'input', { value: element.value, cursor: element.selectionStart, keyCode: 0 });
      });
      element.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && tag === 'input') fire(record, element, 'confirm', { value: element.value });
      });
      element.addEventListener('blur', () => fire(record, element, 'blur', { value: element.value }));
      element.addEventListener('focus', () => fire(record, element, 'focus', { value: element.value }));
    }

    // web-view 在真机上铺满整页打开外部网页；预览里不加载，只画一个占位，写明要打开的地址。
    if (tag === 'web-view') {
      const src = toText(props.src);
      let host = src;
      try {
        host = new URL(src).host;
      } catch {
        // 不是完整地址就原样显示。
      }
      element.innerHTML =
        '<div class="mp-webview-box"><div class="mp-webview-icon"></div>' +
        `<div class="mp-webview-host">${escapeHtml(host)}</div>` +
        '<div class="mp-webview-note">真机会在这里打开这个网页（预览不加载外部网页）</div></div>';
      element.dataset.src = src;
    }

    if (tag === 'scroll-view') {
      element.style.overflowY = 'scroll-y' in props && flag(props['scroll-y']) ? 'auto' : 'hidden';
      element.style.overflowX = 'scroll-x' in props && flag(props['scroll-x']) ? 'auto' : 'hidden';
    }

    element.addEventListener('click', (domEvent) => {
      if (element.__disabled) return;
      const target = wxTarget(domEvent.target) || element;
      if (fire(record, element, 'tap', {}, target)) domEvent.stopPropagation();
      if (element.__openType === 'getPhoneNumber' || element.__openType === 'getRealtimePhoneNumber') {
        const type = element.__openType === 'getPhoneNumber' ? 'getphonenumber' : 'getrealtimephonenumber';
        phoneSeq += 1;
        const detail = preview.phoneDeny
          ? { errMsg: `${element.__openType}:fail user deny` }
          : { errMsg: `${element.__openType}:ok`, code: `preview-phone-code-${phoneSeq}` };
        setTimeout(() => fire(record, element, type, detail), 0);
      }
      if (element.__nav) {
        const { url, openType, delta } = element.__nav;
        const api = { navigate: 'navigateTo', redirect: 'redirectTo', switchTab: 'switchTab', reLaunch: 'reLaunch', navigateBack: 'navigateBack' }[openType];
        if (api) wx[api]({ url, delta });
      }
    });

    // canvas 的画面在节点上：每次 setData 重绘页面时沿用同一个节点（按 id），和真机一样画过的不会丢。
    if (tag === 'canvas' && element.id) {
      record.canvases = record.canvases || new Map();
      const kept = record.canvases.get(element.id);
      if (kept) {
        kept.className = element.className;
        kept.setAttribute('style', element.getAttribute('style') || '');
        parent.appendChild(kept);
        return;
      }
      record.canvases.set(element.id, element);
    }

    renderChildren(node.childNodes, scope, element, record);
    parent.appendChild(element);
  }

  let phoneSeq = 0;

  function renderChildren(nodes, scope, parent, record) {
    let chain = null; // null：不在 wx:if 链里；true / false：链里前面是否已经命中
    for (const node of Array.from(nodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent.trim()) continue;
        chain = null;
        parent.appendChild(document.createTextNode(toText(interpolate(node.textContent.trim(), scope))));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      if (node.hasAttribute('wx:if')) {
        const ok = Boolean(interpolate(node.getAttribute('wx:if'), scope));
        chain = ok;
        if (!ok) continue;
      } else if (node.hasAttribute('wx:elif')) {
        if (chain === null || chain) continue;
        const ok = Boolean(interpolate(node.getAttribute('wx:elif'), scope));
        chain = ok;
        if (!ok) continue;
      } else if (node.hasAttribute('wx:else')) {
        const skip = chain === null || chain;
        chain = null;
        if (skip) continue;
      } else {
        chain = null;
      }

      if (node.hasAttribute('wx:for') || node.hasAttribute('wx:for-items')) {
        const list = interpolate(node.getAttribute('wx:for') || node.getAttribute('wx:for-items'), scope);
        const itemName = node.getAttribute('wx:for-item') || 'item';
        const indexName = node.getAttribute('wx:for-index') || 'index';
        let entries = [];
        if (Array.isArray(list)) entries = list.map((item, index) => [index, item]);
        else if (typeof list === 'number') entries = Array.from({ length: list }, (_, i) => [i, i]);
        else if (typeof list === 'string') entries = Array.from(list).map((item, index) => [index, item]);
        else if (list && typeof list === 'object') entries = Object.keys(list).map((key) => [key, list[key]]);
        for (const [index, item] of entries) {
          const child = Object.create(scope);
          child[itemName] = item;
          child[indexName] = index;
          renderElement(node, child, parent, record);
        }
      } else {
        renderElement(node, scope, parent, record);
      }
    }
  }

  // ---------------------------------------------------------------- setData

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function setPath(target, path, value) {
    const keys = [];
    path.replace(/[^.[\]]+|\[(\d+)\]/g, (match, index) => {
      keys.push(index !== undefined ? Number(index) : match);
      return match;
    });
    let current = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i];
      if (current[key] === null || typeof current[key] !== 'object') {
        current[key] = typeof keys[i + 1] === 'number' ? [] : {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
  }

  const dirty = new Set();
  let flushQueued = false;

  function scheduleRender(record) {
    dirty.add(record);
    if (flushQueued) return;
    flushQueued = true;
    requestAnimationFrame(() => {
      flushQueued = false;
      const records = Array.from(dirty);
      dirty.clear();
      for (const item of records) if (!item.unloaded) renderPage(item);
    });
  }

  function renderPage(record) {
    const fragment = document.createDocumentFragment();
    renderChildren(loadTemplate(record.route).content.childNodes, record.inst.data, fragment, record);
    record.body.replaceChildren(fragment);
    checkReachBottom(record);
  }

  // ---------------------------------------------------------------- App / Page

  let appJson = {};
  let appInstance;
  const pageDefs = new Map();
  let registering = null;

  window.App = function App(definition) {
    appInstance = Object.assign({ globalData: {} }, definition);
  };
  window.getApp = () => appInstance;
  window.Page = function Page(definition) {
    if (!registering) throw new Error('Page() 只能在页面文件里调用');
    pageDefs.set(registering, definition || {});
  };
  window.Component = function Component() {
    throw new Error('预览暂不支持自定义组件 Component()');
  };
  window.Behavior = (definition) => definition;

  function pageDefinition(route) {
    if (!pageDefs.has(route)) {
      registering = route;
      try {
        requireModule(route);
      } finally {
        registering = null;
      }
    }
    const definition = pageDefs.get(route);
    if (!definition) throw new Error(`${route} 没有调用 Page()`);
    return definition;
  }

  function isTabRoute(route) {
    return Boolean(appJson.tabBar && appJson.tabBar.list.some((item) => item.pagePath === route));
  }

  let pageSeq = 0;

  function createPage(route, options) {
    const definition = pageDefinition(route);
    const pageConfig = readJson(`${route}.json`, {});
    const windowConfig = Object.assign({}, appJson.window || {}, pageConfig);
    const element = document.createElement('div');
    element.className = 'mp-window';
    const scroller = document.createElement('div');
    scroller.className = 'mp-scroller';
    const refresh = document.createElement('div');
    refresh.className = 'mp-refresh';
    refresh.innerHTML = '<i></i><i></i><i></i>';
    const body = document.createElement('div');
    body.className = 'wx-page';
    scroller.append(refresh, body);
    element.appendChild(scroller);
    element.style.background = windowConfig.backgroundColor || '#fff';
    document.getElementById('viewport').appendChild(element);

    const inst = {};
    for (const [key, value] of Object.entries(definition)) {
      if (key !== 'data') inst[key] = typeof value === 'function' ? value : clone(value);
    }
    inst.data = clone(definition.data || {});
    inst.route = route;
    inst.options = options;
    inst.__wxWebviewId__ = ++pageSeq;

    const record = {
      route,
      inst,
      element,
      scroller,
      body,
      config: windowConfig,
      title: windowConfig.navigationBarTitleText || '',
      style: addStyle(loadWxss(`${route}.wxss`)),
      isTab: isTabRoute(route),
      armed: true,
      unloaded: false,
    };
    inst.setData = function setData(patch, callback) {
      for (const key of Object.keys(patch || {})) setPath(inst.data, key, clone(patch[key]));
      scheduleRender(record);
      if (typeof callback === 'function') requestAnimationFrame(() => setTimeout(callback, 0));
    };
    scroller.addEventListener('scroll', () => {
      if (typeof inst.onPageScroll === 'function') {
        try {
          inst.onPageScroll({ scrollTop: scroller.scrollTop });
        } catch (error) {
          reportError(`${route}.onPageScroll`, error);
        }
      }
      checkReachBottom(record);
    });
    return record;
  }

  function lifecycle(record, name, arg) {
    const fn = record.inst[name];
    if (typeof fn !== 'function') return;
    try {
      fn.call(record.inst, arg);
    } catch (error) {
      reportError(`${record.route}.${name}`, error);
    }
  }

  function checkReachBottom(record) {
    const distance = Number(record.config.onReachBottomDistance || 50);
    const { scrollTop, clientHeight, scrollHeight } = record.scroller;
    const atBottom = scrollTop + clientHeight >= scrollHeight - distance;
    if (!atBottom) {
      record.armed = true;
      return;
    }
    if (record.armed && scrollTop > 0) {
      record.armed = false;
      lifecycle(record, 'onReachBottom');
    }
  }

  const stack = [];
  const tabPages = new Map();

  function parseUrl(url) {
    const [rawPath, search = ''] = url.split('?');
    const base = stack.length ? dirOf(stack[stack.length - 1].route) : '';
    const route = joinPath(rawPath.startsWith('/') ? '' : base, rawPath);
    const options = {};
    for (const pair of search.split('&')) {
      if (!pair) continue;
      const [key, value = ''] = pair.split('=');
      options[key] = value;
    }
    return { route, options };
  }

  function top() {
    return stack[stack.length - 1];
  }

  function hidePage(record) {
    if (!record) return;
    record.element.classList.remove('mp-active');
    record.style.disabled = true;
    lifecycle(record, 'onHide');
  }

  function unloadPage(record) {
    record.unloaded = true;
    lifecycle(record, 'onUnload');
    record.element.remove();
    record.style.remove();
  }

  function showPage(record, isNew) {
    record.style.disabled = false;
    for (const other of document.querySelectorAll('.mp-window.mp-active')) other.classList.remove('mp-active');
    record.element.classList.add('mp-active');
    if (isNew) {
      lifecycle(record, 'onLoad', record.inst.options);
      lifecycle(record, 'onShow');
      renderPage(record);
      setTimeout(() => lifecycle(record, 'onReady'), 0);
    } else {
      lifecycle(record, 'onShow');
    }
    updateChrome();
  }

  function openNew(url) {
    const { route, options } = parseUrl(url);
    if (!(appJson.pages || []).includes(route)) throw new Error(`app.json 里没有页面 ${route}`);
    return { record: createPage(route, options), route };
  }

  const router = {
    navigateTo(url) {
      if (isTabRoute(parseUrl(url).route)) throw new Error('navigateTo 不能打开 tabBar 页面');
      if (stack.length >= 10) throw new Error('页面栈超过 10 层');
      hidePage(top());
      const { record } = openNew(url);
      stack.push(record);
      showPage(record, true);
    },
    redirectTo(url) {
      if (isTabRoute(parseUrl(url).route)) throw new Error('redirectTo 不能打开 tabBar 页面');
      const current = stack.pop();
      if (current && !current.isTab) unloadPage(current);
      else if (current) hidePage(current);
      const { record } = openNew(url);
      stack.push(record);
      showPage(record, true);
    },
    navigateBack(delta) {
      if (stack.length <= 1) return;
      const count = Math.min(Math.max(1, delta || 1), stack.length - 1);
      for (let i = 0; i < count; i += 1) {
        const record = stack.pop();
        if (record.isTab) hidePage(record);
        else unloadPage(record);
      }
      showPage(top(), false);
    },
    switchTab(url) {
      const { route } = parseUrl(url);
      if (!isTabRoute(route)) throw new Error('switchTab 只能打开 tabBar 页面');
      const current = top();
      while (stack.length) {
        const record = stack.pop();
        if (record.isTab) {
          if (record === current && record.route !== route) hidePage(record);
        } else {
          unloadPage(record);
        }
      }
      let record = tabPages.get(route);
      const isNew = !record;
      if (!record) {
        record = createPage(route, {});
        tabPages.set(route, record);
      }
      stack.push(record);
      if (isNew || current !== record) showPage(record, isNew);
      else updateChrome();
    },
    reLaunch(url) {
      while (stack.length) {
        const record = stack.pop();
        if (!record.isTab) unloadPage(record);
      }
      for (const record of tabPages.values()) unloadPage(record);
      tabPages.clear();
      const { route } = parseUrl(url);
      if (isTabRoute(route)) {
        router.switchTab(url);
        return;
      }
      const { record } = openNew(url);
      stack.push(record);
      showPage(record, true);
    },
  };

  // ---------------------------------------------------------------- 外壳：导航栏和 tabBar

  const phone = document.getElementById('phone');

  function updateChrome() {
    const record = top();
    if (!record) return;
    const config = record.config;
    const white = config.navigationBarTextStyle === 'white';
    const custom = config.navigationStyle === 'custom';
    const navbar = document.getElementById('navbar');
    const statusbar = document.getElementById('statusbar');
    const background = config.navigationBarBackgroundColor || '#000000';
    navbar.style.background = custom ? 'transparent' : background;
    statusbar.style.background = custom ? 'transparent' : background;
    navbar.style.color = white ? '#fff' : '#000';
    statusbar.style.color = white ? '#fff' : '#000';
    navbar.querySelector('.nb-title').textContent = record.title;
    phone.classList.toggle('mp-nav-white', white);
    phone.classList.toggle('mp-nav-custom', custom);
    phone.classList.toggle('mp-can-back', stack.length > 1 && !record.isTab);
    phone.classList.toggle('mp-tab-page', record.isTab);
    renderTabBar(record);
  }

  function renderTabBar(record) {
    const tabBar = appJson.tabBar;
    const element = document.getElementById('tabbar');
    if (!tabBar || !record.isTab) return;
    element.style.background = tabBar.backgroundColor || '#fff';
    element.classList.toggle('mp-border-white', tabBar.borderStyle === 'white');
    element.replaceChildren(
      ...tabBar.list.map((item) => {
        const selected = item.pagePath === record.route;
        const tab = document.createElement('div');
        tab.className = 'mp-tab';
        tab.dataset.path = item.pagePath;
        tab.style.color = selected ? tabBar.selectedColor || '#000' : tabBar.color || '#7f7f7f';
        const icon = selected ? item.selectedIconPath || item.iconPath : item.iconPath;
        if (icon) {
          const img = document.createElement('img');
          img.src = APP + joinPath('', icon);
          img.alt = '';
          tab.appendChild(img);
        }
        const label = document.createElement('span');
        label.textContent = item.text;
        tab.appendChild(label);
        tab.addEventListener('click', () => {
          if (item.pagePath !== record.route) wx.switchTab({ url: `/${item.pagePath}` });
          else {
            lifecycle(record, 'onTabItemTap', { index: tabBar.list.indexOf(item), pagePath: item.pagePath, text: item.text });
          }
        });
        return tab;
      }),
    );
  }

  document.querySelector('.nb-back').addEventListener('click', () => wx.navigateBack({ delta: 1 }));

  // ---------------------------------------------------------------- 弹层

  const overlays = document.getElementById('overlays');

  function layer(html, className) {
    const element = document.createElement('div');
    if (className) element.className = className;
    element.innerHTML = html;
    overlays.appendChild(element);
    return element;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let toastLayer = null;
  let toastTimer = null;

  function closeToast() {
    clearTimeout(toastTimer);
    if (toastLayer) toastLayer.remove();
    toastLayer = null;
  }

  function openToast({ title, icon = 'success', duration = 1500, mask = false, loading = false }) {
    closeToast();
    const iconHtml = loading || icon === 'loading'
      ? '<span class="mp-spinner"></span>'
      : icon === 'success'
        ? '<span class="mp-toast-icon">✓</span>'
        : icon === 'error'
          ? '<span class="mp-toast-icon">✕</span>'
          : '';
    toastLayer = layer(
      `${mask ? '<div class="mp-toast-transparent"></div>' : ''}<div class="mp-toast ${iconHtml ? 'mp-has-icon' : ''}">${iconHtml}${escapeHtml(title)}</div>`,
      'mp-toast-root',
    );
    toastLayer.style.pointerEvents = mask ? 'auto' : 'none';
    toastLayer.style.position = 'absolute';
    toastLayer.style.inset = '0';
    if (!loading) toastTimer = setTimeout(closeToast, duration);
  }

  function openModal(options) {
    return new Promise((done) => {
      const showCancel = options.showCancel !== false;
      const root = layer(
        `<div class="mp-mask"></div>
         <div class="mp-modal">
           ${options.title ? `<div class="mp-modal-title">${escapeHtml(options.title)}</div>` : ''}
           <div class="mp-modal-content">${
             options.editable
               ? `<textarea placeholder="${escapeHtml(options.placeholderText || '')}">${escapeHtml(options.content || '')}</textarea>`
               : escapeHtml(options.content || '')
           }</div>
           <div class="mp-modal-actions">
             ${showCancel ? `<button class="mp-modal-cancel" style="color:${options.cancelColor || '#000'}">${escapeHtml(options.cancelText || '取消')}</button>` : ''}
             <button class="mp-modal-confirm" style="color:${options.confirmColor || '#576B95'}">${escapeHtml(options.confirmText || '确定')}</button>
           </div>
         </div>`,
      );
      root.style.position = 'absolute';
      root.style.inset = '0';
      const finish = (confirm) => {
        const textarea = root.querySelector('textarea');
        root.remove();
        done({ confirm, cancel: !confirm, content: textarea ? textarea.value : undefined, errMsg: 'showModal:ok' });
      };
      root.querySelector('.mp-modal-confirm').addEventListener('click', () => finish(true));
      const cancel = root.querySelector('.mp-modal-cancel');
      if (cancel) cancel.addEventListener('click', () => finish(false));
    });
  }

  function openSheet({ title, items, itemColor }) {
    return new Promise((done) => {
      const root = layer(
        `<div class="mp-mask"></div>
         <div class="mp-sheet">
           ${title ? `<div class="mp-sheet-title">${escapeHtml(title)}</div>` : ''}
           ${items.map((item, index) => `<div class="mp-sheet-item" data-index="${index}" style="color:${itemColor || '#000'}">${escapeHtml(item)}</div>`).join('')}
           <div class="mp-sheet-cancel">取消</div>
         </div>`,
      );
      root.style.position = 'absolute';
      root.style.inset = '0';
      root.querySelectorAll('.mp-sheet-item').forEach((item) =>
        item.addEventListener('click', () => {
          root.remove();
          done({ ok: true, tapIndex: Number(item.dataset.index) });
        }),
      );
      const cancel = () => {
        root.remove();
        done({ ok: false });
      };
      root.querySelector('.mp-sheet-cancel').addEventListener('click', cancel);
      root.querySelector('.mp-mask').addEventListener('click', cancel);
    });
  }

  function openMap({ name, address }) {
    const root = layer(
      `<div class="mp-map">
         <div class="mp-map-canvas" style="margin-top:88px">
           <span class="mp-map-note">预览示意：真机打开微信内置地图</span>
           <span class="mp-map-pin"></span>
         </div>
         <div class="mp-map-card">
           <div class="mp-map-info">
             <div class="mp-map-name">${escapeHtml(name || '位置')}</div>
             <div class="mp-map-address">${escapeHtml(address || '')}</div>
           </div>
           <div class="mp-map-go" title="导航">
             <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.7 2.3a1 1 0 0 0-1.06-.23l-18 7a1 1 0 0 0 .08 1.9l7.6 2.18 2.17 7.6a1 1 0 0 0 1.9.09l7-18a1 1 0 0 0-.2-1.04z"/></svg>
           </div>
         </div>
       </div>`,
    );
    root.style.position = 'absolute';
    root.style.inset = '0';
    root.className = 'mp-map-root';
    const close = () => {
      root.remove();
      document.querySelector('.nb-back').removeEventListener('click', close, true);
      updateChrome();
      const record = top();
      if (record) lifecycle(record, 'onShow');
    };
    document.getElementById('navbar').style.background = '#fff';
    document.getElementById('navbar').style.color = '#000';
    document.getElementById('statusbar').style.background = '#fff';
    document.getElementById('statusbar').style.color = '#000';
    document.getElementById('navbar').querySelector('.nb-title').textContent = '';
    phone.classList.add('mp-can-back');
    phone.classList.remove('mp-nav-white');
    document.querySelector('.nb-back').addEventListener('click', close, true);
    root.querySelector('.mp-map-go').addEventListener('click', () =>
      openSheet({ items: ['腾讯地图', '高德地图', '百度地图'], title: '选择导航应用' }),
    );
    const record = top();
    if (record) lifecycle(record, 'onHide');
  }

  // ---------------------------------------------------------------- wx

  let pending = 0;
  const storagePrefix = 'mp:';

  function callback(options, ok, result) {
    const target = options || {};
    try {
      if (ok && typeof target.success === 'function') target.success(result);
      if (!ok && typeof target.fail === 'function') target.fail(result);
      if (typeof target.complete === 'function') target.complete(result);
    } catch (error) {
      reportError('wx 回调', error);
    }
  }

  /** 没传回调时返回 Promise，和新版基础库一致。 */
  function asyncApi(name, run) {
    return function api(options = {}) {
      const usesCallback = ['success', 'fail', 'complete'].some((key) => typeof options[key] === 'function');
      const promise = Promise.resolve()
        .then(() => run(options))
        .then(
          (result) => Object.assign({ errMsg: `${name}:ok` }, result),
          (error) => {
            throw { errMsg: `${name}:fail ${error && error.message ? error.message : error}` };
          },
        );
      if (!usesCallback) return promise;
      promise.then(
        (result) => callback(options, true, result),
        (error) => callback(options, false, error),
      );
      return undefined;
    };
  }

  function encodeQuery(data) {
    return Object.keys(data)
      .filter((key) => data[key] !== undefined && data[key] !== null)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key])}`)
      .join('&');
  }

  function readStorage(key) {
    const raw = localStorage.getItem(storagePrefix + key);
    return raw == null ? undefined : JSON.parse(raw);
  }

  const authSetting = Object.assign({}, preview.authSetting);
  const systemInfo = {
    brand: 'devtools',
    model: 'iPhone X',
    pixelRatio: 2,
    screenWidth: SCREEN_WIDTH,
    screenHeight: 812,
    windowWidth: SCREEN_WIDTH,
    windowHeight: 724,
    statusBarHeight: 44,
    safeArea: { left: 0, right: SCREEN_WIDTH, top: 44, bottom: 778, width: SCREEN_WIDTH, height: 734 },
    language: 'zh_CN',
    version: '8.0.50',
    system: 'iOS 17.0',
    platform: 'devtools',
    SDKVersion: '3.5.5',
    theme: 'light',
  };

  const api = {
    request(options) {
      const method = (options.method || 'GET').toUpperCase();
      const header = Object.assign({}, options.header || {});
      const contentTypeKey = Object.keys(header).find((key) => key.toLowerCase() === 'content-type');
      if (!contentTypeKey) header['content-type'] = 'application/json';
      const contentType = header[contentTypeKey || 'content-type'];
      let url = options.url;
      let body;
      if (options.data !== undefined && options.data !== null) {
        if (method === 'GET') {
          const search = typeof options.data === 'string' ? options.data : encodeQuery(options.data);
          if (search) url += (url.includes('?') ? '&' : '?') + search;
        } else if (typeof options.data === 'string') {
          body = options.data;
        } else {
          body = String(contentType).includes('x-www-form-urlencoded') ? encodeQuery(options.data) : JSON.stringify(options.data);
        }
      }
      let aborted = false;
      pending += 1;
      fetch('/__request', { method: 'POST', body: JSON.stringify({ url, method, header, body }) })
        .then((reply) => reply.json())
        .then((reply) => {
          if (aborted) callback(options, false, { errMsg: 'request:fail abort' });
          else if (reply.ok) {
            callback(options, true, { statusCode: reply.statusCode, data: reply.data, header: reply.header, cookies: [], errMsg: 'request:ok' });
          } else callback(options, false, { errMsg: reply.errMsg });
        })
        .catch((error) => callback(options, false, { errMsg: `request:fail ${error.message}` }))
        .finally(() => {
          pending -= 1;
        });
      return {
        abort() {
          aborted = true;
        },
        onHeadersReceived() {},
        offHeadersReceived() {},
      };
    },

    getStorageSync(key) {
      const value = readStorage(key);
      return value === undefined ? '' : value;
    },
    setStorageSync(key, value) {
      localStorage.setItem(storagePrefix + key, JSON.stringify(value));
    },
    removeStorageSync(key) {
      localStorage.removeItem(storagePrefix + key);
    },
    clearStorageSync() {
      for (const key of Object.keys(localStorage)) if (key.startsWith(storagePrefix)) localStorage.removeItem(key);
    },
    getStorage: asyncApi('getStorage', ({ key }) => {
      const value = readStorage(key);
      if (value === undefined) throw new Error('data not found');
      return { data: value };
    }),
    setStorage: asyncApi('setStorage', ({ key, data }) => {
      localStorage.setItem(storagePrefix + key, JSON.stringify(data));
    }),
    removeStorage: asyncApi('removeStorage', ({ key }) => {
      localStorage.removeItem(storagePrefix + key);
    }),

    login: asyncApi('login', () => ({ code: `preview-login-code-${Date.now().toString(36)}` })),
    checkSession: asyncApi('checkSession', () => ({})),
    getAccountInfoSync: () => ({ miniProgram: { appId: 'touristappid', envVersion: preview.envVersion, version: '' }, plugin: {} }),
    getLaunchOptionsSync: () => ({ path: preview.route || '', query: {}, scene: 1001, referrerInfo: {} }),
    getSystemInfoSync: () => ({ ...systemInfo }),
    getWindowInfo: () => ({ ...systemInfo }),
    getDeviceInfo: () => ({ ...systemInfo }),
    getAppBaseInfo: () => ({ ...systemInfo }),
    getSystemInfo: asyncApi('getSystemInfo', () => ({ ...systemInfo })),
    getMenuButtonBoundingClientRect: () => ({ width: 87, height: 32, top: 50, bottom: 82, left: 281, right: 368 }),
    canIUse: () => true,
    nextTick: (fn) => setTimeout(fn, 0),
    getUpdateManager: () => ({ onCheckForUpdate() {}, onUpdateReady() {}, onUpdateFailed() {}, applyUpdate() {} }),
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
    getNetworkType: asyncApi('getNetworkType', () => ({ networkType: 'wifi' })),
    onAppShow() {},
    onAppHide() {},
    hideHomeButton: asyncApi('hideHomeButton', () => ({})),
    vibrateShort: asyncApi('vibrateShort', () => ({})),
    requestSubscribeMessage: asyncApi('requestSubscribeMessage', () => ({})),

    getSetting: asyncApi('getSetting', () => ({ authSetting: { ...authSetting } })),
    openSetting: asyncApi('openSetting', () => ({ authSetting: { ...authSetting } })),
    authorize: asyncApi('authorize', ({ scope }) => {
      if (scope === 'scope.userLocation' && (!preview.location || preview.location === 'deny')) {
        authSetting[scope] = false;
        throw new Error('auth deny');
      }
      authSetting[scope] = true;
      return {};
    }),
    getLocation: asyncApi('getLocation', () => {
      if (!(appJson.requiredPrivateInfos || []).includes('getLocation')) {
        throw new Error('the api need to be declared in the requiredPrivateInfos field in app.json/ext.json');
      }
      if (!preview.location || preview.location === 'deny' || authSetting['scope.userLocation'] === false) {
        authSetting['scope.userLocation'] = false;
        throw new Error('auth deny');
      }
      authSetting['scope.userLocation'] = true;
      return { latitude: preview.location.latitude, longitude: preview.location.longitude, speed: -1, accuracy: 30 };
    }),
    openLocation: asyncApi('openLocation', (options) => {
      if (typeof options.latitude !== 'number' || typeof options.longitude !== 'number') throw new Error('invalid coordinates');
      openMap(options);
      return {};
    }),
    makePhoneCall: asyncApi('makePhoneCall', async ({ phoneNumber }) => {
      if (!phoneNumber) throw new Error('phoneNumber is empty');
      const result = await openSheet({ title: `${phoneNumber}`, items: ['呼叫'], itemColor: '#576B95' });
      if (!result.ok) throw new Error('cancel');
      return {};
    }),
    setClipboardData: asyncApi('setClipboardData', () => {
      openToast({ title: '内容已复制', icon: 'none' });
      return {};
    }),

    showToast: asyncApi('showToast', (options) => {
      openToast(options);
      return {};
    }),
    hideToast: asyncApi('hideToast', () => {
      closeToast();
      return {};
    }),
    showLoading: asyncApi('showLoading', (options) => {
      openToast({ ...options, loading: true });
      return {};
    }),
    hideLoading: asyncApi('hideLoading', () => {
      closeToast();
      return {};
    }),
    showModal: asyncApi('showModal', (options) => openModal(options)),
    showActionSheet: asyncApi('showActionSheet', async (options) => {
      const result = await openSheet({ items: options.itemList || [], itemColor: options.itemColor, title: options.alertText });
      if (!result.ok) throw new Error('cancel');
      return { tapIndex: result.tapIndex };
    }),

    setNavigationBarTitle: asyncApi('setNavigationBarTitle', ({ title }) => {
      const record = top();
      if (record) record.title = title;
      updateChrome();
      return {};
    }),
    setNavigationBarColor: asyncApi('setNavigationBarColor', ({ frontColor, backgroundColor }) => {
      const record = top();
      if (record) {
        record.config = Object.assign({}, record.config, {
          navigationBarTextStyle: frontColor === '#ffffff' ? 'white' : 'black',
          navigationBarBackgroundColor: backgroundColor,
        });
      }
      updateChrome();
      return {};
    }),
    startPullDownRefresh: asyncApi('startPullDownRefresh', () => {
      pullDown();
      return {};
    }),
    stopPullDownRefresh: asyncApi('stopPullDownRefresh', () => {
      const record = top();
      if (record) record.element.classList.remove('mp-refreshing');
      return {};
    }),
    pageScrollTo: asyncApi('pageScrollTo', ({ scrollTop = 0 }) => {
      const record = top();
      if (record) record.scroller.scrollTop = scrollTop;
      return {};
    }),

    navigateTo: asyncApi('navigateTo', ({ url }) => router.navigateTo(url)),
    redirectTo: asyncApi('redirectTo', ({ url }) => router.redirectTo(url)),
    navigateBack: asyncApi('navigateBack', ({ delta }) => router.navigateBack(delta)),
    switchTab: asyncApi('switchTab', ({ url }) => router.switchTab(url)),
    reLaunch: asyncApi('reLaunch', ({ url }) => router.reLaunch(url)),

    // 扫码：结果由场景脚本给（shot.scanResult），没给就当店员取消了扫码。
    scanCode: asyncApi('scanCode', () => {
      if (preview.scanResult == null) throw new Error('cancel');
      return { result: String(preview.scanResult), scanType: 'QR_CODE', charSet: 'utf-8', path: '', rawData: '' };
    }),
    setKeepScreenOn: asyncApi('setKeepScreenOn', () => ({})),
    getScreenBrightness: asyncApi('getScreenBrightness', () => ({ value: 0.6 })),
    setScreenBrightness: asyncApi('setScreenBrightness', () => ({})),
    setVisualEffectOnCapture: asyncApi('setVisualEffectOnCapture', () => ({})),
    onUserCaptureScreen() {},
    offUserCaptureScreen() {},

    createSelectorQuery() {
      const tasks = [];
      const describe = (element, fields) => {
        const rect = element.getBoundingClientRect();
        return Object.assign(
          { id: element.id, dataset: Object.assign({}, element.__dataset) },
          fields.node ? { node: element } : {},
          fields.size ? { width: rect.width, height: rect.height } : {},
          fields.rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : {},
        );
      };
      const nodesRef = (selector, all) => {
        const find = () => {
          const record = top();
          if (!record) return [];
          return all ? Array.from(record.body.querySelectorAll(selector)) : [record.body.querySelector(selector)].filter(Boolean);
        };
        const add = (fields, cb) => {
          tasks.push(() => {
            const found = find().map((element) => describe(element, fields));
            const value = all ? found : found[0] || null;
            if (typeof cb === 'function') cb(value);
            return value;
          });
          return query;
        };
        return {
          fields: (fields, cb) => add(fields || {}, cb),
          boundingClientRect: (cb) => add({ size: true, rect: true }, cb),
          node: (cb) => add({ node: true }, cb),
        };
      };
      const query = {
        in: () => query,
        select: (selector) => nodesRef(selector, false),
        selectAll: (selector) => nodesRef(selector, true),
        exec(cb) {
          // 等这一帧的 setData 先画到页面上再查，和真机里渲染层回包的时机一致。
          pending += 1;
          requestAnimationFrame(() =>
            setTimeout(() => {
              pending -= 1;
              try {
                const results = tasks.map((task) => task());
                if (typeof cb === 'function') cb(results);
              } catch (error) {
                reportError('createSelectorQuery', error);
              }
            }, 0),
          );
          return query;
        },
      };
      return query;
    },

    // 真的请求一次（走本机转发），状态码和真机一致；文件内容不落地。
    downloadFile: asyncApi('downloadFile', async ({ url, header = {} }) => {
      pending += 1;
      try {
        const reply = await fetch('/__request', { method: 'POST', body: JSON.stringify({ url, method: 'GET', header }) }).then((r) => r.json());
        if (!reply.ok) throw new Error(reply.errMsg);
        return { tempFilePath: `preview://${url}`, statusCode: reply.statusCode };
      } finally {
        pending -= 1;
      }
    }),
    openDocument: asyncApi('openDocument', () => {
      openToast({ title: '预览：此处真机打开文件', icon: 'none' });
      return {};
    }),
  };

  window.wx = new Proxy(api, {
    get(target, key) {
      if (key in target) return target[key];
      return (options = {}) => {
        console.warn(`[mp-preview] wx.${String(key)} 未模拟`);
        callback(options, false, { errMsg: `${String(key)}:fail not supported in preview` });
      };
    },
  });
  window.getCurrentPages = () => stack.map((record) => record.inst);

  function pullDown() {
    const record = top();
    if (!record || !record.config.enablePullDownRefresh) return;
    record.scroller.scrollTop = 0;
    record.element.classList.add('mp-refreshing');
    lifecycle(record, 'onPullDownRefresh');
  }

  // ---------------------------------------------------------------- 启动

  function idle() {
    return new Promise((done) => {
      let quiet = 0;
      const tick = () => {
        if (pending === 0 && dirty.size === 0 && !flushQueued) quiet += 1;
        else quiet = 0;
        if (quiet >= 3) done();
        else setTimeout(tick, 30);
      };
      tick();
    });
  }

  const ready = (async () => {
    for (const [key, value] of Object.entries(preview.storage || {})) {
      localStorage.setItem(storagePrefix + key, JSON.stringify(value));
    }
    appJson = readJson('app.json', {});
    addStyle(loadWxss('app.wxss'));
    if (fetchText(`${APP}app.js`) != null) requireModule('app');
    const first = preview.route || (appJson.pages || [])[0];
    const launch = { path: first, query: {}, scene: 1001 };
    if (appInstance && typeof appInstance.onLaunch === 'function') appInstance.onLaunch.call(appInstance, launch);
    if (appInstance && typeof appInstance.onShow === 'function') appInstance.onShow.call(appInstance, launch);
    // 启动页如果在 onLoad 里自己跳走，就以跳走后的页面为准。
    if (stack.length === 0) router.reLaunch(`/${first}`);
    await idle();
  })().catch((error) => reportError('启动', error));

  window.__mp = {
    ready,
    idle,
    errors,
    current: () => (top() ? top().inst : null),
    route: () => (top() ? top().route : null),
    pullDown,
    scrollTo(scrollTop) {
      const record = top();
      if (record) record.scroller.scrollTop = scrollTop;
    },
    expand(on = true) {
      phone.classList.toggle('mp-expanded', on);
    },
  };
})();
