import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB_BY_ROLE, findNavItem, GROUP_LABELS, groupNavItems, NAV_GROUPS, NAV_ITEMS } from './navConfig';

// Espelho local de ROLE_TABS (server/src/data/seed.ts) pros dois papéis mais carregados —
// se o servidor ganhar uma tab nova sem entrada aqui, o Sidebar simplesmente não mostra
// (allowed.has falha), então o teste de "toda tab tem item" é o que pega esse esquecimento.
const INVESTIDOR_TABS = ['dashboard', 'marketplace', 'secundario', 'cestas', 'suitability', 'automacao', 'linha-credito', 'confirming', 'risco', 'historico', 'comparador', 'compliance', 'conta', 'receita', 'assinatura', 'disputa', 'perfil'];
const CEDENTE_TABS = ['dashboard', 'erp', 'emitir', 'minhas', 'linha-credito', 'contas-pagar', 'ai-cfo', 'aceite', 'risco', 'historico', 'compliance', 'dev', 'conta', 'receita', 'assinatura', 'disputa', 'perfil'];

describe('navConfig — menu agrupado por tarefa', () => {
  it('todo item tem chave e rota únicas e um grupo conhecido', () => {
    const keys = NAV_ITEMS.map((i) => i.key);
    const paths = NAV_ITEMS.map((i) => i.path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const i of NAV_ITEMS) expect(NAV_GROUPS).toContain(i.group);
    for (const g of NAV_GROUPS) expect(GROUP_LABELS[g]).toBeDefined();
  });

  it('toda tab padrão de papel aponta pra um item existente', () => {
    for (const key of Object.values(DEFAULT_TAB_BY_ROLE)) expect(NAV_ITEMS.some((i) => i.key === key)).toBe(true);
  });

  it.each([
    ['investidor', INVESTIDOR_TABS],
    ['cedente', CEDENTE_TABS],
  ])('%s: nenhum grupo passa de 5 itens e nenhuma tab fica de fora', (_role, tabs) => {
    const sections = groupNavItems(tabs);
    const shown = sections.flatMap((s) => s.items.map((i) => i.key));
    expect(shown.sort()).toEqual([...tabs].sort());
    for (const s of sections) expect(s.items.length).toBeLessThanOrEqual(5);
  });

  it('grupos vazios somem e a ordem segue NAV_GROUPS; "Início" não tem cabeçalho', () => {
    const sections = groupNavItems(['dashboard', 'perfil', 'admin']);
    expect(sections.map((s) => s.group)).toEqual(['inicio', 'plataforma']);
    expect(sections[0].label).toBe('');
    expect(sections[1].items.map((i) => i.key)).toEqual(['admin', 'perfil']);
  });

  it('findNavItem casa por segmento: sub-rota do admin acende Back-office, prefixo solto não vaza', () => {
    expect(findNavItem('/app/admin/reconciliacao')?.key).toBe('admin');
    expect(findNavItem('/app/admin')?.key).toBe('admin');
    expect(findNavItem('/app/contas-pagar')?.key).toBe('contas-pagar');
    expect(findNavItem('/app/nada')).toBeUndefined();
  });
});
