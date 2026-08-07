/**
 * Regra de negócio determinística de NCM (AderirNCM).
 * Analisa o texto do produto/plataforma e devolve NCM + descrição fiscal.
 */

export interface NcmRule {
  id: string;
  nome: string;
  ncm: string;
  descricao: string;
  palavras: string[];
}

export interface NcmRuleResult {
  ncm: string;
  descricao: string;
  regra: string;
  motivo: string;
  fallback: boolean;
}

export const NCM_RULES: NcmRule[] = [
  {
    id: "videogame",
    nome: "Videogame / Jogo",
    ncm: "95045000",
    descricao: "Videogame ou jogo",
    palavras: [
      "playstation",
      "ps1",
      "ps2",
      "ps3",
      "ps4",
      "ps5",
      "xbox",
      "nintendo",
      "switch",
      "game boy",
      "gameboy",
      "wii",
      "sega",
      "atari",
      "videogame",
      "video game",
      "console",
      "jogo",
    ],
  },
  {
    id: "original",
    nome: "Boneco Original",
    ncm: "95030099",
    descricao: "Boneco colecionável",
    palavras: [
      "original",
      "bandai",
      "banpresto",
      "good smile",
      "good smile company",
      "kotobukiya",
      "megahouse",
      "alter",
      "max factory",
    ],
  },
  {
    id: "pop",
    nome: "Pop Alternativo",
    ncm: "95030031",
    descricao: "Boneco pelúcia",
    palavras: ["pop alternativo", "pelucia"],
  },
  {
    id: "3d",
    nome: "Figure 3D",
    ncm: "95030080",
    descricao: "Figure 3D",
    palavras: ["3d", "figure 3d", "impressao 3d"],
  },
];

export const NCM_FALLBACK = {
  id: "figure",
  nome: "Figure padrão",
  ncm: "39264000",
  descricao: "Figure",
};

/** Remove acentos, normaliza espaços e caixa. */
export function normalizarTexto(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Retorna as palavras da lista encontradas no texto (palavra inteira). */
export function encontrarPalavras(texto: string, palavras: string[]): string[] {
  const alvo = normalizarTexto(texto);
  return palavras.filter((palavra) => {
    const termo = normalizarTexto(palavra);
    if (!termo) return false;
    const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escapado}(?=$|[^a-z0-9])`, "i").test(alvo);
  });
}

/** Classificação determinística conforme a regra de negócio. */
export function aderirNCM(entrada: string): NcmRuleResult {
  const texto = normalizarTexto(entrada);
  for (const regra of NCM_RULES) {
    const achadas = encontrarPalavras(texto, regra.palavras);
    if (achadas.length > 0) {
      return {
        ncm: regra.ncm,
        descricao: regra.descricao,
        regra: regra.nome,
        motivo: `Acionado por: ${achadas.join(", ")}.`,
        fallback: false,
      };
    }
  }
  return {
    ncm: NCM_FALLBACK.ncm,
    descricao: NCM_FALLBACK.descricao,
    regra: NCM_FALLBACK.nome,
    motivo: "Nenhuma regra de reconhecimento acionada — aplicado o padrão Figure.",
    fallback: true,
  };
}

/** Entrada padrão para itens do catálogo (nome + plataforma). */
export function ncmEntrada(name: string, platform: string): string {
  return [name ?? "", platform ?? ""].filter(Boolean).join(" ");
}