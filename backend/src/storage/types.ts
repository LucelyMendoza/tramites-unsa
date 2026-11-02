export interface SignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export type Disposition = 'inline' | 'attachment';

export interface Storage {
  readonly driver: 'local' | 'disk' | 'r2' | 's3';
  /** URL prefirmada de corta duración para que el navegador suba directamente el objeto. */
  signUpload(key: string, contentType: string, sizeBytes: number, ttlSeconds: number): Promise<SignedUpload>;
  /**
   * URL prefirmada de lectura de corta duración.
   * `inline` = el navegador lo muestra (vista previa); `attachment` = fuerza la descarga.
   */
  signDownload(key: string, filename: string, contentType: string, ttlSeconds: number, disposition?: Disposition): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  /** Lee el objeto completo (máx. maxBytes; lanza si lo excede). */
  read(key: string, maxBytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Para pruebas / driver local de desarrollo. */
  put?(key: string, data: Buffer): Promise<void>;
}
