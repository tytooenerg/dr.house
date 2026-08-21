const base = 'flex-shrink-0';

export function NavIcon({ tab }: { tab: string }) {
  switch (tab) {
    case 'dashboard':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor' }} />;
    case 'marketplace':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />;
    case 'automacao':
      return <div className={base} style={{ width: 9, height: 9, borderRadius: 2, border: '1.5px solid currentColor', transform: 'rotate(45deg)' }} />;
    case 'erp':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px solid currentColor' }} />;
    case 'emitir':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px solid currentColor' }} />;
    case 'minhas':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px solid currentColor' }} />;
    case 'aceite':
      return <div className={base} style={{ width: 9, height: 6, borderBottom: '1.5px solid currentColor', borderLeft: '1.5px solid currentColor', transform: 'rotate(-45deg)', marginTop: -2 }} />;
    case 'sacado':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px solid currentColor' }} />;
    case 'disputa':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px solid currentColor', transform: 'rotate(45deg)' }} />;
    case 'risco':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid currentColor' }} />;
    case 'historico':
      return <div className={base} style={{ width: 8, height: 2, background: 'currentColor', marginTop: 3 }} />;
    case 'comparador':
      return <div className={base} style={{ width: 8, height: 8, border: '1.5px solid currentColor', transform: 'rotate(45deg)' }} />;
    case 'compliance':
      return <div className={base} style={{ width: 9, height: 9, borderRadius: '50% 50% 50% 0', border: '1.5px solid currentColor' }} />;
    case 'dev':
      return <div className={base} style={{ width: 9, height: 6, borderLeft: '1.5px solid currentColor', borderRight: '1.5px solid currentColor' }} />;
    case 'conta':
      return <div className={base} style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid currentColor' }} />;
    case 'receita':
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor', transform: 'rotate(45deg)' }} />;
    case 'perfil':
      return <div className={base} style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid currentColor' }} />;
    case 'secundario':
      return <div className={base} style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid currentColor', borderStyle: 'dashed' }} />;
    case 'cestas':
      return <div className={base} style={{ width: 9, height: 7, borderRadius: '0 0 3px 3px', border: '1.5px solid currentColor', borderTop: 'none' }} />;
    case 'seguradora':
      return <div className={base} style={{ width: 9, height: 9, borderRadius: '50% 50% 50% 0', border: '1.5px solid currentColor', transform: 'rotate(-45deg)' }} />;
    default:
      return <div className={base} style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor' }} />;
  }
}
