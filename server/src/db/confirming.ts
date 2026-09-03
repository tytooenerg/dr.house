import { db } from './index.js';
import type { Rating } from '../data/seed.js';

export interface ConfirmingProgramaRow {
  id: number;
  sacado_user_id: number;
  sacado_cnpj: string;
  rating: Rating;
  taxa_am: number;
  limite: number;
  utilizado: number;
  status: 'ativo' | 'pausado';
  created_at: string;
  updated_at: string;
}

export interface ConfirmingMembroRow {
  id: number;
  programa_id: number;
  cedente_user_id: number;
  sublimite: number | null;
  utilizado: number;
  status: 'ativo' | 'removido';
  created_at: string;
}

export function getProgramaBySacado(sacadoUserId: number): ConfirmingProgramaRow | undefined {
  return db.prepare('SELECT * FROM confirming_programas WHERE sacado_user_id = ?').get(sacadoUserId) as ConfirmingProgramaRow | undefined;
}

export function getProgramaById(id: number): ConfirmingProgramaRow | undefined {
  return db.prepare('SELECT * FROM confirming_programas WHERE id = ?').get(id) as ConfirmingProgramaRow | undefined;
}

export interface ConfirmingProgramaComSacado extends ConfirmingProgramaRow {
  sacado_nome: string;
  sacado_email: string;
}

// Visão de oversight do admin — todo programa que já existe, não só o de um sacado
// específico.
export function listProgramas(): ConfirmingProgramaComSacado[] {
  return db
    .prepare(
      `SELECT p.*, u.company_name as sacado_nome, u.email as sacado_email FROM confirming_programas p
       JOIN users u ON u.id = p.sacado_user_id
       ORDER BY p.created_at DESC`
    )
    .all() as ConfirmingProgramaComSacado[];
}

export function insertPrograma(input: { sacadoUserId: number; sacadoCnpj: string; rating: Rating; taxaAm: number; limite: number }): ConfirmingProgramaRow {
  db.prepare('INSERT INTO confirming_programas (sacado_user_id, sacado_cnpj, rating, taxa_am, limite) VALUES (?, ?, ?, ?, ?)').run(
    input.sacadoUserId,
    input.sacadoCnpj,
    input.rating,
    input.taxaAm,
    input.limite
  );
  return getProgramaBySacado(input.sacadoUserId)!;
}

export function setProgramaStatus(id: number, status: 'ativo' | 'pausado') {
  db.prepare('UPDATE confirming_programas SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
}

// Incrementado por lib/confirmingCore.ts's tentarFinanciarViaPrograma sempre que uma
// duplicata é financiada automaticamente dentro do programa.
export function setProgramaUtilizado(id: number, utilizado: number) {
  db.prepare('UPDATE confirming_programas SET utilizado = ?, updated_at = datetime(\'now\') WHERE id = ?').run(Math.max(0, utilizado), id);
}

// Mesmo papel de setProgramaUtilizado, mas por cedente matriculado — necessário pra
// checar o sublimite individual, não só o limite agregado do programa.
export function setMembroUtilizado(id: number, utilizado: number) {
  db.prepare('UPDATE confirming_membros SET utilizado = ? WHERE id = ?').run(Math.max(0, utilizado), id);
}

export interface ConfirmingMembroComCedente extends ConfirmingMembroRow {
  cedente_nome: string;
  cedente_email: string;
}

export function listMembrosByPrograma(programaId: number): ConfirmingMembroComCedente[] {
  return db
    .prepare(
      `SELECT m.*, u.company_name as cedente_nome, u.email as cedente_email FROM confirming_membros m
       JOIN users u ON u.id = m.cedente_user_id
       WHERE m.programa_id = ? ORDER BY m.created_at DESC`
    )
    .all(programaId) as ConfirmingMembroComCedente[];
}

export function getMembro(programaId: number, cedenteUserId: number): ConfirmingMembroRow | undefined {
  return db.prepare('SELECT * FROM confirming_membros WHERE programa_id = ? AND cedente_user_id = ?').get(programaId, cedenteUserId) as
    | ConfirmingMembroRow
    | undefined;
}

export function upsertMembro(programaId: number, cedenteUserId: number, sublimite: number | null): ConfirmingMembroRow {
  const existing = getMembro(programaId, cedenteUserId);
  if (existing) {
    db.prepare("UPDATE confirming_membros SET sublimite = ?, status = 'ativo' WHERE id = ?").run(sublimite, existing.id);
  } else {
    db.prepare('INSERT INTO confirming_membros (programa_id, cedente_user_id, sublimite) VALUES (?, ?, ?)').run(programaId, cedenteUserId, sublimite);
  }
  return getMembro(programaId, cedenteUserId)!;
}

export function setMembroStatus(id: number, status: 'ativo' | 'removido') {
  db.prepare('UPDATE confirming_membros SET status = ? WHERE id = ?').run(status, id);
}

export interface ConfirmingMatriculaView extends ConfirmingMembroRow {
  sacado_nome: string;
  taxa_am: number;
  programa_status: 'ativo' | 'pausado';
}

// Toda matrícula ativa de um cedente, através de qualquer programa — usado pra mostrar
// "programas disponíveis" no fluxo de emissão (feature futura) e num card informativo
// nesta fundação.
export function listMatriculasByCedente(cedenteUserId: number): ConfirmingMatriculaView[] {
  return db
    .prepare(
      `SELECT m.*, u.company_name as sacado_nome, p.taxa_am as taxa_am, p.status as programa_status FROM confirming_membros m
       JOIN confirming_programas p ON p.id = m.programa_id
       JOIN users u ON u.id = p.sacado_user_id
       WHERE m.cedente_user_id = ? AND m.status = 'ativo' ORDER BY m.created_at DESC`
    )
    .all(cedenteUserId) as ConfirmingMatriculaView[];
}
