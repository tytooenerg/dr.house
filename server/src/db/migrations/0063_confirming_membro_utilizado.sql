-- O financiamento automático (feature seguinte) precisa checar o sublimite de cada
-- cedente matriculado contra o quanto ele já usou dentro do programa — não só o limite
-- agregado do programa inteiro (confirming_programas.utilizado, já existe desde 0061).
-- Sem isso, um cedente com sublimite de R$50 mil e outro sem sublimite algum ficariam
-- indistinguíveis assim que o agregado do programa tivesse espaço.
ALTER TABLE confirming_membros ADD COLUMN utilizado REAL NOT NULL DEFAULT 0;
