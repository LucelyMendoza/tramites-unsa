import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { maskDni, validCui, validDni, validFullName } from '../src/domain/validators.js';
import { findTransition } from '../src/domain/stateMachine.js';
import { pdfRiskyMarkers, sniff, verifyContent } from '../src/storage/fileSniff.js';
import { inScope } from '../src/domain/permissions.js';
import { PDF, PNG, JPG } from './helpers.js';

describe('validadores', () => {
  it('DNI', () => {
    expect(validDni('12345678')).toBe(true);
    for (const v of ['1234567', '123456789', '1234567a', ' 12345678']) expect(validDni(v)).toBe(false);
  });
  it('CUI con patrón por defecto y personalizado', () => {
    expect(validCui('20201001', { CUI_PATTERN: '^\\d+$' })).toBe(true);
    expect(validCui('2020A', { CUI_PATTERN: '^\\d+$' })).toBe(false);
    expect(validCui('2020100', { CUI_PATTERN: '^\\d{8}$' })).toBe(false);
    expect(validCui('x', { CUI_PATTERN: '(' })).toBe(false);
  });
  it('nombre y máscara', () => {
    expect(validFullName('Quispe Mamani Juan')).toBe(true);
    expect(validFullName(' ')).toBe(false);
    expect(maskDni('12345678')).not.toContain('2345');
  });
});

describe('sniff de archivos', () => {
  it('detecta tipo real', () => {
    expect(sniff(PDF)).toBe('pdf');
    expect(sniff(PNG)).toBe('png');
    expect(sniff(JPG)).toBe('jpg');
    expect(sniff(Buffer.from('hola mundo'))).toBeNull();
  });
  it('verifyContent exige coincidencia nombre/mime/contenido', () => {
    expect(verifyContent(PDF, ['pdf'], 'a.pdf', 'application/pdf').ok).toBe(true);
    expect(verifyContent(PNG, ['pdf'], 'a.pdf', 'application/pdf').ok).toBe(false);
    expect(verifyContent(PNG, ['png'], 'a.jpg', 'image/png').ok).toBe(false);
  });
  it('marcadores riesgosos en PDF', () => {
    expect(pdfRiskyMarkers(Buffer.from('%PDF /JavaScript /Launch')).length).toBeGreaterThan(0);
    expect(pdfRiskyMarkers(PDF)).toEqual([]);
  });
});

describe('máquina de estados y permisos', () => {
  it('solo transiciones definidas', () => {
    expect(findTransition('ENVIADA', 'EN_REVISION', 'review')).toBeTruthy();
    expect(findTransition('ENVIADA', 'FINALIZADA', 'issue')).toBeFalsy();
    expect(findTransition('FINALIZADA', 'EN_REVISION', 'review')).toBeFalsy();
  });
  it('inScope', () => {
    expect(inScope(null, 'f1')).toBe(true);
    expect(inScope(['f1'], 'f1')).toBe(true);
    expect(inScope(['f1'], 'f2')).toBe(false);
    expect(inScope([], 'f1')).toBe(false);
  });
});

describe('configuración', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', AUTH_MODE: 'firebase', STORAGE_DRIVER: 'r2', MAIL_PROVIDER: 'resend' } as any;
  it('producción rechaza modos de desarrollo', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'dev' })).toThrow();
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 'local' })).toThrow();
    expect(() => loadConfig({ ...base, MAIL_PROVIDER: 'console' })).toThrow();
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow();
  });
});
