import nodemailer from 'nodemailer';
import { logger } from './logger.js';

const host = process.env.SMTP_HOST;

const transporter = host
  ? nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

if (transporter) logger.info('[mail] SMTP transport configured — notification emails will be sent for real');
else logger.info('[mail] SMTP_HOST not set — notification emails will be logged instead of sent');

export async function sendEmail(to: string, subject: string, text: string) {
  if (!transporter) {
    logger.info({ to, subject, text }, '[mail] (dev) would send email');
    return;
  }
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || 'Lastro <no-reply@lastro.demo>', to, subject, text });
  } catch (err) {
    logger.error({ err, to, subject }, '[mail] failed to send email');
  }
}
