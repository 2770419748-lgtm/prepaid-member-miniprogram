import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

/**
 * 对象存储：只放合同 PDF 这类文件，库里只记 key。
 * 配了 S3_ENDPOINT + S3_BUCKET 走 S3 / MinIO；没配就落本机目录（只用于开发和测试）。
 */
export abstract class ObjectStorage {
  abstract readonly kind: 's3' | 'local';
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** 不存在返回 null。 */
  abstract get(key: string): Promise<Buffer | null>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/;

export function assertObjectKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error('invalid object key');
  }
}

export class LocalObjectStorage extends ObjectStorage {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    // 同一毫秒里可能有两次写同一个 key（回调和刷新同时归档），临时文件名不能撞。
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, body);
    await rename(temp, target);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private pathOf(key: string): string {
    assertObjectKey(key);
    const target = resolve(join(this.root, key));
    const rel = relative(this.root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('invalid object key');
    }
    return target;
  }
}

export class S3ObjectStorage extends ObjectStorage {
  readonly kind = 's3' as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {
    super();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertObjectKey(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) {
        return null;
      }
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }
}

export function createObjectStorage(config: ConfigService): ObjectStorage {
  const endpoint = config.get<string>('S3_ENDPOINT')?.trim();
  const bucket = config.get<string>('S3_BUCKET')?.trim();
  if (endpoint && bucket) {
    const accessKeyId = config.get<string>('S3_ACCESS_KEY')?.trim() ?? '';
    const secretAccessKey = config.get<string>('S3_SECRET_KEY')?.trim() ?? '';
    const client = new S3Client({
      endpoint,
      region: config.get<string>('S3_REGION')?.trim() || 'us-east-1',
      // MinIO 和多数国内对象存储兼容路径风格。
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') !== 'false',
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
    return new S3ObjectStorage(client, bucket);
  }
  const root = config.get<string>('STORAGE_LOCAL_DIR')?.trim() || join(process.cwd(), '.storage');
  if (config.get<string>('NODE_ENV') === 'production') {
    new Logger('ObjectStorage').warn('S3_ENDPOINT / S3_BUCKET 未配置，合同文件暂存本机目录');
  }
  return new LocalObjectStorage(root);
}
