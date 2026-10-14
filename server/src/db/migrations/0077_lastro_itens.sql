-- Quais itens do checklist de lastro (lib/emitirCore.ts) a duplicata cumpria na emissão, em
-- JSON ({"nota_fiscal": true, ...}). Abaixo de 100% a duplicata nascia 'pendente_analise' e
-- nada no sistema a tirava de lá — CSV, ERP e o agente de IA emitem sem anexos, então tudo o
-- que criavam ficava travado para sempre. Guardar os itens permite completar depois
-- (lib/lastroCompletar.ts): anexando o que falta, a duplicata é reavaliada e liberada.
-- NULL nas duplicatas antigas: nelas só conta o que for anexado/informado daqui pra frente.
ALTER TABLE duplicatas ADD COLUMN lastro_itens TEXT;

-- 100% de lastro e mesmo assim 'pendente_analise' é um estado que nenhuma emissão produz (com
-- 100% ela nasce 'aprovada') — só os dados de demonstração antigos o tinham. Sem nada
-- faltando, não havia como sair dele.
UPDATE duplicatas SET status = 'aprovada' WHERE status = 'pendente_analise' AND lastro_pct = 100;
