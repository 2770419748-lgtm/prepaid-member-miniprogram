import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
interface HttpReply {
  status(code: number): { json(body: unknown): void };
}

interface HttpRequestLike {
  url: string;
}

/** 前端要按它做跳转的错误带一个固定代码，例如 MUST_CHANGE_PASSWORD。 */
function exceptionCode(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'object' && response && 'code' in response) {
    const code = (response as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function exceptionMessage(exception: HttpException): unknown {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response === 'object' && response && 'message' in response) {
    return (response as { message: unknown }).message;
  }
  return response;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpReply>();
    const request = ctx.getRequest<HttpRequestLike>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exceptionMessage(exception)
        : 'Internal server error';

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.message : 'unknown error',
      );
    }

    const code = exception instanceof HttpException ? exceptionCode(exception) : undefined;

    response.status(status).json({
      statusCode: status,
      ...(code ? { code } : {}),
      path: request.url,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
