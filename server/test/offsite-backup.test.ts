import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { canonicalPath, getOffsiteConfig, getOffsiteStatus, signV4, syncOffsite } from '../src/lib/offsiteStorage.js';

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

describe('signV4 — assinatura AWS Signature V4', () => {
  // Exemplo "GET Object" da documentação oficial do S3:
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  it('reproduz o vetor oficial da AWS', () => {
    const authorization = signV4({
      method: 'GET',
      path: '/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
  });

  it('codifica a chave do objeto como o S3 exige (RFC 3986, barra preservada)', () => {
    expect(canonicalPath('meu-bucket', "uploads/7-1700000000000-nota (1)!.pdf")).toBe('/meu-bucket/uploads/7-1700000000000-nota%20%281%29%21.pdf');
  });
});

describe('getOffsiteConfig', () => {
  const base = { BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY_ID: 'k', BACKUP_S3_SECRET_ACCESS_KEY: 's' };

  it('sem as variáveis: não configurado', () => {
    expect(getOffsiteConfig({})).toBeNull();
    expect(getOffsiteConfig({ ...base })).toBeNull();
  });

  it('aceita o endpoint do B2 como o painel mostra (sem https) e deduz a região', () => {
    const cfg = getOffsiteConfig({ ...base, BACKUP_S3_ENDPOINT: 's3.us-west-004.backblazeb2.com' })!;
    expect(cfg.endpoint.href).toBe('https://s3.us-west-004.backblazeb2.com/');
    expect(cfg.region).toBe('us-west-004');
  });

  it('BACKUP_S3_REGION explícito vence a dedução', () => {
    expect(getOffsiteConfig({ ...base, BACKUP_S3_ENDPOINT: 'https://minio.local:9000', BACKUP_S3_REGION: 'sa-east-1' })!.region).toBe('sa-east-1');
    expect(getOffsiteConfig({ ...base, BACKUP_S3_ENDPOINT: 'https://minio.local:9000' })!.region).toBe('us-east-1');
  });
});

// Um "S3" de mentira, local, que guarda o que recebe e confere o que um S3 de verdade
// conferiria: assinatura válida e hash do conteúdo batendo com x-amz-content-sha256.
interface Recebido {
  path: string;
  body: Buffer;
  authorization: string;
  contentLength: string | undefined;
}

describe('syncOffsite — envio do snapshot e dos documentos', () => {
  const SECRET = 'segredo-de-teste';
  let server: http.Server;
  let recebidos: Recebido[] = [];
  let falharCom: number | null = null;
  let dir: string;
  let uploadsDir: string;
  let stateFile: string;
  let snapshot: string;
  const envAntes = { ...process.env };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (c: Buffer) => partes.push(c));
      req.on('end', () => {
        const body = Buffer.concat(partes);
        if (falharCom) {
          res.writeHead(falharCom, { 'content-type': 'application/xml' });
          res.end('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>chave sem permissão</Message></Error>');
          return;
        }
        const h = req.headers as Record<string, string>;
        const esperado = signV4({
          method: req.method!,
          path: req.url!,
          headers: { host: h.host, 'x-amz-content-sha256': h['x-amz-content-sha256'], 'x-amz-date': h['x-amz-date'] },
          region: 'us-east-1',
          accessKeyId: 'KEYID',
          secretAccessKey: SECRET,
        });
        if (h.authorization !== esperado || sha256(body) !== h['x-amz-content-sha256']) {
          res.writeHead(403);
          res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
          return;
        }
        recebidos.push({ path: req.url!, body, authorization: h.authorization, contentLength: h['content-length'] });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterAll(() => {
    server.close();
  });

  const configurar = () => {
    const { port } = server.address() as AddressInfo;
    process.env.BACKUP_S3_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.BACKUP_S3_BUCKET = 'lastro-backups';
    process.env.BACKUP_S3_ACCESS_KEY_ID = 'KEYID';
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = SECRET;
    delete process.env.BACKUP_S3_REGION;
  };

  const prepararArquivos = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastro-offsite-'));
    uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(uploadsDir);
    stateFile = path.join(dir, '.offsite-state.json');
    snapshot = path.join(dir, 'lastro-2026-10-10T00-00-00-000Z.db');
    fs.writeFileSync(snapshot, crypto.randomBytes(300_000));
    fs.writeFileSync(path.join(uploadsDir, '7-1700000000000-contrato.pdf'), 'pdf do contrato');
    fs.writeFileSync(path.join(uploadsDir, '9-1700000000001-kyb.png'), 'imagem do kyb');
  };

  afterEach(() => {
    process.env = { ...envAntes };
    recebidos = [];
    falharCom = null;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('envia o snapshot com o conteúdo exato, assinado, e cada documento uma vez só', async () => {
    configurar();
    prepararArquivos();

    const r1 = await syncOffsite({ snapshotPath: snapshot, uploadsDir, stateFile });
    expect(r1).toEqual({ enviado: true, documentosNovos: 2, erro: null });
    const db = recebidos.find((r) => r.path === '/lastro-backups/db/lastro-2026-10-10T00-00-00-000Z.db')!;
    expect(db.body.equals(fs.readFileSync(snapshot))).toBe(true);
    expect(db.contentLength).toBe('300000');
    expect(db.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=KEYID\/\d{8}\/us-east-1\/s3\/aws4_request/);
    expect(recebidos.map((r) => r.path).sort()).toEqual([
      '/lastro-backups/db/lastro-2026-10-10T00-00-00-000Z.db',
      '/lastro-backups/uploads/7-1700000000000-contrato.pdf',
      '/lastro-backups/uploads/9-1700000000001-kyb.png',
    ]);

    // Segunda rodada: só o snapshot novo e o documento novo.
    recebidos = [];
    fs.writeFileSync(path.join(uploadsDir, '7-1700000000002-comprovante.pdf'), 'comprovante');
    const r2 = await syncOffsite({ snapshotPath: snapshot, uploadsDir, stateFile });
    expect(r2.documentosNovos).toBe(1);
    expect(recebidos.map((r) => r.path).sort()).toEqual([
      '/lastro-backups/db/lastro-2026-10-10T00-00-00-000Z.db',
      '/lastro-backups/uploads/7-1700000000002-comprovante.pdf',
    ]);

    const status = getOffsiteStatus(stateFile, uploadsDir);
    expect(status).toMatchObject({ configurado: true, ultimoErro: null, documentosEnviados: 3, documentosPendentes: 0 });
    expect(status.destino).toMatch(/^127\.0\.0\.1:\d+\/lastro-backups$/);
    expect(status.ultimoEnvioEm).not.toBeNull();
    // O status vai para o painel: nunca carrega as chaves.
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(JSON.stringify(status)).not.toContain('KEYID');
  });

  it('falha do armazenamento vira erro registrado, sem lançar — o backup local segue intacto', async () => {
    configurar();
    prepararArquivos();
    falharCom = 403;

    const r = await syncOffsite({ snapshotPath: snapshot, uploadsDir, stateFile });
    expect(r.enviado).toBe(false);
    expect(r.erro).toBe('armazenamento respondeu HTTP 403 AccessDenied: chave sem permissão');
    expect(fs.existsSync(snapshot)).toBe(true);
    const status = getOffsiteStatus(stateFile, uploadsDir);
    expect(status.ultimoErro).toBe(r.erro);
    expect(status.ultimoErroEm).not.toBeNull();
    expect(status.documentosPendentes).toBe(2);

    // Quando volta a funcionar, o erro some e tudo que faltava é enviado.
    falharCom = null;
    const r2 = await syncOffsite({ snapshotPath: snapshot, uploadsDir, stateFile });
    expect(r2).toEqual({ enviado: true, documentosNovos: 2, erro: null });
    expect(getOffsiteStatus(stateFile, uploadsDir).ultimoErro).toBeNull();
  });

  it('assinatura errada (segredo diferente) é recusada pelo "S3" e reportada', async () => {
    configurar();
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'outro-segredo';
    prepararArquivos();
    const r = await syncOffsite({ snapshotPath: snapshot, uploadsDir, stateFile });
    expect(r.erro).toBe('armazenamento respondeu HTTP 403 SignatureDoesNotMatch');
  });

  it('sem configuração: nada é enviado e o status diz "não configurado"', async () => {
    delete process.env.BACKUP_S3_ENDPOINT;
    prepararArquivos();
    const r = await syncOffsite({ snapshotPath: snapshot, uploadsDir, stateFile });
    expect(r).toEqual({ enviado: false, documentosNovos: 0, erro: null });
    expect(recebidos).toHaveLength(0);
    expect(getOffsiteStatus(stateFile, uploadsDir)).toMatchObject({ configurado: false, destino: null, ultimoEnvioEm: null, documentosPendentes: 2 });
  });
});
