-- Piloto automático da empresa (lib/pilotoAutomatico.ts): quando um leilão fecha sem lance,
-- ele pode ser relançado sozinho — até um limite, para uma duplicata que ninguém quer não
-- ficar girando para sempre. Esta coluna conta quantas vezes isso já aconteceu.
ALTER TABLE duplicatas ADD COLUMN leilao_tentativas INTEGER NOT NULL DEFAULT 0;
