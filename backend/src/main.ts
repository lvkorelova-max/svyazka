import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor';
import { JsonLogger } from './common/json-logger';
import { RequestContext } from './common/request-context';
import { randomUUID } from 'crypto';
import { applyTrackerScriptHeaders } from './tracker-script-headers';
import { PrismaService } from './prisma/prisma.service';
import { Stage8IntegrationStatus } from '@prisma/client';
import { trackerOriginMatches } from './tracker-origin';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(),
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) {
    const allowed =
      trustProxy === 'loopback'
        ? 'loopback'
        : trustProxy
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
    app.getHttpAdapter().getInstance().set('trust proxy', allowed);
  }

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'go/:affiliateCode', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'track/v1.js', method: RequestMethod.GET },
      { path: 'track/v1/events', method: RequestMethod.POST },
      { path: 'track/v1/events', method: RequestMethod.OPTIONS },
    ],
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.header('x-request-id');
    const requestId =
      incoming && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming) ? incoming : randomUUID();
    response.setHeader('x-request-id', requestId);
    const startedAt = Date.now();
    RequestContext.run(requestId, () => {
      response.on('finish', () => {
        process.stdout.write(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'http_request',
            requestId,
            method: request.method,
            path: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          })}\n`,
        );
      });
      next();
    });
  });
  app.use(helmet());
  app.use((request: Request, response: Response, next: NextFunction) => {
    applyTrackerScriptHeaders(request, response);
    next();
  });
  app.use(cookieParser());
  const prisma = app.get(PrismaService);
  app.use(async (request: Request, response: Response, next: NextFunction) => {
    if (request.path !== '/track/v1/events') {
      next();
      return;
    }
    const origin = request.header('origin');
    if (!origin) {
      next();
      return;
    }
    const installations = await prisma.trackerInstallation.findMany({
      where: { status: Stage8IntegrationStatus.ACTIVE },
      select: { primaryDomain: true, allowedOrigins: true },
    });
    const allowed = installations.some((installation) =>
      [installation.primaryDomain, ...installation.allowedOrigins].some((configured) =>
        trackerOriginMatches(origin, configured),
      ),
    );
    if (!allowed) {
      response.status(403).json({ message: 'Tracker origin is not allowed' });
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Requested-With',
    );
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.status(204).send();
      return;
    }
    next();
  });
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());

  const port = Number(config.get<string>('BACKEND_PORT') ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('BACKEND_PORT must be an integer from 1 to 65535');
  }
  await app.listen(port);
}

void bootstrap();
