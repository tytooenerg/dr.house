# Política de versionamento da API pública (`/api/v1`)

Este documento existe porque nenhuma empresa constrói uma parte real do próprio negócio sobre uma API cuja evolução é imprevisível. É uma política real — com um mecanismo real por trás dela (`server/src/lib/apiVersioning.ts`), não apenas uma promessa em texto.

## Estado atual

A API pública está na versão **v1** (`/api/v1`), em produção desde a primeira integração de parceiro. **v1 nunca foi descontinuada** — nenhum parceiro jamais recebeu um aviso de migração. Você pode confirmar isso a qualquer momento consultando `GET /api/v1/openapi.json` ou inspecionando os cabeçalhos `Deprecation`/`Sunset` de qualquer resposta real (ausentes hoje — ver "Mecanismo" abaixo).

## O que é uma mudança compatível (não quebra nada)

Estas mudanças podem acontecer em `/v1` a qualquer momento, sem aviso prévio, sem incrementar a versão:

- Adicionar um novo endpoint.
- Adicionar um campo novo e opcional numa requisição.
- Adicionar um campo novo numa resposta (um cliente bem escrito ignora campos desconhecidos).
- Adicionar um novo valor possível a um enum existente numa resposta (ex.: um novo `status`), desde que os valores antigos continuem significando a mesma coisa.
- Corrigir um bug em que o comportamento documentado e o comportamento real divergiam — o comportamento real documentado (`GET /api/v1/openapi.json`) é sempre o contrato válido, nunca uma suposição não documentada sobre como algo "sempre se comportou".
- Adicionar um novo evento de webhook.
- Adicionar um novo cabeçalho de resposta.

## O que é uma mudança quebradora (breaking change)

Qualquer uma destas exige uma nova versão principal (`/v2`) coexistindo com `/v1`, nunca uma alteração silenciosa em `/v1`:

- Remover ou renomear um endpoint, campo de requisição ou campo de resposta existente.
- Tornar obrigatório um campo de requisição que antes era opcional.
- Mudar o tipo/formato de um campo existente (ex.: `valor` deixar de ser string formatada e virar número).
- Mudar o significado semântico de um valor existente de enum.
- Mudar o formato de autenticação.
- Reduzir um limite de taxa (rate limit) abaixo do que já foi comunicado a um parceiro específico (mudanças na estrutura geral de tiers, documentadas no changelog, não contam como isso).
- Qualquer mudança que faça uma integração hoje funcional parar de funcionar sem alteração de código do lado do parceiro.

## Prazo mínimo de aviso

Uma vez que `/v2` exista e `/v1` seja formalmente descontinuada:

1. **Aviso mínimo de 12 meses** antes do desligamento (`sunset`) real de `/v1` — tempo suficiente para qualquer integração real migrar sem pressa.
2. `/v1` e `/v2` **coexistem** durante todo esse período — nunca há uma janela em que uma integração existente simplesmente para de funcionar da noite para o dia.
3. Toda chave de API ativa nos últimos 90 dias antes do aviso recebe uma notificação real (email, mesmo canal usado hoje para outras comunicações de conta) além dos cabeçalhos HTTP — o mecanismo abaixo não substitui um aviso humano direto.

## Mecanismo real (não apenas texto)

`server/src/lib/apiVersioning.ts` implementa o lado técnico desta política:

- `getV1SunsetDate()` / `setV1SunsetDate()` leem/escrevem uma data real em `platform_settings` (mesma tabela chave-valor já usada para o limiar do Compliance Engine e outros parâmetros administráveis).
- `apiVersioningHeaders` é um middleware real, montado em `v1Router` antes até da autenticação — quando uma data de sunset está configurada, toda resposta de `/v1` passa a carregar de verdade:
  - `Deprecation: true`
  - `Sunset: <data em formato HTTP, RFC 8594>`
  - `Link: </docs>; rel="deprecation"; type="text/html"`
- `GET/PUT /admin/api-versioning` (painel do admin) lê/define a data — sem precisar de deploy de código para o aviso começar a valer.

Hoje esses cabeçalhos nunca aparecem, porque nenhuma data de sunset foi configurada — o mesmo princípio "real-when-configured" usado no resto desta base de código: o mecanismo é genuíno e testado (`server/test/api-versioning.test.ts`), só está inativo porque não há nada real para anunciar ainda.

## Como uma futura `/v2` coexistiria

Quando/se `/v2` for necessária:

- `/v1` continua respondendo exatamente como responde hoje durante todo o período de aviso — nenhuma mudança de comportamento é retroativamente aplicada a `/v1`.
- `/v2` é montada como um router separado (`v2Router`), do mesmo jeito que `/v1` é montado hoje — reaproveitando a lógica de negócio compartilhada (`lib/*Core.ts`) sempre que o contrato subjacente não mudou, para as duas versões nunca divergirem silenciosamente na lógica que ambas efetivamente compartilham.
- O SDK oficial (`sdks/node`, `sdks/python`) recebe uma major version nova alinhada à API — `2.x.x` do pacote assume `/v2`, `1.x.x` continua funcionando contra `/v1` durante toda a janela de coexistência.

## Versionamento dos SDKs oficiais

`@lastro/sdk` (Node) e `lastro-sdk` (Python) seguem [semver](https://semver.org/):

- **patch** (`1.0.x`): correção de bug, sem mudança de assinatura pública.
- **minor** (`1.x.0`): novo método/campo opcional, compatível com versões anteriores.
- **major** (`x.0.0`): só quando a API pública que o SDK envolve sofre uma mudança quebradora de verdade — nunca por reorganização interna do SDK sozinha.

Os SDKs ainda não foram publicados num registry real (npm/PyPI) — ver a seção correspondente no README ("Documentação pública de desenvolvedor") para o estado exato disso.
