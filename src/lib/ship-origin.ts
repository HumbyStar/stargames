/** Dados do remetente (origem) usados na integração com a SuperFrete. */
export interface ShipOrigin {
  name: string;
  document: string;
  phone: string;
  email: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

export const defaultShipOrigin: ShipOrigin = {
  name: "Star Games",
  document: "",
  phone: "",
  email: "",
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
};

const REQUIRED: Array<keyof ShipOrigin> = [
  "name",
  "phone",
  "postalCode",
  "street",
  "number",
  "city",
  "state",
];

export function isShipOriginComplete(o: ShipOrigin | undefined | null): boolean {
  if (!o) return false;
  if ((o.postalCode ?? "").replace(/\D/g, "").length !== 8) return false;
  return REQUIRED.every((k) => (o[k] ?? "").trim() !== "");
}
