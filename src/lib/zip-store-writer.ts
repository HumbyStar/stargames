// Escritor de ZIP (método STORE, sem compressão) determinístico e incremental.
// Substitui o JSZip na geração do backup: o JSZip trava em arquivos grandes
// porque enfileira workers assíncronos sem ponto de cancelamento.

export interface ZipEntryInput {
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * CRC-32 incremental: permite calcular o checksum de um arquivo que é
 * exportado em vários blocos (execuções diferentes do backup) sem manter o
 * conteúdo inteiro em memória. Comece com `crc32Init()` e finalize com
 * `crc32Final()`.
 */
export function crc32Init(): number {
  return 0xffffffff;
}

export function crc32Update(state: number, buf: Uint8Array): number {
  let c = state >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

export function crc32Final(state: number): number {
  return ((state ^ 0xffffffff) >>> 0);
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11);
  const d =
    (date.getDate() & 0x1f) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9);
  return { time, date: d };
}

export function toZipBytes(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

export interface BuildStoreZipOptions {
  modifiedAt?: Date;
  /** Chamado antes de cada arquivo; lance um erro para abortar. */
  onEntry?: (info: { index: number; total: number; path: string; percent: number }) => void | Promise<void>;
}

/**
 * Monta o ZIP em um único buffer pré-dimensionado. Cada arquivo é gravado em
 * uma iteração própria, permitindo progresso e cancelamento imediatos.
 */
export async function buildStoreZip(
  entries: ZipEntryInput[],
  options: BuildStoreZipOptions = {},
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const modifiedAt = options.modifiedAt ?? new Date();
  const { time, date } = dosDateTime(modifiedAt);

  const prepared = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.path);
    return { nameBytes, data: entry.data };
  });

  let total = 0;
  for (const e of prepared) total += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;
  total += 22;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  const central: Array<{ nameBytes: Uint8Array; crc: number; size: number; localOffset: number }> = [];

  for (let i = 0; i < prepared.length; i++) {
    const { nameBytes, data } = prepared[i];
    if (options.onEntry) {
      await options.onEntry({
        index: i,
        total: prepared.length,
        path: new TextDecoder().decode(nameBytes),
        percent: prepared.length ? Math.round((i / prepared.length) * 100) : 100,
      });
    }
    const localOffset = offset;
    const crc = crc32(data);

    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0, true);
    view.setUint16(offset + 8, 0, true); // STORE
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, data.length, true);
    view.setUint32(offset + 22, data.length, true);
    view.setUint16(offset + 26, nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;
    out.set(nameBytes, offset);
    offset += nameBytes.length;
    out.set(data, offset);
    offset += data.length;

    central.push({ nameBytes, crc, size: data.length, localOffset });
  }

  const centralStart = offset;
  for (const e of central) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, e.crc, true);
    view.setUint32(offset + 20, e.size, true);
    view.setUint32(offset + 24, e.size, true);
    view.setUint16(offset + 28, e.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, e.localOffset, true);
    offset += 46;
    out.set(e.nameBytes, offset);
    offset += e.nameBytes.length;
  }

  const centralSize = offset - centralStart;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, central.length, true);
  view.setUint16(offset + 10, central.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}
