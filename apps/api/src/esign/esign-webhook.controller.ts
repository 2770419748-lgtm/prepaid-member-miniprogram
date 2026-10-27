import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { EsignConfigService } from '../esign-config/esign-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { callbackSignature, signatureMatches } from './client/esign-signature';
import { SignFlowSyncService } from './sign-flow-sync.service';

interface WebhookRequest {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

/** 回调时间戳和本机时间最多差这么多，超出视为重放。 */
const MAX_SKEW_MS = 10 * 60 * 1000;

function header(request: WebhookRequest, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function flatQuery(query: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '',
    ]),
  );
}

/**
 * e签宝回调。先验签，验签失败返回 401、不动库。
 * 验签通过后不直接采信回调里的状态，而是回头查一次 e签宝再写库。
 */
@ApiExcludeController()
@Public()
@Controller('webhooks')
export class EsignWebhookController {
  private readonly logger = new Logger(EsignWebhookController.name);

  constructor(
    private readonly config: EsignConfigService,
    private readonly prisma: PrismaService,
    private readonly sync: SignFlowSyncService,
  ) {}

  @Post('esign')
  @HttpCode(200)
  async handle(@Req() request: WebhookRequest): Promise<{ code: string; msg: string }> {
    this.verify(request);
    let body: unknown;
    try {
      body = JSON.parse(request.rawBody!.toString('utf8'));
    } catch {
      throw new BadRequestException('回调内容无法识别');
    }
    const signFlowId =
      body && typeof body === 'object' && typeof (body as { signFlowId?: unknown }).signFlowId === 'string'
        ? (body as { signFlowId: string }).signFlowId
        : null;
    const action =
      body && typeof body === 'object' && typeof (body as { action?: unknown }).action === 'string'
        ? (body as { action: string }).action
        : 'unknown';
    if (!signFlowId) {
      return { code: '200', msg: 'success' };
    }
    const flow = await this.prisma.signFlow.findUnique({
      where: { esignFlowId: signFlowId },
      select: { id: true },
    });
    if (!flow) {
      this.logger.warn(`esign callback for unknown flow, action=${action}`);
      return { code: '200', msg: 'success' };
    }
    // 出错（e签宝查不到、归档失败）就返回 5xx，e签宝会按它的策略重试。
    await this.sync.sync(flow.id, 'webhook', 'throw');
    return { code: '200', msg: 'success' };
  }

  private verify(request: WebhookRequest): void {
    const secret = this.config.appSecret;
    const raw = request.rawBody;
    const signature = header(request, 'x-tsign-open-signature');
    const timestamp = header(request, 'x-tsign-open-timestamp');
    const appId = header(request, 'x-tsign-open-app-id');
    if (!secret || !raw || !signature || !/^\d{10,16}$/.test(timestamp)) {
      throw new UnauthorizedException('回调验签失败');
    }
    if (appId && appId !== this.config.appId) {
      throw new UnauthorizedException('回调验签失败');
    }
    const sentAt = Number(timestamp.length <= 10 ? `${timestamp}000` : timestamp);
    if (Math.abs(Date.now() - sentAt) > MAX_SKEW_MS) {
      throw new UnauthorizedException('回调验签失败');
    }
    const expected = callbackSignature(secret, timestamp, flatQuery(request.query), raw);
    if (!signatureMatches(expected, signature)) {
      throw new UnauthorizedException('回调验签失败');
    }
  }
}
