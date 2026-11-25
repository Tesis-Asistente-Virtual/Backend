import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { ReferralEmail, ReferralMailer, ReferralSmtpFailureStage } from '../../application/ports/referral-mailer.js';
import { ReferralMailerError } from '../../application/ports/referral-mailer.js';

export interface ReferralSmtpSettings {
  readonly host?: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly from?: string;
  /** Hard deadline for the complete SMTP transaction, not an idle timeout. */
  readonly timeoutMs?: number;
}

type SmtpReply = { readonly code: number };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

export class ImplicitTlsSmtpReferralMailer implements ReferralMailer {
  constructor(private readonly settings: ReferralSmtpSettings) {
    if (!settings.host || !settings.username || !settings.password || !settings.from || settings.port !== 465 ||
      !/^[A-Za-z0-9.-]+$/u.test(settings.host) || !emailPattern.test(settings.from) ||
      !Number.isInteger(settings.timeoutMs ?? 15_000) || (settings.timeoutMs ?? 15_000) < 1) {
      throw new Error('Referral SMTP is not securely configured');
    }
  }

  async send(email: ReferralEmail): Promise<{ messageId: string }> {
    if (!emailPattern.test(email.recipient) || email.bodyText.length > 12_000 || /[\r\n]/u.test(email.recipient)) {
      throw new ReferralMailerError('unavailable', { stage: 'tls_connect', failureCode: 'invalid_request', durationMs: 0, acceptanceUncertain: false });
    }
    const startedAt = Date.now();
    const timeoutMs = this.settings.timeoutMs ?? 15_000;
    const host = this.settings.host as string;
    const from = this.settings.from as string;
    const messageId = `<${randomUUID()}@${host.replace(/[^A-Za-z0-9.-]/gu, '') || 'localhost'}>`;
    const socket = tlsConnect({ host, port: this.settings.port, servername: host, rejectUnauthorized: true });
    const readline = createInterface({ input: socket, crlfDelay: Infinity });
    const lines = readline[Symbol.asyncIterator]();
    let stage: ReferralSmtpFailureStage = 'tls_connect';
    let dataWasSubmitted = false;
    let accepted = false;

    const transaction = async (): Promise<{ messageId: string }> => {
      await waitForTls(socket);
      stage = 'server_greeting';
      await expectReply(lines, [220], stage);
      stage = 'ehlo';
      await sendCommand(socket, lines, 'EHLO localhost', [250], stage);
      stage = 'authentication';
      const credentials = Buffer.from(`\0${this.settings.username}\0${this.settings.password}`, 'utf8').toString('base64');
      const auth = await sendRawCommand(socket, lines, `AUTH PLAIN ${credentials}`, stage);
      if (auth.code === 334) {
        await sendLine(socket, credentials);
        await expectReply(lines, [235], stage);
      } else if (auth.code !== 235) {
        throw smtpRejection(auth.code, stage);
      }
      stage = 'mail_from';
      await sendCommand(socket, lines, `MAIL FROM:<${from}>`, [250], stage);
      stage = 'recipient';
      await sendCommand(socket, lines, `RCPT TO:<${email.recipient}>`, [250, 251], stage);
      stage = 'data_command';
      await sendCommand(socket, lines, 'DATA', [354], stage);
      const date = new Date().toUTCString();
      const bodyBase64 = Buffer.from(email.bodyText, 'utf8').toString('base64').match(/.{1,76}/gu)?.join('\r\n') ?? '';
      const message = [
        `From: <${from}>`, `To: <${email.recipient}>`, 'Subject: Solicitud voluntaria de orientacion psicologica',
        `Date: ${date}`, `Message-ID: ${messageId}`, 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', bodyBase64, '.',
      ].join('\r\n');
      stage = 'data_submission';
      dataWasSubmitted = true;
      await sendLine(socket, message);
      stage = 'data_acceptance';
      await expectReply(lines, [250], stage);
      accepted = true;
      stage = 'quit';
      try { await sendCommand(socket, lines, 'QUIT', [221], stage); } catch { /* SMTP already accepted the message. */ }
      return { messageId };
    };

    try {
      return await runWithSmtpDeadline(transaction(), timeoutMs, () => {
          const durationMs = Date.now() - startedAt;
          socket.destroy();
          return new ReferralMailerError(dataWasSubmitted ? 'delivery_unknown' : 'unavailable', {
            stage, failureCode: 'timeout', durationMs, acceptanceUncertain: dataWasSubmitted,
          });
      });
    } catch (error) {
      if (accepted) return { messageId };
      if (error instanceof ReferralMailerError) {
        if (error.diagnostics) throw new ReferralMailerError(error.kind, { ...error.diagnostics, durationMs: Date.now() - startedAt });
        throw new ReferralMailerError(dataWasSubmitted ? 'delivery_unknown' : 'unavailable', {
          stage, durationMs: Date.now() - startedAt, acceptanceUncertain: dataWasSubmitted,
        });
      }
      const errorCode = getSafeNetworkCode(error);
      throw new ReferralMailerError(dataWasSubmitted ? 'delivery_unknown' : 'unavailable', {
        stage,
        failureCode: errorCode === 'ETIMEDOUT' ? 'timeout' : 'transport_error',
        durationMs: Date.now() - startedAt,
        acceptanceUncertain: dataWasSubmitted,
      });
    } finally {
      readline.close();
      socket.destroy();
    }
  }
}

export async function runWithSmtpDeadline<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    });
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForTls(socket: TLSSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
}

async function sendCommand(socket: TLSSocket, lines: AsyncIterator<string>, command: string, accepted: readonly number[], stage: ReferralSmtpFailureStage): Promise<SmtpReply> {
  await sendLine(socket, command);
  return expectReply(lines, accepted, stage);
}

async function sendRawCommand(socket: TLSSocket, lines: AsyncIterator<string>, command: string, stage: ReferralSmtpFailureStage): Promise<SmtpReply> {
  await sendLine(socket, command);
  return readReply(lines, stage);
}

async function sendLine(socket: TLSSocket, value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${value}\r\n`, 'utf8', error => error ? reject(error) : resolve());
  });
}

async function readReply(lines: AsyncIterator<string>, stage: ReferralSmtpFailureStage): Promise<SmtpReply> {
  const first = await lines.next();
  if (first.done) throw malformedResponse(stage);
  const match = /^(\d{3})([ -])/.exec(first.value);
  if (!match) throw malformedResponse(stage);
  const code = Number(match[1]);
  let continuation = match[2] === '-';
  while (continuation) {
    const next = await lines.next();
    if (next.done) throw malformedResponse(stage, code);
    const continuedMatch = /^(\d{3})([ -])/.exec(next.value);
    if (!continuedMatch || Number(continuedMatch[1]) !== code) throw malformedResponse(stage, code);
    continuation = continuedMatch[2] === '-';
  }
  return { code };
}

async function expectReply(lines: AsyncIterator<string>, accepted: readonly number[], stage: ReferralSmtpFailureStage): Promise<SmtpReply> {
  const reply = await readReply(lines, stage);
  if (!accepted.includes(reply.code)) throw smtpRejection(reply.code, stage);
  return reply;
}

function malformedResponse(stage: ReferralSmtpFailureStage, smtpCode?: number): ReferralMailerError {
  return new ReferralMailerError('unavailable', { stage, ...(smtpCode ? { smtpCode } : {}), failureCode: 'invalid_smtp_response', durationMs: 0, acceptanceUncertain: false });
}

function smtpRejection(smtpCode: number, stage: ReferralSmtpFailureStage): ReferralMailerError {
  return new ReferralMailerError('unavailable', { stage, smtpCode, failureCode: 'smtp_rejected', durationMs: 0, acceptanceUncertain: false });
}

function getSafeNetworkCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return undefined;
  return networkCodes.has(error.code) ? error.code : undefined;
}
