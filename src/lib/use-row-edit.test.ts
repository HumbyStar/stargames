import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Garantias estruturais do hook `useRowEdit` e das seções que o consomem.
 *
 * Regras não negociáveis validadas aqui via inspeção estática (não temos
 * `@testing-library/react` para exercer o ciclo de vida do hook):
 *
 * 1. `use-row-edit.ts` NÃO pode registrar listeners de `blur` / `pointerdown` /
 *    `mousedown` / `focusout` / `click` em `window`/`document`. Isso garante
 *    por construção que clicar fora ou perder o foco nunca salva nem
 *    cancela — só `confirm()` e `close()` (chamados explicitamente pelos
 *    botões `RowEditActions`) alteram o estado.
 *
 * 2. Os inputs de edição nas seções (Clientes / Collection / MGMV) não
 *    podem ligar `onBlur` a `confirm` / `close` — o padrão obrigatório é
 *    apenas `onChange` para `setField`.
 */

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("useRowEdit — garantias estruturais", () => {
  const src = read("src/lib/use-row-edit.ts");

  it("não registra listeners globais de blur / click-outside", () => {
    // O hook não pode escutar eventos de `window` ou `document`.
    expect(src).not.toMatch(/addEventListener\s*\(\s*['"](blur|focusout|pointerdown|mousedown|click)['"]/);
    expect(src).not.toMatch(/document\.addEventListener/);
    expect(src).not.toMatch(/window\.addEventListener/);
  });

  it("expõe apenas confirm / close como caminhos de persistência", () => {
    // A única forma pública de salvar é `confirm(onSave, opts)`; a única
    // de descartar é `close()`. `setField`/`setDraft` só mexem no rascunho.
    expect(src).toMatch(/confirm:\s*\(/);
    expect(src).toMatch(/close:\s*\(\)/);
  });

  it("bloqueia troca de linha quando há edição pendente (toast)", () => {
    // startEdit deve retornar false + emitir toast quando editingRowId
    // atual difere e há mudanças não confirmadas.
    expect(src).toMatch(/hasUnsavedChanges/);
    expect(src).toMatch(/toast\.error/);
  });
});

describe("Seções — inputs de edição nunca salvam no blur", () => {
  const files = [
    "src/sections/clientes-section.tsx",
    "src/sections/collection-section.tsx",
    "src/sections/mgmv-section.tsx",
  ];

  for (const rel of files) {
    it(`${rel} — nenhum onBlur amarrado a confirm/close do useRowEdit`, () => {
      const src = read(rel);
      // Coleta trechos "onBlur={...}" e valida que não chamam confirm/close
      // do useRowEdit. Handlers como onBlur para máscara de telefone são ok.
      const matches = src.match(/onBlur=\{[^}]*\}/g) ?? [];
      for (const m of matches) {
        expect(m, `handler suspeito em ${rel}: ${m}`).not.toMatch(
          /\b(confirm|close|save|persist)\b\s*\(/,
        );
      }
    });
  }
});