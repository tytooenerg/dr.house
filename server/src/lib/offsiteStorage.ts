import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { logger } from './logger.js';

// Cópia dos backups FORA do servidor, em qualquer armazenamento compatível com S3 (Backblaze
// B2, AWS S3, Cloudflare R2, Wasabi, MinIO). Os snapshots de lib/backup.ts ficam no mesmo
// disco que o banco — se o VPS for perdido, dados e backups vão juntos — e os documentos
// enviados (KYB, contratos, comprovantes, NF-e) não tinham cópia nenhuma.
//
// O BACKUP_OFFSITE_CMD continua existindo, mas exige instalar aws-cli/rclone dentro do
// container. Aqui basta preencher variáveis no .env: a requisição é assinada com AWS
// Signature V4 usando só node:crypto, sem dependência nova.
//
// Real quando configurado: sem as variáveis nada é enviado e o painel diz claramente que os
// backups estão só no disco do servidor — nunca finge que uma cópia existe.

export interface OffsiteConfig {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const VARS = ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY'] as const;

// A região entra na assinatura. O painel do B2 mostra o endpoint (s3.us-west-004.backblazeb2.com)
// e a região está dentro dele — deduzir evita uma variável a mais pra errar.
function deduzirRegiao(host: string): string {
  const b2 = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(host);
  if (b2) return b2[1];
  if (host.endsWith('.r2.cloudflarestorage.com')) return 'auto';
  const aws = /^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(host);
  if (aws && aws[1] !== 'external-1') return aws[1];
  return 'us-east-1';
}

export function getOffsiteConfig(env: NodeJS.ProcessEnv = process.env): OffsiteConfig | null {
  if (VARS.some((v) => !env[v]?.trim())) return null;
  const bruto = env.BACKUP_S3_ENDPOINT!.trim();
  let endpoint: URL;
  try {
    // O painel do B2 mostra o endpoint sem "https://".
    endpoint = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  } catch {
    return null;
  }
  return {
    endpoint,
    region: env.BACKUP_S3_REGION?.trim() || deduzirRegiao(endpoint.hostname),
    bucket: env.BACKUP_S3_BUCKET!.trim(),
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!.trim(),
  };
}

export function offsiteEnabled(): boolean {
  return getOffsiteConfig() !== null;
}

// O que o painel pode mostrar: onde, nunca com quais chaves.
export function offsiteDestino(cfg: OffsiteConfig | null = getOffsiteConfig()): string | null {
  return cfg ? `${cfg.endpoint.host}/${cfg.bucket}` : null;
}

{
  const faltando = VARS.filter((v) => !process.env[v]?.trim());
  if (faltando.length === 0) {
    logger.info({ destino: offsiteDestino() }, '[backup-offsite] cópia dos backups fora do servidor habilitada');
  } else if (faltando.length < VARS.length) {
    logger.warn({ faltando }, '[backup-offsite] BACKUP_S3_* incompleto — backups ficam só no disco do servidor');
  } else {
    logger.info('[backup-offsite] BACKUP_S3_* não configurado — backups ficam só no disco do servidor');
  }
}

// ---------------------------------------------------------------------------------------
// AWS Signature Version 4
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 3986, como o S3 exige: encodeURIComponent deixa passar !'()* .
function encodeSegmento(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function canonicalPath(bucket: string, key: string): string {
  return '/' + [bucket, ...key.split('/')].map(encodeSegmento).join('/');
}

export interface SignV4Input {
  method: string;
  // Já codificado (canonicalPath).
  path: string;
  // Todos os cabeçalhos entram na assinatura; host, x-amz-date e x-amz-content-sha256 são obrigatórios.
  headers: Record<string, string>;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function signV4(input: SignV4Input): string {
  const service = input.service ?? 's3';
  const headers = Object.entries(input.headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const amzDate = headers.find(([k]) => k === 'x-amz-date')?.[1];
  const payloadHash = headers.find(([k]) => k === 'x-amz-content-sha256')?.[1];
  if (!amzDate || !payloadHash) throw new Error('signV4: x-amz-date e x-amz-content-sha256 são obrigatórios');
  const dia = amzDate.slice(0, 8);
  const signedHeaders = headers.map(([k]) => k).join(';');

  const canonicalRequest = [
    input.method,
    input.path,
    '', // sem query string
    headers.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const escopo = `${dia}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, escopo, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + input.secretAccessKey, dia);
  const kSigning = hmac(hmac(hmac(kDate, input.region), service), 'aws4_request');
  const assinatura = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${escopo}, SignedHeaders=${signedHeaders}, Signature=${assinatura}`;
}

function amzDateAgora(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function sha256Arquivo(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

// Erros de rede chegam como texto do OpenSSL/libuv — o painel mostra algo que o admin entende.
function erroDeConexao(err: NodeJS.ErrnoException, endpoint: URL): Error {
  const host = endpoint.host;
  switch (err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new Error(`endereço ${host} não encontrado — confira BACKUP_S3_ENDPOINT`);
    case 'ECONNREFUSED':
      return new Error(`${host} recusou a conexão — confira BACKUP_S3_ENDPOINT`);
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
      return new Error(`falha de HTTPS ao falar com ${host} — o endereço aceita https? (BACKUP_S3_ENDPOINT)`);
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return new Error(`conexão com ${host} caiu (${err.code}) — tenta de novo no próximo backup`);
    default:
      return err;
  }
}

// PUT de um arquivo em stream (o banco pode ter centenas de MB — nada é carregado inteiro na
// memória), com Content-Length explícito: o B2 recusa upload chunked sem tamanho.
export async function putObject(cfg: OffsiteConfig, key: string, filePath: string): Promise<void> {
  const payloadHash = await sha256Arquivo(filePath);
  const size = fs.statSync(filePath).size;
  const caminho = canonicalPath(cfg.bucket, key);
  const headers: Record<string, string> = {
    host: cfg.endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDateAgora(),
  };
  headers.authorization = signV4({ method: 'PUT', path: caminho, headers, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
  headers['content-length'] = String(size);
  headers['content-type'] = 'application/octet-stream';

  const mod = cfg.endpoint.protocol === 'http:' ? http : https;
  await new Promise<void>((resolve, reject) => {
    const req = mod.request(
      { protocol: cfg.endpoint.protocol, hostname: cfg.endpoint.hostname, port: cfg.endpoint.port || undefined, method: 'PUT', path: caminho, headers },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return resolve();
          const corpo = Buffer.concat(partes).toString('utf8');
          const code = /<Code>([^<]*)<\/Code>/.exec(corpo)?.[1];
          const msg = /<Message>([^<]*)<\/Message>/.exec(corpo)?.[1];
          reject(new Error(`armazenamento respondeu HTTP ${status}${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}`));
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(10 * 60 * 1000, () => req.destroy(new Error('tempo esgotado enviando para o armazenamento')));
    req.on('error', (err: NodeJS.ErrnoException) => reject(erroDeConexao(err, cfg.endpoint)));
    const leitura = fs.createReadStream(filePath);
    leitura.on('error', (err) => req.destroy(err));
    leitura.pipe(req);
  });
}

// ---------------------------------------------------------------------------------------
// Sincronização: snapshot do banco + documentos novos

export interface OffsiteState {
  // nome do documento → tamanho em bytes quando foi enviado. Uploads nunca são reescritos
  // (o nome leva id do usuário + timestamp), então nome+tamanho basta para não reenviar.
  enviados: Record<string, number>;
  ultimoEnvioEm: string | null;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
}

const estadoVazio = (): OffsiteState => ({ enviados: {}, ultimoEnvioEm: null, ultimoErro: null, ultimoErroEm: null });

export function readOffsiteState(stateFile: string): OffsiteState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Partial<OffsiteState>;
    return { ...estadoVazio(), ...raw, enviados: raw.enviados ?? {} };
  } catch {
    return estadoVazio();
  }
}

function writeOffsiteState(stateFile: string, state: OffsiteState) {
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, stateFile);
}

function documentosLocais(uploadsDir: string): { nome: string; tamanho: number }[] {
  if (!fs.existsSync(uploadsDir)) return [];
  return fs
    .readdirSync(uploadsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => ({ nome: d.name, tamanho: fs.statSync(path.join(uploadsDir, d.name)).size }));
}

export interface OffsiteSyncInput {
  snapshotPath: string;
  uploadsDir: string;
  stateFile: string;
}

export interface OffsiteSyncResult {
  enviado: boolean;
  documentosNovos: number;
  erro: string | null;
}

let fila: Promise<unknown> = Promise.resolve();

// Nunca lança: uma falha do armazenamento externo não pode derrubar o backup local, que já
// foi gravado. O erro fica registrado no estado e aparece no painel.
export function syncOffsite(input: OffsiteSyncInput): Promise<OffsiteSyncResult> {
  // Job das 6h e botão "Rodar backup agora" ao mesmo tempo: um espera o outro, para não
  // enviar o mesmo documento duas vezes nem corromper o arquivo de estado.
  const run = fila.then(() => syncOffsiteAgora(input));
  fila = run.catch(() => {});
  return run;
}

async function syncOffsiteAgora({ snapshotPath, uploadsDir, stateFile }: OffsiteSyncInput): Promise<OffsiteSyncResult> {
  const cfg = getOffsiteConfig();
  if (!cfg) return { enviado: false, documentosNovos: 0, erro: null };
  const state = readOffsiteState(stateFile);
  let documentosNovos = 0;
  try {
    await putObject(cfg, `db/${path.basename(snapshotPath)}`, snapshotPath);
    for (const doc of documentosLocais(uploadsDir)) {
      if (state.enviados[doc.nome] === doc.tamanho) continue;
      await putObject(cfg, `uploads/${doc.nome}`, path.join(uploadsDir, doc.nome));
      state.enviados[doc.nome] = doc.tamanho;
      documentosNovos++;
    }
    state.ultimoEnvioEm = new Date().toISOString();
    state.ultimoErro = null;
    state.ultimoErroEm = null;
    writeOffsiteState(stateFile, state);
    logger.info({ destino: offsiteDestino(cfg), documentosNovos }, '[backup-offsite] cópia enviada para fora do servidor');
    return { enviado: true, documentosNovos, erro: null };
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    state.ultimoErro = erro;
    state.ultimoErroEm = new Date().toISOString();
    // Os documentos que chegaram antes da falha ficam marcados — a próxima rodada continua daí.
    try {
      writeOffsiteState(stateFile, state);
    } catch (errEstado) {
      logger.warn({ err: errEstado }, '[backup-offsite] não consegui gravar o estado do envio');
    }
    logger.error({ err, destino: offsiteDestino(cfg) }, '[backup-offsite] falha ao enviar cópia para fora do servidor');
    return { enviado: false, documentosNovos, erro };
  }
}

export interface OffsiteStatus {
  configurado: boolean;
  destino: string | null;
  ultimoEnvioEm: string | null;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
  documentosEnviados: number;
  documentosPendentes: number;
}

export function getOffsiteStatus(stateFile: string, uploadsDir: string): OffsiteStatus {
  const cfg = getOffsiteConfig();
  const state = readOffsiteState(stateFile);
  const pendentes = documentosLocais(uploadsDir).filter((d) => state.enviados[d.nome] !== d.tamanho).length;
  return {
    configurado: cfg !== null,
    destino: offsiteDestino(cfg),
    ultimoEnvioEm: state.ultimoEnvioEm,
    ultimoErro: state.ultimoErro,
    ultimoErroEm: state.ultimoErroEm,
    documentosEnviados: Object.keys(state.enviados).length,
    documentosPendentes: pendentes,
  };
}
