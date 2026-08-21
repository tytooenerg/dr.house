# Teste de carga

`run.mjs` é um script sem dependências novas (usa só o `fetch` nativo do Node 18+) que
autentica com uma conta de demo real e dispara um mix ponderado de leituras reais
(`/api/market`, `/api/dashboard`, `/api/minhas`, `/api/public/stats`, `/api/health`) contra
o servidor por um tempo fixo, com N workers concorrentes — e reporta p50/p95/erro reais
por endpoint, não uma estimativa.

## Uso

```bash
npm run dev -w server          # em um terminal — precisa estar rodando e com seed carregado
npm run loadtest                # em outro terminal — usa os padrões (12s, 15 workers, localhost:4000)
node scripts/loadtest/run.mjs --url http://localhost:4000 --duration 30 --concurrency 30
```

## Baseline real (rodado neste ambiente de sandbox, 2026)

12s, 15 workers concorrentes, contra `npm run dev` local (SQLite `:memory:`-like em disco,
sem otimização de produção, hardware compartilhado de sandbox — **não é representativo de
hardware/rede de produção**, é só o número real que este ambiente específico deu):

| Cenário | Requisições | Erros | p50 | p95 | Média |
|---|---|---|---|---|---|
| GET /api/market | 3.737 | 0 | 14,2ms | 27,9ms | 16,0ms |
| GET /api/public/stats | 2.791 | 0 | 12,7ms | 26,7ms | 14,4ms |
| GET /api/minhas | 1.872 | 0 | 12,9ms | 26,9ms | 14,8ms |
| GET /api/health | 902 | 0 | 12,8ms | 26,3ms | 14,3ms |
| GET /api/dashboard | 2.692 | 0 | 12,9ms | 26,8ms | 14,6ms |

**Total: 11.994 requisições em 12,0s (~998 req/s), 0 erros.**

Isso é um teto otimista (um único processo Node, SQLite local, sem rede real entre cliente
e servidor) — útil como baseline pra comparar depois de qualquer mudança de performance
(ex: antes/depois de habilitar o cache do `lib/cache.ts`, antes/depois de uma migração de
banco), não como número de capacidade de produção. Rodar de novo com `--duration` maior e
contra um servidor real (não local) antes de qualquer decisão de capacidade.
