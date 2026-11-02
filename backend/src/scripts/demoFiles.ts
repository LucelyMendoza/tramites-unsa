import { deflateSync } from 'node:zlib';

/** Archivos de demostración VÁLIDOS (se visualizan en el navegador). Contenido ficticio. */
export function demoPdf(title: string, lines: string[] = []): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');
  const text = [
    'BT /F1 22 Tf 60 760 Td (' + esc(title) + ') Tj ET',
    'BT /F1 11 Tf 60 735 Td (DOCUMENTO DE PRUEBA - DATOS FICTICIOS - SIN VALOR OFICIAL) Tj ET',
    ...lines.map((l, i) => `BT /F1 12 Tf 60 ${690 - i * 20} Td (${esc(l)}) Tj ET`),
    '0.51 0.13 0.24 RG 4 w 60 720 m 535 720 l S',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Tarjeta tipo "DNI de prueba" (PNG válido, 480x300) dibujada por píxeles: sin datos reales. */
export function demoPng(): Buffer {
  const W = 480, H = 300;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const i = y * (W * 3 + 1) + 1 + x * 3;
      let [r, g, b] = [236, 240, 245];
      if (y < 56) [r, g, b] = [130, 32, 61];                                        // franja guinda
      if (x > 28 && x < 148 && y > 84 && y < 244) [r, g, b] = [203, 213, 225];      // foto
      if (x > 64 && x < 112 && y > 110 && y < 158) [r, g, b] = [148, 163, 184];     // cabeza
      if (x > 48 && x < 128 && y > 166 && y < 244) [r, g, b] = [148, 163, 184];     // hombros
      if (x > 176 && x < 440 && [96, 132, 168, 204].some((t) => y > t && y < t + 12)) [r, g, b] = [100, 116, 139]; // líneas de texto
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) [r, g, b] = [100, 116, 139];
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
