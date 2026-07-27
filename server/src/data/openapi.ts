// Hand-written OpenAPI 3.0 document for the public partner API (/api/v1). Served
// unauthenticated at GET /api/v1/openapi.json so partners can point Swagger/Postman/
// codegen tools at it directly — kept in one place so it can't silently drift too far
// from routes/v1.ts, even though (unlike a generated spec) it isn't auto-verified against it.
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Lastro Partner API',
    version: '1.0.0',
    description:
      'API pública, autenticada por chave de API, para integrações de parceiros (ERPs, FIDCs, securitizadoras, bancos, sacados e seguradoras) com a infraestrutura de duplicatas escrituradas da Lastro.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Chave de API gerada em Desenvolvedores. Formato: lastro_live_… ou lastro_test_… (modo sandbox).',
      },
    },
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'Chave opcional para tornar a requisição segura para reenvio — reenviar a mesma chave com o mesmo corpo replica a resposta original em vez de repetir o efeito colateral.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
  paths: {
    '/duplicatas': {
      post: {
        summary: 'Emitir uma duplicata escriturada (somente contas cedente)',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sacado', 'valor', 'vencimento'],
                properties: {
                  sacado: { type: 'string', example: 'Grupo Atlas Varejo' },
                  cnpj: { type: 'string', example: '12.345.678/0001-90' },
                  valor: { type: 'string', example: '84.500,00' },
                  vencimento: { type: 'string', example: '2026-08-12' },
                  seguro: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Duplicata registrada com sucesso.' },
          '400': { description: 'Erro de validação.' },
          '402': { description: 'Limite do plano Básico atingido — requer upgrade.' },
          '403': { description: 'Chave não pertence a uma conta cedente, ou é somente-leitura.' },
          '409': { description: 'Idempotency-Key reutilizada com um corpo diferente.' },
          '502': { description: 'Falha simulada ao registrar na registradora escolhida (B3/CERC/Núclea/Grafeno, roteada automaticamente) — repita a requisição.' },
        },
      },
    },
    '/duplicatas/{id}': {
      get: {
        summary: 'Consultar uma duplicata pelo id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Duplicata encontrada.' }, '404': { description: 'Não encontrada.' } },
      },
    },
    '/marketplace': {
      get: { summary: 'Listar ofertas ativas no marketplace', responses: { '200': { description: 'Lista de ofertas.' } } },
    },
    '/aceites': {
      get: {
        summary: 'Listar aceites (cedente vê os seus emitidos; sacado vê os que precisa confirmar/contestar)',
        responses: { '200': { description: 'Lista de aceites.' } },
      },
    },
    '/aceites/{id}/status': {
      post: {
        summary: 'Confirmar ou contestar um aceite (somente contas sacado)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['aceita', 'contestada'] } } } } },
        },
        responses: {
          '200': { description: 'Aceite atualizado.' },
          '403': { description: 'A duplicata não pertence a essa conta, ou a chave é somente-leitura.' },
          '404': { description: 'Aceite não encontrado.' },
          '409': { description: 'Idempotency-Key reutilizada com um corpo diferente.' },
        },
      },
    },
    '/seguradora': {
      get: {
        summary: 'Painel da seguradora: apólices seguradas e sinistros em aberto (somente contas seguradora)',
        responses: { '200': { description: 'Apólices e sinistros.' }, '403': { description: 'Chave não pertence a uma conta seguradora.' } },
      },
    },
    '/seguradora/sinistro/{duplicataId}/decidir': {
      post: {
        summary: 'Aprovar ou negar um sinistro (somente contas seguradora)',
        parameters: [
          { name: 'duplicataId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/IdempotencyKey' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision', 'note'],
                properties: { decision: { type: 'string', enum: ['aprovado', 'negado'] }, note: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Sinistro decidido.' },
          '403': { description: 'Chave não pertence a uma conta seguradora, ou é somente-leitura.' },
          '404': { description: 'Sinistro não encontrado ou já decidido.' },
          '409': { description: 'Conta não vinculada a uma seguradora parceira, ou Idempotency-Key reutilizada com corpo diferente.' },
        },
      },
    },
    '/sacados/{cnpj}/score': {
      get: {
        summary: 'Consultar score de crédito e rating de um sacado pelo CNPJ',
        description:
          'Combina o histórico interno da Lastro (se o CNPJ já transacionou na plataforma) com sinais de rede reportados por parceiros — funciona mesmo para um CNPJ que nunca transacionou diretamente na Lastro, desde que algum parceiro já tenha reportado um sinal sobre ele. A resposta traz `fonte` (interno/rede/combinado) e `sinaisDeRede`.',
        parameters: [{ name: 'cnpj', in: 'path', required: true, schema: { type: 'string' }, example: '12.345.678/0001-90' }],
        responses: { '200': { description: 'Score, rating, fatores, sinais de IA e sinais de rede.' }, '404': { description: 'Nenhum histórico (interno ou de rede) para este CNPJ.' } },
      },
    },
    '/sacados/{cnpj}/sinais': {
      post: {
        summary: 'Reportar um sinal de comportamento de pagamento para um CNPJ (rede compartilhada de risco)',
        description:
          'Qualquer parceiro (banco, FIDC, ERP…) pode contribuir uma observação sobre um sacado — pagamento pontual, atraso, protesto ou contestação — que passa a alimentar o score de rede de todos os parceiros, não só de quem reportou. Requer chave com escopo leitura e escrita.',
        parameters: [{ name: 'cnpj', in: 'path', required: true, schema: { type: 'string' }, example: '12.345.678/0001-90' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tipo'],
                properties: {
                  tipo: { type: 'string', enum: ['pagamento_pontual', 'atraso', 'protesto', 'contestacao'] },
                  nota: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Sinal registrado; retorna o score de rede/combinado atualizado.' },
          '400': { description: 'Erro de validação.' },
          '403': { description: 'Chave é somente-leitura.' },
        },
      },
    },
  },
};
