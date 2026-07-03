import { describe, it, expect } from "vitest";
import { normalizeSituation } from "./situation-normalizer";

function bucket(raw: string) {
  const r = normalizeSituation(raw);
  return { s: r.situation, f: r.financialStatusOverride ?? null, unknown: r.unknown };
}

describe("normalizeSituation", () => {
  it("vazio → Em Aberto", () => {
    expect(bucket("")).toEqual({ s: "Em Aberto", f: null, unknown: false });
    expect(bucket("-")).toEqual({ s: "Em Aberto", f: null, unknown: false });
  });

  it.each([
    "ENVIADO",
    "Enviado",
    "ENVIADo",
    "ENVAIDO",
    "ENVIAD0",
    "Enviado (MATEUS)",
    "ENVIADO (MATEUS)",
    "ENVIADO - devolvido",
    "ENVIADO - M -",
    "ENVIADO - NF GERADA ATÉ AQUI",
    "ENVIADO - Não funcionou",
    "Enviado 05/03/2025",
    "Enviado 12/02/2025",
    "ENVIADO troca de item",
    "ENVIADO(item trocado com yuri trindade)",
    "ENVIADO- M -",
    "ENVIADOMATEUS)",
    "ENVIADONF ATE AQUI",
    "ENVIADONF gerada - 25/03/26",
    "ENVIADONF GERADA ATE AQUI",
    "ENVIADOnão funcionou",
    "ENVIADOtrocado pelo assassins valhala",
    "Enviou + 6918/04",
    "ENTREGUE",
    "ENTREGUE *",
    "M - ENVIADO",
    "M - Enviado",
    "M ENVIADO",
    "~~ENVIADO~~",
  ])("'%s' → Enviado", (t) => {
    expect(bucket(t).s).toBe("Enviado");
  });

  it.each(["Pago", "LOTE PAGO"])("'%s' → Enviado + Pago", (t) => {
    const b = bucket(t);
    expect(b.s).toBe("Enviado");
    expect(b.f).toBe("Pago");
  });

  it.each(["MGMV", "LOTE 1"])("'%s' → Em Aberto + MGMV", (t) => {
    const b = bucket(t);
    expect(b.s).toBe("Em Aberto");
    expect(b.f).toBe("MGMV");
  });

  it.each(["RETIRAR", "Retirar", "retirar"])(
    "'%s' (exato) → Retirar",
    (t) => {
      expect(bucket(t).s).toBe("Retirar");
    },
  );

  it.each([
    "CANCELADO",
    "Cliente sumiu",
    "De volta ao estoque",
    "DEIXOU DE CRÉDITO",
    "DEU ERRO NO PRODUTO",
    "DEVOLVIDO",
    "EXPIRADO",
    "EXPIROU ITEM",
    "ITEM EXPIRADO",
    "ITEM REMOVIDO",
    "ITENS REMOVIDOS",
    "não funcionou",
    "NÃO FUNCIONOU",
    "Não funcionou",
    "Não Funcionou",
    "PERDEU",
    "QUER TROCAR",
    "REMOVDO",
    "REMOVER",
    "REMOVID0",
    "REMOVIDO",
    "REMOVIDO - 90 reais devolvido",
    "REMOVIDO desistencia",
    "REMOVIDO desistência",
    "REMOVIDO RESERVA EXPIROU",
    "REMOVIDOcredito usado",
    "REMOVIDOdesistencia",
    "REMOVIDOitem repetido",
    "REMOVIDOnão funcionou",
    "REMOVIDOpreferiu ficar de credito",
    "REMOVIDOR$ 80 devolvido",
    "REMOVIDOtaxa item não pago",
    "REMOVIDOTaxa Paga",
    "SAIU DO GRUPO",
    "SUMIU",
    "valor devolvido",
    // Bug 04: RETIRADO* e variantes de abandono/desistência viram Removido.
    "CLIENTE RETIROU NA LOJA",
    "RETIRADO",
    "RETIRADO - já devolvido valor",
    "RETIRADO6 de maio",
    "RETIRADO6 junho",
    "RETIRADO6 Junho",
    "RETIRADOIRAN",
    "RETIRAR - valor estornado",
    "RETIRAR desistencia",
    "ABANDONOU",
    "Abandonou",
    "Cliente abandonou o produto",
    "Cliente desistiu",
    "Deisitiu do item",
    "DESISISTIU",
    "Desisistiu",
    "Desisitiu",
    "DESISITIU",
    "DESISITU",
    "DESISTIU",
    "Desistiu",
    "Desistiu do item",
    "Desistência",
    "DESITIU",
  ])("'%s' → Removido", (t) => {
    expect(bucket(t).s).toBe("Removido");
  });

  it("desconhecido → unknown=true", () => {
    const r = normalizeSituation("qualquer coisa estranha xyz");
    expect(r.unknown).toBe(true);
    expect(r.situation).toBeNull();
  });
});