import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';
import type { Disposition, SignedUpload, Storage } from './types.js';

/**
 * Driver Cloudflare R2 (API compatible con S3). El bucket debe estar PRIVADO: sin dominio público
 * ni acceso r2.dev. Las credenciales son un API Token de R2 limitado a ESE bucket (Object Read & Write).
 */
export interface S3Options { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }

/**
 * Almacenamiento compatible con S3. Sirve para Cloudflare R2 (driver r2) y para cualquier otro proveedor
 * o servidor propio con API S3 (driver s3). El bucket debe ser PRIVADO; las credenciales, limitadas a ese bucket.
 */
export class R2Storage implements Storage {
  readonly driver: 'r2' | 's3';
  private s3: S3Client;
  private bucket: string;

  static fromR2(cfg: Pick<Config, 'R2_ACCOUNT_ID' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET' | 'R2_ENDPOINT'>) {
    if (!cfg.R2_ACCESS_KEY_ID || !cfg.R2_SECRET_ACCESS_KEY || !cfg.R2_BUCKET || !(cfg.R2_ACCOUNT_ID || cfg.R2_ENDPOINT))
      throw new Error('Faltan variables R2_* (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)');
    return new R2Storage({
      endpoint: cfg.R2_ENDPOINT || `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: 'auto', bucket: cfg.R2_BUCKET,
      accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY, forcePathStyle: false,
    }, 'r2');
  }

  static fromS3(cfg: Pick<Config, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'>) {
    if (!cfg.S3_ENDPOINT || !cfg.S3_BUCKET || !cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY)
      throw new Error('Faltan variables S3_* (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)');
    return new R2Storage({
      endpoint: cfg.S3_ENDPOINT, region: cfg.S3_REGION, bucket: cfg.S3_BUCKET,
      accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY, forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    }, 's3');
  }

  constructor(o: S3Options, driver: 'r2' | 's3' = 'r2') {
    this.driver = driver;
    this.bucket = o.bucket;
    this.s3 = new S3Client({
      region: o.region,
      endpoint: o.endpoint,
      forcePathStyle: o.forcePathStyle,
      credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
    });
  }

  async signUpload(key: string, contentType: string, sizeBytes: number, ttl: number): Promise<SignedUpload> {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttl });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async signDownload(key: string, filename: string, contentType: string, ttl: number, disposition: Disposition = 'attachment'): Promise<string> {
    const safe = filename.replace(/[^\w.\- ]+/g, '_');
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `${disposition}; filename="${safe}"`,
      ResponseContentType: contentType,
    });
    return getSignedUrl(this.s3, cmd, { expiresIn: ttl });
  }

  async head(key: string) {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0) };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
      throw e;
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (Number(r.ContentLength ?? 0) > maxBytes) throw new Error('Objeto excede el tamaño permitido');
    const bytes = await r.Body!.transformToByteArray();
    if (bytes.length > maxBytes) throw new Error('Objeto excede el tamaño permitido');
    return Buffer.from(bytes);
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async put(key: string, data: Buffer) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }
}
