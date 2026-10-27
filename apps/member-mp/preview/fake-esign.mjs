// 本机截图用的假电子签平台：沿用接口测试里的假 e签宝沙箱（apps/api/test/support/fake-esign.ts），
// 再加一个控制口，让截图脚本能把某位会员的待签权益单标成「签好了」。只在本机用，不连任何外部服务。
//
//   pnpm --filter member-mp exec tsx preview/fake-esign.mjs
//
// 接口要指向它启动：ESIGN_API_HOST=http://127.0.0.1:3901 ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret
// 流程状态存在系统临时目录的 JSON 里，重启这个脚本后接口库里的权益单还能对上。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeEsign } from '../../api/test/support/fake-esign.ts';

const PORT = Number(process.env.FAKE_ESIGN_PORT ?? 3901);
const CONTROL_PORT = Number(process.env.FAKE_ESIGN_CONTROL_PORT ?? PORT + 1);
const STATE = process.env.FAKE_ESIGN_STATE ?? join(tmpdir(), 'member-mp-fake-esign.json');

const TEMPLATE_ID = 'member-benefit-demo';

const fake = new FakeEsign(process.env.ESIGN_APP_ID ?? 'demo-app', process.env.ESIGN_APP_SECRET ?? 'demo-secret');
fake.templates.set(TEMPLATE_ID, {
  name: '会员权益单（演示模板）',
  componentKeys: ['contractNo', 'memberPhone', 'memberName', 'benefitTitle', 'storeName', 'signDate'],
  keywords: ['会员签字', '商家盖章'],
});

if (existsSync(STATE)) {
  for (const flow of JSON.parse(readFileSync(STATE, 'utf8'))) {
    fake.flows.set(flow.id, flow);
  }
}

let saved = '';
function save() {
  const text = JSON.stringify([...fake.flows.values()]);
  if (text !== saved) {
    writeFileSync(STATE, text);
    saved = text;
  }
}
setInterval(save, 300).unref();

await fake.start(PORT);

// 控制口：POST /complete { phone, status? } 把这位会员所有待签的流程改成 status（默认 2 = 签好了）。
const control = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  if (req.method === 'POST' && req.url === '/complete') {
    const done = [];
    for (const flow of fake.flows.values()) {
      if (flow.memberPhone === body.phone && flow.status === 1) {
        fake.complete(flow.id, body.status ?? 2);
        done.push(flow.id);
      }
    }
    save();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ done }));
    return;
  }
  res.writeHead(404).end();
});
control.listen(CONTROL_PORT, '127.0.0.1');

console.log(`假电子签平台 http://127.0.0.1:${PORT}，控制口 http://127.0.0.1:${CONTROL_PORT}，状态文件 ${STATE}`);
