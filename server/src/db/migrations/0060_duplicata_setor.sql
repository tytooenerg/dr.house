-- Feature "Marketplace: filtros por setor/faixa de valor/prazo/rating" — hoje o
-- investidor só busca por texto e ordena por 4 critérios (taxa, score, valor, prazo); não
-- existia campo nenhum de setor persistido na duplicata (só um texto livre de "Concentração
-- setorial" dentro do perfil de risco simulado do sacado, usado apenas pelo auto-bid em
-- lib/agents/automation.ts). Persistindo o setor na própria duplicata (calculado uma vez na
-- emissão, igual ao score) permite filtrar o marketplace por setor sem recalcular por
-- request, e dá ao futuro agente de risco de carteira do investidor um campo real pra somar
-- exposição setorial, não só por sacado individual.
ALTER TABLE duplicatas ADD COLUMN setor TEXT;
