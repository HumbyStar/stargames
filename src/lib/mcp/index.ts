import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchClients from "./tools/search-clients";
import getClient from "./tools/get-client";
import listProducts from "./tools/list-products";
import listMgmvAgreements from "./tools/list-mgmv-agreements";
import createTask from "./tools/create-task";

// O emissor OAuth precisa ser o host direto do backend (o proxy publicado
// quebraria a verificação RFC 8414). O ref do projeto é inlined pelo Vite.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "star-games-hub",
  title: "Star Games Hub",
  version: "0.1.0",
  instructions:
    "Ferramentas do painel Star Games: consultar clientes, produtos e acordos MGMV do ambiente de produção e criar tarefas para a equipe. Use search_clients para achar o cliente e get_client para a ficha completa.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchClients, getClient, listProducts, listMgmvAgreements, createTask],
});