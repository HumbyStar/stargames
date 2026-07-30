# Star Games Hub

Crie um sistema web chamado “Star Games Gestão Operacional”.

Use como referência estrutural o modelo abaixo em HTML + JS apenas para entendimento visual, organização das telas e lógica de negócio.
Não é necessário seguir HTML puro no desenvolvimento final; use a stack padrão do projeto, mas respeite a estrutura, telas, componentes e comportamentos descritos.

<app name="Star Games Gestão Operacional">

  <layout>
    <sidebar>
      <brand>
        <logo>Star Games</logo>
        <subtitle>Gestão Operacional</subtitle>
      </brand>

      <nav>
        <item active="true" route="dashboard">Dashboard</item>
        <item route="collection">Collection</item>
        <item route="import">Import</item>
      </nav>

      <footer>
        <item route="settings">Configurações</item>
      </footer>
    </sidebar>

    <topbar>
      <search placeholder="Buscar cliente, telefone ou produto..." />
      <icon name="help" />
      <icon name="notifications" />
      <avatar />
    </topbar>

    <main id="screen-content"></main>
  </layout>

</app>


O sistema deve ter somente estas telas:

<screens>
  <screen id="dashboard" />
  <screen id="collection-geral" />
  <screen id="collection-cliente" />
  <screen id="importacao" />
</screens>


Não criar tela completa de Clientes.
Não criar tela de Produtos.
Não criar tela MGMV separada.
Não criar Relatórios.

1. Dashboard

Criar tela com a mesma linha visual do layout atual: clara, limpa, estilo Notion moderno, cards brancos, bordas suaves, tags coloridas e visual SaaS.

<section id="dashboard">
  <header>
    <h1>Dashboard</h1>
    <p>Acompanhe os principais indicadores operacionais da Star Games.</p>
  </header>

  <div class="dashboard-grid">
    <metric-card label="Total Clientes" value="1248" />
    <metric-card label="Reservas Ativas" value="342" status="primary" />
    <metric-card label="Reservas Vencidas" value="15" status="danger" />
    <metric-card label="Pendências" value="87" status="danger" />
    <metric-card label="Clientes MGMV" value="412" />
    <metric-card label="MGMV Vencidas" value="42" status="danger" />
    <metric-card label="Pagos Ag. Envio" value="124" status="success" />
    <metric-card label="Produtos Enviados" value="892" />
    <metric-card label="Desistências" value="54" />
    <metric-card label="Abandonos" value="18" />
  </div>

  <quick-actions>
    <button action="goToImport">Importar Dados</button>
    <button action="goToCollection">Ver Cobranças</button>
    <button action="filterMGMV">Ver MGMV Vencido</button>
  </quick-actions>

  <section class="charts">
    <card title="Status Financeiro">
      <progress-bar>
        <segment label="Pago" percent="55" color="green" />
        <segment label="Reserva" percent="25" color="yellow" />
        <segment label="MGMV" percent="15" color="blue" />
        <segment label="Pendente" percent="5" color="red" />
      </progress-bar>
    </card>

    <card title="Situação dos Produtos">
      <progress-bar>
        <segment label="Em Aberto" percent="60" color="blue" />
        <segment label="Enviado" percent="30" color="green" />
        <segment label="Desistiu" percent="7" color="orange" />
        <segment label="Abandonou" percent="3" color="dark-red" />
      </progress-bar>
    </card>
  </section>

  <section class="alerts">
    <card title="Alertas Operacionais">
      <alert type="danger" title="Cliente com reserva vencida" text="João Silva - Reserva #492 expirou há 2h." />
      <alert type="danger" title="Parcela MGMV vencida" text="Maria Oliveira - Parcela 2/5 atrasada." />
      <alert type="success" title="Pagos aguardando envio" text="12 pedidos prontos para despacho." />
      <alert type="warning" title="Pendência de pagamento" text="Carlos Santos - Aguardando comprovante." />
    </card>
  </section>
</section>


2. Collection Geral

Essa tela deve ser a tela principal de cobranças.

<section id="collection-geral">
  <header>
    <h1>Collection</h1>
    <p>Controle cobranças, inadimplências, reservas vencidas e acordos em atraso.</p>
  </header>

  <div class="collection-metrics">
    <metric-card label="Total em atraso" value="R$ 145.230,00" status="danger" />
    <metric-card label="Clientes inadimplentes" value="342" />
    <metric-card label="Reservas vencidas" value="15" status="danger" />
    <metric-card label="Pendentes vencidos" value="87" status="danger" />
    <metric-card label="Parcelas MGMV vencidas" value="42" status="danger" />
    <metric-card label="Valor total restante" value="R$ 98.500,00" />
  </div>

  <filters>
    <chip active="true" filter="todos">Todos</chip>
    <chip filter="reserva_vencida">Reserva vencida</chip>
    <chip filter="pendente_vencido">Pendente vencido</chip>
    <chip filter="mgmv_vencido">MGMV vencido</chip>
    <chip filter="em_aberto">Em aberto</chip>

    <select name="platform">
      <option>Todas as plataformas</option>
      <option>PS5</option>
      <option>PS4</option>
      <option>Xbox</option>
      <option>Colecionável</option>
    </select>

    <select name="period">
      <option>Todos os períodos</option>
      <option>Últimos 7 dias</option>
      <option>Últimos 30 dias</option>
      <option>Este mês</option>
    </select>
  </filters>

  <table id="collection-table">
    <thead>
      <tr>
        <th>Cliente</th>
        <th>Telefone</th>
        <th>Produto</th>
        <th>Plataforma</th>
        <th>Valor Total</th>
        <th>Valor Pago</th>
        <th>Valor Restante</th>
        <th>Status</th>
        <th>Situação</th>
        <th>Data Limite</th>
        <th>Dias em Atraso</th>
        <th>Ações</th>
      </tr>
    </thead>

    <tbody>
      <tr data-status="Reserva" data-situation="Em Aberto" data-overdue="true">
        <td>João Silva</td>
        <td>11 99999-9999</td>
        <td>GTA V</td>
        <td>PS5</td>
        <td>R$ 250,00</td>
        <td>R$ 50,00</td>
        <td>R$ 200,00</td>
        <td><tag type="danger">Reserva vencida</tag></td>
        <td><tag type="neutral">Em Aberto</tag></td>
        <td>25/06/2026</td>
        <td>12 dias</td>
        <td>
          <button action="openClientCollection">Abrir cliente</button>
          <button action="copyMessage">Copiar cobrança</button>
          <button action="registerPayment">Registrar pagamento</button>
        </td>
      </tr>
    </tbody>
  </table>
</section>


Regras dessa tela:

function shouldAppearInCollection(product) {
  return (
    (product.financialStatus === "Reserva" || product.financialStatus === "Pendente") &&
    product.situation === "Em Aberto" &&
    new Date(product.dueDate) < new Date()
  );
}


Não mostrar na Collection:

const hiddenFromCollection = ["Pago", "Enviado", "Desistiu", "Abandonou"];


3. Cobrança de Cliente Específico

Essa tela abre quando clicar em “Abrir cliente” na Collection.

Pode ser uma nova tela interna ou um drawer grande.
Preferência: página/tela interna para apresentação mais clara.

<section id="collection-cliente">
  <header>
    <button action="backToCollection">← Voltar para Collection</button>

    <client-header>
      <h1>João Silva</h1>
      <p>Telefone: 11 99999-9999</p>
      <tag type="danger">Inadimplente</tag>
    </client-header>

    <button action="registerPayment">Registrar Pagamento</button>
  </header>

  <div class="client-summary">
    <metric-card label="Total em aberto" value="R$ 650,00" status="danger" />
    <metric-card label="Valor pago" value="R$ 150,00" status="success" />
    <metric-card label="Valor restante" value="R$ 500,00" />
    <metric-card label="Produtos em cobrança" value="3" />
    <metric-card label="Próximo vencimento" value="25/06/2026" />
    <metric-card label="Maior atraso" value="12 dias" status="danger" />
  </div>

  <section class="client-alerts">
    <alert type="danger" title="Reserva vencida" text="Cliente possui produto com reserva vencida." />
    <alert type="warning" title="Pendência em aberto" text="Existe valor restante aguardando regularização." />
  </section>

  <table id="client-collection-table">
    <thead>
      <tr>
        <th>Produto</th>
        <th>Plataforma</th>
        <th>Valor Total</th>
        <th>Valor Pago</th>
        <th>Valor Restante</th>
        <th>Status</th>
        <th>Situação</th>
        <th>Data Cadastro</th>
        <th>Data Limite</th>
        <th>Dias em Atraso</th>
        <th>Observações</th>
        <th>Ações</th>
      </tr>
    </thead>

    <tbody>
      <tr>
        <td>GTA V</td>
        <td>PS5</td>
        <td>R$ 250,00</td>
        <td>R$ 50,00</td>
        <td>R$ 200,00</td>
        <td><tag type="danger">Reserva vencida</tag></td>
        <td><tag type="neutral">Em Aberto</tag></td>
        <td>25/05/2026</td>
        <td>25/06/2026</td>
        <td>12 dias</td>
        <td>Cliente pediu prazo adicional.</td>
        <td>
          <button action="copyMessage">Copiar cobrança</button>
          <button action="registerPayment">Registrar pagamento</button>
          <button action="markResolved">Resolver</button>
        </td>
      </tr>
    </tbody>
  </table>

  <section class="mgmv-block" condition="clientHasMGMV">
    <card title="Acordo MGMV Ativo">
      <p>Data do acordo: 10/06/2026</p>
      <p>Valor da dívida: R$ 1.000,00</p>
      <p>Parcelas: 2/5 pagas</p>
      <p>Saldo restante: R$ 600,00</p>
      <p>Próximo vencimento: 10/07/2026</p>

      <progress value="40" label="40% quitado" />

      <table>
        <thead>
          <tr>
            <th>Parcela</th>
            <th>Vencimento</th>
            <th>Valor</th>
            <th>Status</th>
            <th>Pagamento</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2/5</td>
            <td>10/06/2026</td>
            <td>R$ 200,00</td>
            <td><tag type="danger">Vencida</tag></td>
            <td>-</td>
            <td><button>Registrar pagamento</button></td>
          </tr>
        </tbody>
      </table>
    </card>
  </section>

  <section class="client-notes">
    <card title="Observações da Cobrança">
      <textarea placeholder="Adicionar nova observação sobre a cobrança..."></textarea>
      <button>Salvar observação</button>
    </card>
  </section>
</section>


4. Importação em Massa

<section id="importacao">
  <header>
    <h1>Importação em Massa</h1>
    <p>Cole dados brutos para validar e importar novos registros.</p>
  </header>

  <div class="import-layout">
    <main>
      <card title="Dados Brutos">
        <textarea id="importText">
Itens 25/06/2026

João - 11 99999-9999 - GTA V - PS5 - 50 - Reserva
Pedro - 21 98888-8888 - Figure Goku - Colecionável - 80 - Pago
Carlos - 41 97777-7777 - PS2 Slim - PS2 - 300 - Pendente
        </textarea>

        <button action="validateImport">Validar Importação</button>
      </card>
    </main>

    <aside>
      <card title="Instruções">
        <ul>
          <li>Use o formato: Nome - Telefone - Produto - Plataforma - Valor - Status</li>
          <li>A data deve estar no cabeçalho.</li>
          <li>A data do cabeçalho será usada como Data de Cadastro.</li>
          <li>O telefone será usado para localizar ou criar clientes.</li>
          <li>Status aceitos: Pago, Reserva, Pendente, MGMV.</li>
        </ul>
      </card>

      <card title="Resumo da Validação">
        <metric label="Válidos" value="0" />
        <metric label="Erros" value="0" />
        <metric label="Clientes Novos" value="0" />
        <metric label="Clientes Encontrados" value="0" />
      </card>
    </aside>
  </div>

  <section class="preview">
    <h2>Preview dos Dados</h2>

    <table id="import-preview-table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Nome</th>
          <th>Telefone</th>
          <th>Produto</th>
          <th>Plataforma</th>
          <th>Valor</th>
          <th>Status</th>
          <th>Cliente</th>
          <th>Resultado</th>
          <th>Erro</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>25/06/2026</td>
          <td>João</td>
          <td>11 99999-9999</td>
          <td>GTA V</td>
          <td>PS5</td>
          <td>R$ 50,00</td>
          <td><tag type="warning">Reserva</tag></td>
          <td>Cliente criado</td>
          <td><tag type="success">Pronto</tag></td>
          <td>-</td>
        </tr>
      </tbody>
    </table>

    <button action="confirmImport">Confirmar Importação</button>
  </section>
</section>


Lógica da importação:

function validateImportText(text) {
  const lines = text.split("\n").filter(line => line.trim() !== "");
  const header = lines[0];

  const dateMatch = header.match(/(\d{2}\/\d{2}\/\d{4})/);
  const identifiedDate = dateMatch ? dateMatch[1] : null;

  const productLines = lines.slice(1);

  return productLines.map(line => {
    const parts = line.split("-").map(item => item.trim());

    const [name, phone, product, platform, value, status] = parts;

    const errors = [];

    if (!identifiedDate) errors.push("Data não identificada");
    if (!name) errors.push("Nome obrigatório");
    if (!phone || phone.length < 10) errors.push("Telefone inválido");
    if (!product) errors.push("Produto sem nome");
    if (!value || isNaN(Number(value.replace(",", ".")))) errors.push("Valor inválido");
    if (!["Pago", "Reserva", "Pendente", "MGMV"].includes(status)) errors.push("Status inválido");

    return {
      date: identifiedDate,
      name,
      phone,
      product,
      platform,
      value,
      status,
      clientFound: findClientByPhone(phone),
      willCreateClient: !findClientByPhone(phone),
      result: errors.length === 0 ? "Pronto" : "Erro",
      errors
    };
  });
}


Funções esperadas de comportamento

function navigateTo(screen) {
  // troca a tela ativa sem recarregar a página
}

function openClientCollection(clientId) {
  // abre a tela de cobrança do cliente específico
}

function copyChargeMessage(client, product) {
  return `Olá, ${client.name}. Identificamos uma pendência referente ao item ${product.name}, no valor restante de ${formatCurrency(product.remainingValue)}. Podemos regularizar?`;
}

function calculateDaysLate(dueDate) {
  // calcula dias de atraso com base na data limite
}

function registerPayment(productId, amount) {
  // atualiza valor pago e valor restante
}

function markAsResolved(productId) {
  // altera situação/status para não aparecer mais na cobrança
}


O resultado deve manter o visual semelhante ao dashboard já criado:

sidebar clara;

cards grandes;

tabelas organizadas;

botões azuis;

alertas suaves;

tags coloridas;

estrutura limpa e profissional.

Criar apenas essas telas e seus fluxos:

Dashboard

Collection Geral

Cobrança de Cliente Específico

Importação em Massa

Não criar tela de clientes completa.
Não criar tela de produtos.
Não criar tela separada para MGMV.
Não criar relatórios.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://stargames.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9675ace6-1d0a-4259-a33a-8378153df5fa).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
