-- Anunciante pagava mensalidade fixa (lib/advertisementBilling.ts) sem nenhuma métrica de
-- performance de volta — nem quantas vezes o anúncio foi servido no carrossel da landing
-- page (routes/public.ts's GET /public/advertisements), nem quantos cliques o link recebeu.
-- Contador agregado por anúncio é suficiente pro caso de uso (mostrar o número pro próprio
-- anunciante em PublicidadePage.tsx) — não precisa de log por evento.
ALTER TABLE advertisements ADD COLUMN impressoes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE advertisements ADD COLUMN cliques INTEGER NOT NULL DEFAULT 0;
