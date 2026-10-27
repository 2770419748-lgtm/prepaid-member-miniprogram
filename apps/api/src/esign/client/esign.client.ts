import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EsignConfigService,
  EsignTarget,
  EsignTargetRefusedError,
  SignTargetEnv,
} from '../../esign-config/esign-config.service';
import {
  contentMd5,
  ESIGN_ACCEPT,
  ESIGN_JSON,
  requestSignature,
  signedPath,
  stringToSign,
} from './esign-signature';

export interface EsignFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface EsignFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type EsignFetch = (url: string, init?: EsignFetchInit) => Promise<EsignFetchResponse>;

const defaultFetch: EsignFetch = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
    arrayBuffer: () => response.arrayBuffer(),
  };
};

/** e签宝返回了业务错误（code 不为 0）。message 是 e签宝原话，不含密钥。 */
export class EsignApiError extends BadGatewayException {
  constructor(
    readonly esignCode: number,
    readonly esignMessage: string,
  ) {
    super(`电子签服务返回错误：${esignMessage || esignCode}`);
  }
}

export interface DocTemplateComponent {
  key: string;
  name: string;
}

export interface DocTemplate {
  id: string;
  name: string;
  components: DocTemplateComponent[];
}

export interface SignPosition {
  page: number;
  x: number;
  y: number;
}

export interface CreateSignFlowInput {
  title: string;
  fileId: string;
  fileName: string;
  memberPhone: string;
  memberPosition: SignPosition;
  sealPosition: SignPosition;
  notifyUrl: string | null;
  redirectUrl: string | null;
}

export interface SignFlowDetail {
  /** e签宝流程状态码，见 esign-status.ts */
  status: number;
  finishedAt: Date | null;
}

export interface SignedFile {
  fileId: string;
  fileName: string;
  downloadUrl: string;
}

/** 合同 PDF 最大 20MB，超过视为异常。 */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const FILE_READY_STATUSES = new Set([2, 5]);

/**
 * e签宝开放平台 v3 客户端。
 * 每次调用前都按网关地址核对环境（沙箱 / 正式），开关关闭时不会打到正式网关。
 * 密钥只用于计算签名，不进日志、不进错误信息。
 */
@Injectable()
export class EsignClient {
  private readonly logger = new Logger(EsignClient.name);

  /** 测试可替换。正式运行使用系统网络。 */
  fetchImpl: EsignFetch = defaultFetch;
  /** 等待模板生成文件时的轮询间隔，测试可调小。 */
  pollIntervalMs = 500;

  constructor(private readonly config: EsignConfigService) {}

  /** 当前会打到哪个环境。不发请求，只核对配置。 */
  target(): EsignTarget {
    try {
      return this.config.resolveTarget();
    } catch (error) {
      if (error instanceof EsignTargetRefusedError) {
        this.logger.warn(`esign call refused: ${error.message}`);
        throw new ServiceUnavailableException('正式签署未开启，已拒绝调用电子签正式环境');
      }
      throw error;
    }
  }

  async getDocTemplate(docTemplateId: string): Promise<DocTemplate> {
    const data = await this.call('GET', `/v3/doc-templates/${encodeURIComponent(docTemplateId)}`);
    const components = Array.isArray(data.components) ? data.components : [];
    return {
      id: readString(data, 'docTemplateId') ?? docTemplateId,
      name: readString(data, 'docTemplateName') ?? '',
      components: components
        .filter(isRecord)
        .map((item) => ({
          key: readString(item, 'componentKey') ?? '',
          name: readString(item, 'componentName') ?? '',
        }))
        .filter((item) => item.key.length > 0),
    };
  }

  /** 用模板生成待签文件。只填模板里存在的控件。 */
  async fillTemplate(
    docTemplateId: string,
    fileName: string,
    values: Record<string, string>,
  ): Promise<{ fileId: string }> {
    const data = await this.call('POST', '/v3/files/create-by-doc-template', undefined, {
      docTemplateId,
      fileName,
      components: Object.entries(values).map(([componentKey, componentValue]) => ({
        componentKey,
        componentValue,
      })),
    });
    const fileId = readString(data, 'fileId');
    if (!fileId) {
      throw new BadGatewayException('电子签服务没有返回文件');
    }
    await this.waitFileReady(fileId);
    return { fileId };
  }

  /** 找关键字在文件里的位置。同一关键字出现多次时取最后一处（签名区一般在末尾）。 */
  async findKeywords(fileId: string, keywords: string[]): Promise<Map<string, SignPosition | null>> {
    const data = await this.call('POST', `/v3/files/${encodeURIComponent(fileId)}/keyword-positions`, undefined, {
      keywords,
    });
    const found = new Map<string, SignPosition | null>(keywords.map((keyword) => [keyword, null]));
    const list = Array.isArray(data.keywordPositions) ? data.keywordPositions : [];
    for (const entry of list.filter(isRecord)) {
      const keyword = readString(entry, 'keyword');
      if (!keyword || !found.has(keyword) || entry.searchResult === false) {
        continue;
      }
      const positions = Array.isArray(entry.positions) ? entry.positions.filter(isRecord) : [];
      let last: SignPosition | null = null;
      for (const position of positions) {
        const page = readNumber(position, 'pageNum');
        const coordinates = Array.isArray(position.coordinates)
          ? position.coordinates.filter(isRecord)
          : [];
        for (const coordinate of coordinates) {
          const x = readNumber(coordinate, 'positionX');
          const y = readNumber(coordinate, 'positionY');
          if (page !== null && x !== null && y !== null && (!last || page >= last.page)) {
            last = { page, x, y };
          }
        }
      }
      found.set(keyword, last);
    }
    return found;
  }

  /**
   * 发起签署：会员个人签（第 1 步），商家企业章由平台自动盖（第 2 步）。
   * 不传企业签署方信息即为应用所属企业自动落章；沙箱里是 e签宝的模拟企业章。
   */
  async createSignFlow(input: CreateSignFlowInput): Promise<{ signFlowId: string; env: SignTargetEnv }> {
    const { env } = this.target();
    const signFlowConfig: Record<string, unknown> = {
      signFlowTitle: input.title,
      autoStart: true,
      autoFinish: true,
    };
    if (input.notifyUrl) {
      signFlowConfig.notifyUrl = input.notifyUrl;
    }
    if (input.redirectUrl) {
      signFlowConfig.redirectConfig = { redirectUrl: input.redirectUrl };
    }
    const data = await this.call('POST', '/v3/sign-flow/create-by-file', undefined, {
      docs: [{ fileId: input.fileId, fileName: input.fileName }],
      signFlowConfig,
      signers: [
        {
          signConfig: { signOrder: 1 },
          noticeConfig: { noticeTypes: '' },
          signerType: 0,
          psnSignerInfo: { psnAccount: input.memberPhone },
          signFields: [
            {
              fileId: input.fileId,
              customBizNum: 'member',
              signFieldType: 0,
              normalSignFieldConfig: {
                freeMode: false,
                autoSign: false,
                signFieldStyle: 1,
                signFieldPosition: toPosition(input.memberPosition),
              },
            },
          ],
        },
        {
          signConfig: { signOrder: 2 },
          signerType: 1,
          signFields: [
            {
              fileId: input.fileId,
              customBizNum: 'seal',
              signFieldType: 0,
              normalSignFieldConfig: {
                autoSign: true,
                signFieldStyle: 1,
                signFieldPosition: toPosition(input.sealPosition),
              },
            },
          ],
        },
      ],
    });
    const signFlowId = readString(data, 'signFlowId');
    if (!signFlowId) {
      throw new BadGatewayException('电子签服务没有返回流程号');
    }
    return { signFlowId, env };
  }

  /** 会员的签署链接（H5）。每次重新取，不依赖旧链接。 */
  async getSignUrl(signFlowId: string, memberPhone: string, redirectUrl: string | null): Promise<string> {
    const body: Record<string, unknown> = {
      needLogin: false,
      urlType: 2,
      clientType: 'ALL',
      operator: { psnAccount: memberPhone },
    };
    if (redirectUrl) {
      body.redirectConfig = { redirectUrl };
    }
    const data = await this.call(
      'POST',
      `/v3/sign-flow/${encodeURIComponent(signFlowId)}/sign-url`,
      undefined,
      body,
    );
    const url = readString(data, 'url') ?? readString(data, 'shortUrl');
    if (!url) {
      throw new BadGatewayException('电子签服务没有返回签署链接');
    }
    return url;
  }

  async getSignFlowDetail(signFlowId: string): Promise<SignFlowDetail> {
    const data = await this.call('GET', `/v3/sign-flow/${encodeURIComponent(signFlowId)}/detail`);
    const status = readNumber(data, 'signFlowStatus');
    if (status === null) {
      throw new BadGatewayException('电子签服务没有返回流程状态');
    }
    const finish = readNumber(data, 'signFlowFinishTime');
    return { status, finishedAt: finish ? new Date(finish) : null };
  }

  async getSignedFiles(signFlowId: string): Promise<SignedFile[]> {
    const data = await this.call(
      'GET',
      `/v3/sign-flow/${encodeURIComponent(signFlowId)}/file-download-url`,
    );
    const files = Array.isArray(data.files) ? data.files.filter(isRecord) : [];
    return files
      .map((file) => ({
        fileId: readString(file, 'fileId') ?? '',
        fileName: readString(file, 'fileName') ?? '',
        downloadUrl: readString(file, 'downloadUrl') ?? '',
      }))
      .filter((file) => file.downloadUrl.length > 0);
  }

  /** 下载签好的 PDF。下载地址是 e签宝给的临时链接，不需要签名头。 */
  async downloadFile(downloadUrl: string): Promise<Buffer> {
    let url: URL;
    try {
      url = new URL(downloadUrl);
    } catch {
      throw new BadGatewayException('合同下载地址无效');
    }
    const { baseUrl } = this.target();
    const loopback = new URL(baseUrl).protocol === 'http:';
    if (url.protocol !== 'https:' && !loopback) {
      throw new BadGatewayException('合同下载地址无效');
    }
    let response: EsignFetchResponse;
    try {
      response = await this.fetchImpl(url.toString(), { signal: AbortSignal.timeout(20000) });
    } catch {
      this.logger.warn('esign file download network failed');
      throw new BadGatewayException('合同下载失败');
    }
    if (!response.ok) {
      this.logger.warn(`esign file download http ${response.status}`);
      throw new BadGatewayException('合同下载失败');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
      throw new BadGatewayException('合同文件大小异常');
    }
    return bytes;
  }

  async revokeSignFlow(signFlowId: string, reason: string): Promise<void> {
    await this.call('POST', `/v3/sign-flow/${encodeURIComponent(signFlowId)}/revoke`, undefined, {
      revokeReason: reason,
    });
  }

  private async waitFileReady(fileId: string): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const data = await this.call('GET', `/v3/files/${encodeURIComponent(fileId)}`);
      const status = readNumber(data, 'fileStatus');
      if (status === null || FILE_READY_STATUSES.has(status)) {
        return;
      }
      if (status === 3 || status === 9) {
        throw new BadGatewayException('电子签服务生成合同文件失败');
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new BadGatewayException('电子签服务生成合同文件超时，请稍后重试');
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string>,
    payload?: unknown,
  ): Promise<Record<string, unknown>> {
    const { baseUrl } = this.target();
    if (!this.config.credentialsConfigured) {
      throw new ServiceUnavailableException('电子签沙箱未配置（缺少 ESIGN_APP_ID / ESIGN_APP_SECRET）');
    }
    const body = payload === undefined ? null : JSON.stringify(payload);
    const md5 = contentMd5(body);
    const contentType = body === null ? '' : ESIGN_JSON;
    const pathWithQuery = signedPath(path, query);
    const headers: Record<string, string> = {
      Accept: ESIGN_ACCEPT,
      'X-Tsign-Open-App-Id': this.config.appId,
      'X-Tsign-Open-Auth-Mode': 'Signature',
      'X-Tsign-Open-Ca-Timestamp': Date.now().toString(),
      'X-Tsign-Open-Ca-Signature': requestSignature(
        this.config.appSecret,
        stringToSign({ method, pathWithQuery, contentMd5: md5, contentType }),
      ),
    };
    if (body !== null) {
      headers['Content-Type'] = contentType;
      headers['Content-MD5'] = md5;
    }
    let response: EsignFetchResponse;
    try {
      response = await this.fetchImpl(`${baseUrl}${pathWithQuery}`, {
        method,
        headers,
        body: body ?? undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      this.logger.warn(`esign ${method} ${path} network failed`);
      throw new BadGatewayException('电子签服务暂时连不上，请稍后重试');
    }
    if (!response.ok) {
      this.logger.warn(`esign ${method} ${path} http ${response.status}`);
      throw new BadGatewayException('电子签服务暂时不可用，请稍后重试');
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new BadGatewayException('电子签服务返回内容无法识别');
    }
    if (!isRecord(parsed)) {
      throw new BadGatewayException('电子签服务返回内容无法识别');
    }
    const code = readNumber(parsed, 'code');
    if (code !== 0) {
      const message = readString(parsed, 'message') ?? '';
      this.logger.warn(`esign ${method} ${path} code=${code ?? 'missing'}`);
      throw new EsignApiError(code ?? -1, message);
    }
    return isRecord(parsed.data) ? parsed.data : {};
  }
}

function toPosition(position: SignPosition) {
  return {
    positionPage: String(position.page),
    positionX: Math.round(position.x * 100) / 100,
    positionY: Math.round(position.y * 100) / 100,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
