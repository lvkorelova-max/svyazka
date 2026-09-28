import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { RequestContext } from '../request-context';

function safePrismaMeta(meta: unknown) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;

  const allowedKeys = [
    'target',
    'modelName',
    'field_name',
    'constraint',
    'table',
    'column',
    'relation_name',
  ];
  const safe: Record<string, string | string[]> = {};

  for (const key of allowedKeys) {
    const value = (meta as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      safe[key] = value.slice(0, 200);
    } else if (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string')
    ) {
      safe[key] = value.slice(0, 20).map((item) => item.slice(0, 200));
    }
  }

  return Object.keys(safe).length ? safe : undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Внутренняя ошибка сервера';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'Запись с такими данными уже существует';
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: RequestContext.requestId(),
    });

    if (status >= 500) {
      const prismaDiagnostics =
        exception instanceof Prisma.PrismaClientKnownRequestError
          ? {
              code: exception.code,
              message: exception.message,
              ...(safePrismaMeta(exception.meta)
                ? { meta: safePrismaMeta(exception.meta) }
                : {}),
            }
          : undefined;

      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'request_failed',
          requestId: RequestContext.requestId(),
          method: request.method,
          path: request.url,
          statusCode: status,
          error: exception instanceof Error ? exception.name : 'UnknownError',
          ...(prismaDiagnostics ? { prisma: prismaDiagnostics } : {}),
        })}\n`,
      );
    }
  }
}
