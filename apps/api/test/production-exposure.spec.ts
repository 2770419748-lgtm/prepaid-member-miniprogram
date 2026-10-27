import 'reflect-metadata';

import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { resolveJwtSecret } from '../src/auth/jwt-secret';
import { configureExposure, resolveCorsOrigins } from '../src/http-exposure';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

async function appWith(production: boolean, corsOrigins?: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [PingModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureExposure(app, { production, corsOrigins });
  await app.init();
  return app;
}

function preflight(app: INestApplication, origin: string) {
  return request(app.getHttpServer())
    .options('/ping')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type');
}

describe('JWT secret check', () => {
  const strong = 'k3Vq9xY2pL7mN4rT8wZ1aB6cD0eF5gH2jS9uX3';

  it('refuses to start without a secret anywhere', () => {
    expect(() => resolveJwtSecret(undefined, 'development')).toThrow('JWT_SECRET 没有配置');
    expect(() => resolveJwtSecret('   ', 'production')).toThrow('JWT_SECRET 没有配置');
  });

  it('keeps the example secret usable for local development and tests', () => {
    expect(resolveJwtSecret('change-me-in-local-only', 'development')).toBe('change-me-in-local-only');
    expect(resolveJwtSecret('test-only-jwt-secret', 'test')).toBe('test-only-jwt-secret');
  });

  it('refuses the example secret, CI/test secrets and short secrets in production', () => {
    for (const secret of ['change-me-in-local-only', 'test-only-jwt-secret', 'ci-only-jwt-secret']) {
      expect(() => resolveJwtSecret(secret, 'production')).toThrow('示例值');
    }
    expect(() => resolveJwtSecret('please-change-me-before-going-live-0123456789', 'production')).toThrow('示例值');
    expect(() => resolveJwtSecret('short-but-random-9f8e7d', 'production')).toThrow('太短');
  });

  it('never repeats the secret in the error', () => {
    const secret = 'short-but-random-9f8e7d';
    expect(() => resolveJwtSecret(secret, 'production')).not.toThrow(secret);
  });

  it('accepts a long random secret in production', () => {
    expect(resolveJwtSecret(` ${strong} `, 'production')).toBe(strong);
  });
});

describe('CORS origins', () => {
  it('stays open in development when nothing is configured', () => {
    expect(resolveCorsOrigins(undefined, false)).toBe(true);
    expect(resolveCorsOrigins('*', false)).toBe(true);
  });

  it('only allows the configured admin sites in production and never *', () => {
    expect(resolveCorsOrigins(' https://admin.example.com/ , https://admin2.example.com ', true)).toEqual([
      'https://admin.example.com',
      'https://admin2.example.com',
    ]);
    expect(resolveCorsOrigins(undefined, true)).toEqual([]);
    expect(() => resolveCorsOrigins('*', true)).toThrow('不能写 *');
    expect(() => resolveCorsOrigins('https://admin.example.com,*', true)).toThrow('不能写 *');
    expect(() => resolveCorsOrigins('admin.example.com', true)).toThrow('格式不对');
    expect(() => resolveCorsOrigins('https://admin.example.com/login', true)).toThrow('格式不对');
  });
});

describe('what the API exposes over HTTP', () => {
  let apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps = [];
  });

  it('serves the API docs in development and answers any site', async () => {
    const app = await appWith(false);
    apps.push(app);
    const docs = await request(app.getHttpServer()).get('/docs');
    expect(docs.status).toBe(200);
    expect((await request(app.getHttpServer()).get('/docs-json')).status).toBe(200);
    const cors = await preflight(app, 'http://localhost:5173');
    expect(cors.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('hides the API docs in production and only answers the listed admin site', async () => {
    const app = await appWith(true, 'https://admin.example.com');
    apps.push(app);
    expect((await request(app.getHttpServer()).get('/docs')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/docs-json')).status).toBe(404);

    const allowed = await preflight(app, 'https://admin.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.example.com');
    const other = await preflight(app, 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    // 小程序请求不带 Origin，不受跨域限制。
    expect((await request(app.getHttpServer()).get('/ping')).status).toBe(200);
  });

  it('answers no site in production when no admin site is configured', async () => {
    const app = await appWith(true);
    apps.push(app);
    const response = await preflight(app, 'https://admin.example.com');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
