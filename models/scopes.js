export const DECLARED_SCOPES = [
  { group: "Account", name: "Read", state: "on", note: "Conta, workspaces e permissões visíveis ao usuário." },
  { group: "Projects", name: "Read", state: "on", note: "Lista os projetos do workspace." },
  { group: "Projects", name: "Admin", state: "off", note: "Não dá para administrar projetos." },
  { group: "Repositories", name: "Read", state: "implied", note: "Leitura implícita, exigida pelos pull requests. Lista repos e links de clone." },
  { group: "Repositories", name: "Write", state: "off", note: "Não dá para enviar commit nem alterar repositório." },
  { group: "Repositories", name: "Admin", state: "off", note: "Não dá para mudar configuração do repositório." },
  { group: "Repositories", name: "Delete", state: "off", note: "Não dá para apagar repositório." },
  { group: "Pull requests", name: "Read", state: "on", note: "PRs abertos, donos, reviewers, comentários e arquivos." },
  { group: "Pull requests", name: "Write", state: "off", note: "Não dá para comentar, aprovar ou mesclar." },
  { group: "Webhooks", name: "Read and write", state: "off", note: "Webhooks ficam de fora." },
  { group: "Pipelines", name: "Read", state: "on", note: "Amostra de execuções recentes." },
  { group: "Pipelines", name: "Write", state: "off", note: "Não dispara pipeline." },
  { group: "Pipelines", name: "Edit variables", state: "off", note: "Não lê nem edita variáveis." },
  { group: "Runners", name: "Read", state: "on", note: "Estado dos runners do workspace." },
  { group: "Runners", name: "Write", state: "off", note: "Não cadastra nem altera runner." },
  { group: "Tests", name: "Read", state: "implied", note: "Leitura implícita por causa do Write. O painel não chama essa API." },
  { group: "Tests", name: "Write", state: "on", note: "Marcado no token, mas este painel é só consulta e não envia escrita." }
];

export const PROBES = [
  { id: "account", label: "Account Read", path: "/2.0/user" },
  { id: "workspaces", label: "Workspaces", path: "/2.0/workspaces?pagelen=1" },
  { id: "projects", label: "Projects Read", needsWorkspace: true, path: (ws) => `/2.0/workspaces/${ws}/projects?pagelen=1` },
  { id: "repos", label: "Repositories Read", needsWorkspace: true, path: (ws) => `/2.0/repositories/${ws}?pagelen=1` },
  { id: "runners", label: "Runners Read", needsWorkspace: true, path: (ws) => `/2.0/workspaces/${ws}/pipelines-config/runners?pagelen=1` }
];
