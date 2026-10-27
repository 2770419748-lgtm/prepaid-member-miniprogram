import { createHash, createHmac } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

/**
 * 本机假 e签宝沙箱，只给测试和本地演示用。
 * 按 e签宝 v3 的规则独立校验请求签名（不复用被测代码），记录每次请求，按流程号维护状态。
 */

export interface FakeTemplate {
  name: string;
  componentKeys: string[];
  /** 模板正文里有哪些关键字。没有的关键字检索时 searchResult=false。 */
  keywords: string[];
}

interface FakeFlow {
  id: string;
  status: number;
  memberPhone: string;
  body: Record<string, unknown>;
}

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
  signatureOk: boolean;
}

export const FAKE_PDF = Buffer.from('%PDF-1.4\n% fake signed contract\n%%EOF\n', 'latin1');

export class FakeEsign {
  readonly calls: FakeCall[] = [];
  readonly templates = new Map<string, FakeTemplate>();
  readonly flows = new Map<string, FakeFlow>();
  readonly files = new Map<string, { templateId: string; components: unknown }>();
  /** 设为 true 时，签好的合同下载返回 500，用来测归档失败。 */
  failDownload = false;
  private server: Server | null = null;
  private seq = 0;

  constructor(
    readonly appId: string,
    readonly secret: string,
  ) {}

  get baseUrl(): string {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) {
      throw new Error('fake esign not started');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  /** port 为 0 时随机分配。本地演示用固定端口，方便启动服务时指向它。 */
  async start(port = 0): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** 会员签完，平台自动盖章，流程结束。 */
  complete(flowId: string, status = 2): void {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new Error(`unknown flow ${flowId}`);
    }
    flow.status = status;
  }

  /** e签宝回调的请求头：HMAC-SHA256(时间戳 + 查询参数值 + 请求体)，小写十六进制。 */
  callbackHeaders(rawBody: string, options: { secret?: string; timestamp?: number } = {}) {
    const timestamp = String(options.timestamp ?? Date.now());
    const signature = createHmac('sha256', options.secret ?? this.secret)
      .update(timestamp + rawBody, 'utf8')
      .digest('hex');
    return {
      'X-Tsign-Open-App-Id': this.appId,
      'X-Tsign-Open-SIGNATURE': signature,
      'X-Tsign-Open-TIMESTAMP': timestamp,
      'X-Tsign-Open-SIGNATURE-ALGORITHM': 'hmac-sha256',
      'Content-Type': 'application/json',
    };
  }

  callsTo(path: string): FakeCall[] {
    return this.calls.filter((call) => call.path === path || call.path.startsWith(`${path}?`));
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${Date.now().toString(36)}${this.seq}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks);
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path.startsWith('/download/')) {
      if (this.failDownload) {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/pdf' }).end(FAKE_PDF);
      return;
    }

    const signatureOk = this.verify(req, method, url, raw);
    let body: unknown = null;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        body = raw.toString('utf8');
      }
    }
    this.calls.push({ method, path: path + url.search, body, signatureOk });
    if (!signatureOk) {
      this.reply(res, 401, { code: 401, message: '签名校验失败' });
      return;
    }
    this.route(method, path, body as Record<string, unknown>, res);
  }

  private verify(req: IncomingMessage, method: string, url: URL, raw: Buffer): boolean {
    if (req.headers['x-tsign-open-app-id'] !== this.appId) {
      return false;
    }
    if (req.headers['x-tsign-open-auth-mode'] !== 'Signature') {
      return false;
    }
    const md5 = raw.length > 0 ? createHash('md5').update(raw).digest('base64') : '';
    if (raw.length > 0 && req.headers['content-md5'] !== md5) {
      return false;
    }
    const contentType = raw.length > 0 ? String(req.headers['content-type'] ?? '') : '';
    const params = [...url.searchParams.keys()].sort().map((key) => {
      const value = url.searchParams.get(key) ?? '';
      return value === '' ? key : `${key}=${value}`;
    });
    const pathWithQuery = params.length > 0 ? `${url.pathname}?${params.join('&')}` : url.pathname;
    const toSign = `${method}\n${String(req.headers.accept ?? '')}\n${md5}\n${contentType}\n\n${pathWithQuery}`;
    const expected = createHmac('sha256', this.secret).update(toSign, 'utf8').digest('base64');
    return req.headers['x-tsign-open-ca-signature'] === expected;
  }

  private route(method: string, path: string, body: Record<string, unknown>, res: ServerResponse): void {
    let match: RegExpMatchArray | null;
    if (method === 'GET' && (match = path.match(/^\/v3\/doc-templates\/([^/]+)$/))) {
      const template = this.templates.get(decodeURIComponent(match[1]));
      if (!template) {
        this.reply(res, 200, { code: 1437101, message: '模板不存在' });
        return;
      }
      this.ok(res, {
        docTemplateId: match[1],
        docTemplateName: template.name,
        components: template.componentKeys.map((key, index) => ({
          componentId: `c${index}`,
          componentKey: key,
          componentName: key,
          componentType: 1,
        })),
      });
      return;
    }
    if (method === 'POST' && path === '/v3/files/create-by-doc-template') {
      const templateId = String(body.docTemplateId);
      if (!this.templates.has(templateId)) {
        this.reply(res, 200, { code: 1437101, message: '模板不存在' });
        return;
      }
      const fileId = this.nextId('file');
      this.files.set(fileId, { templateId, components: body.components });
      this.ok(res, { fileId, fileDownloadUrl: `${this.baseUrl}/download/${fileId}.pdf` });
      return;
    }
    if (method === 'GET' && (match = path.match(/^\/v3\/files\/([^/]+)$/))) {
      this.ok(res, { fileId: match[1], fileStatus: 2 });
      return;
    }
    if (method === 'POST' && (match = path.match(/^\/v3\/files\/([^/]+)\/keyword-positions$/))) {
      const file = this.files.get(match[1]);
      const template = file ? this.templates.get(file.templateId) : undefined;
      const keywords = Array.isArray(body.keywords) ? (body.keywords as string[]) : [];
      this.ok(res, {
        keywordPositions: keywords.map((keyword, index) =>
          template?.keywords.includes(keyword)
            ? {
                keyword,
                searchResult: true,
                positions: [{ pageNum: 2, coordinates: [{ positionX: 120 + index * 200, positionY: 300 }] }],
              }
            : { keyword, searchResult: false, positions: [] },
        ),
      });
      return;
    }
    if (method === 'POST' && path === '/v3/sign-flow/create-by-file') {
      const signers = Array.isArray(body.signers) ? (body.signers as Record<string, unknown>[]) : [];
      const person = signers.find((signer) => signer.signerType === 0);
      const phone = (person?.psnSignerInfo as { psnAccount?: string } | undefined)?.psnAccount ?? '';
      const id = this.nextId('flow');
      this.flows.set(id, { id, status: 1, memberPhone: phone, body });
      this.ok(res, { signFlowId: id });
      return;
    }
    if (method === 'POST' && (match = path.match(/^\/v3\/sign-flow\/([^/]+)\/sign-url$/))) {
      const flow = this.flows.get(match[1]);
      const operator = (body.operator as { psnAccount?: string } | undefined)?.psnAccount;
      if (!flow || operator !== flow.memberPhone) {
        this.reply(res, 200, { code: 1435002, message: '签署人不存在' });
        return;
      }
      this.ok(res, {
        url: `https://smlh5.esign.cn/sign/${flow.id}?t=${this.nextId('t')}`,
        shortUrl: `https://smlt.esign.cn/${flow.id}`,
      });
      return;
    }
    if (method === 'GET' && (match = path.match(/^\/v3\/sign-flow\/([^/]+)\/detail$/))) {
      const flow = this.flows.get(match[1]);
      if (!flow) {
        this.reply(res, 200, { code: 1435002, message: '流程不存在' });
        return;
      }
      this.ok(res, {
        signFlowStatus: flow.status,
        signFlowFinishTime: flow.status === 2 ? Date.now() : null,
      });
      return;
    }
    if (method === 'GET' && (match = path.match(/^\/v3\/sign-flow\/([^/]+)\/file-download-url$/))) {
      const flow = this.flows.get(match[1]);
      if (!flow || flow.status !== 2) {
        this.reply(res, 200, { code: 1435009, message: '流程未完成' });
        return;
      }
      this.ok(res, {
        files: [{ fileId: 'signed', fileName: '权益单.pdf', downloadUrl: `${this.baseUrl}/download/${flow.id}.pdf` }],
      });
      return;
    }
    if (method === 'POST' && (match = path.match(/^\/v3\/sign-flow\/([^/]+)\/revoke$/))) {
      const flow = this.flows.get(match[1]);
      if (!flow || flow.status !== 1) {
        this.reply(res, 200, { code: 1435011, message: '流程状态不允许撤销' });
        return;
      }
      flow.status = 3;
      this.ok(res, null);
      return;
    }
    this.reply(res, 404, { code: 404, message: 'not found' });
  }

  private ok(res: ServerResponse, data: unknown): void {
    this.reply(res, 200, { code: 0, message: '成功', data });
  }

  private reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  }
}
