// Registro de módulos de server functions.
//
// O TanStack Start só registra uma server function quando o módulo que a
// declara entra no grafo do servidor. Funções usadas somente em telas
// client-only (ex.: rotas protegidas com `ssr: false`) ficavam de fora e o
// endpoint `/_serverFn/...` respondia 500 ("Invalid server function ID").
// Importar os módulos aqui garante o registro. No cliente estes imports viram
// apenas stubs RPC, então não há custo relevante de bundle.

import "@/lib/api/queries.functions";
import "@/lib/permissions.functions";
import "@/lib/session-guard.functions";

export {};
