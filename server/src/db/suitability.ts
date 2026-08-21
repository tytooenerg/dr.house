import { db } from './index.js';

export interface SuitabilityRow {
  user_id: number;
  score: number;
  profile: 'conservador' | 'moderado' | 'arrojado';
  answers_json: string;
  completed_at: string;
  expires_at: string;
}

export function getSuitability(userId: number): SuitabilityRow | undefined {
  return db.prepare('SELECT * FROM suitability_assessments WHERE user_id = ?').get(userId) as SuitabilityRow | undefined;
}

export function upsertSuitability(
  userId: number,
  score: number,
  profile: SuitabilityRow['profile'],
  answersJson: string,
  expiresAt: string
): SuitabilityRow {
  db.prepare(
    `INSERT INTO suitability_assessments (user_id, score, profile, answers_json, completed_at, expires_at)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(user_id) DO UPDATE SET score = excluded.score, profile = excluded.profile, answers_json = excluded.answers_json,
       completed_at = excluded.completed_at, expires_at = excluded.expires_at`
  ).run(userId, score, profile, answersJson, expiresAt);
  return getSuitability(userId)!;
}
