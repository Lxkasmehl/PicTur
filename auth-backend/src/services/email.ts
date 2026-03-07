import nodemailer from 'nodemailer';

// Check if SMTP is configured
const isSmtpConfigured = () => {
  // Get raw values and trim whitespace
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();

  const hasHost = !!host && host.length > 0;
  const hasUser = !!user && user.length > 0;
  const hasPassword = !!password && password.length > 0;

  if (!hasHost || !hasUser || !hasPassword) {
    console.log('📧 SMTP Configuration: ❌ Missing required variables');
    console.log(`  SMTP_HOST: ${hasHost ? '✅ Set' : '❌ Missing'}`);
    console.log(`  SMTP_USER: ${hasUser ? '✅ Set' : '❌ Missing'}`);
    console.log(`  SMTP_PASSWORD: ${hasPassword ? '✅ Set' : '❌ Missing'}`);
    console.log('  → Emails will be logged to console (development mode)\n');
    return false;
  }

  console.log('📧 SMTP Configuration: ✅ All required variables are set');
  console.log(`  Host: ${host}`);
  console.log(`  Port: ${process.env.SMTP_PORT || '587'}`);
  console.log(`  User: ${user}\n`);
  return true;
};

// Create transporter (using environment variables or console logging for development)
const createTransporter = () => {
  // Get and trim values
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();

  if (!host || !user || !password) {
    // Return null to indicate we should log to console instead
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: host,
    port: parseInt(process.env.SMTP_PORT?.trim() || '587'),
    secure: process.env.SMTP_SECURE?.trim() === 'true',
    auth: {
      user: user,
      pass: password,
    },
  });

  return transporter;
};

// Lazy-load transporter - only create it when first needed
// This ensures environment variables are loaded before checking SMTP configuration
let transporter: ReturnType<typeof createTransporter> | null = null;

const getTransporter = () => {
  if (transporter === null) {
    transporter = createTransporter();
    // Log SMTP status on first access
    if (transporter) {
      console.log('📧 Email Service: SMTP configured and ready');
    } else {
      console.log(
        '📧 Email Service: Running in development mode (emails logged to console)'
      );
    }
  }
  return transporter;
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/** No-reply sender; use for all system emails */
const getFromEmail = () => process.env.SMTP_FROM?.trim() || 'noreply@turtleproject.com';

/** Shared HTML wrapper for consistent branding and footer */
function wrapEmailHtml(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">${title}</h2>
      ${bodyHtml}
      <p style="margin-top: 32px; color: #666; font-size: 14px;">
        Best regards,<br>The Turtle Project Team
      </p>
    </div>`;
}

/** Send mail via transporter or log to console in dev; log errors, don't throw by default */
async function sendMailSafe(
  to: string,
  subject: string,
  html: string,
  text: string,
  options?: { throwOnError?: boolean }
): Promise<void> {
  const fromEmail = getFromEmail();
  const mailOptions = { from: fromEmail, to, subject, html, text };
  const transporter = getTransporter();
  if (!transporter) {
    console.log('\n📧 ===== EMAIL (DEVELOPMENT MODE) =====');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log('\n--- Content ---');
    console.log(text);
    console.log('\n======================================\n');
    return;
  }
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}, Message ID: ${info.messageId}`);
  } catch (error: any) {
    console.error(`❌ Error sending email to ${to}:`, error.message);
    if (options?.throwOnError) throw error;
  }
}

export interface SendVerificationEmailParams {
  email: string;
  verificationUrl: string;
  expiresInHours?: number;
}

/** Send email verification link (registration). Uses no-reply sender and shared styling. */
export const sendVerificationEmail = async ({
  email,
  verificationUrl,
  expiresInHours = 24,
}: SendVerificationEmailParams): Promise<void> => {
  const bodyHtml = `
    <p>Hello,</p>
    <p>Please verify your email address by clicking the link below:</p>
    <p style="margin: 24px 0;">
      <a href="${verificationUrl}"
         style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
        Verify Email
      </a>
    </p>
    <p>Or copy and paste this link into your browser:</p>
    <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
    <p style="color: #888; font-size: 14px;">This link expires in ${expiresInHours} hours.</p>`;
  const text = `
Hello,

Please verify your email address by visiting this link:

${verificationUrl}

This link expires in ${expiresInHours} hours.

Best regards,
The Turtle Project Team`;
  await sendMailSafe(
    email,
    'Verify your email – Turtle Project',
    wrapEmailHtml('Verify your email', bodyHtml),
    text
  );
};

export interface SendAdminPromotionEmailParams {
  email: string;
  hasAccount: boolean;
  invitationToken?: string;
}

export const sendAdminPromotionEmail = async ({
  email,
  hasAccount,
  invitationToken,
}: SendAdminPromotionEmailParams): Promise<void> => {
  if (hasAccount) {
    const html = wrapEmailHtml(
      'Admin Promotion',
      `<p>Hello,</p>
      <p>You have been promoted to <strong>Admin</strong> in the Turtle Project.</p>
      <p>You now have access to admin features and can manage the system.</p>
      <p>You can log in with your existing account to access the admin panel.</p>`
    );
    const text = `Hello,\n\nYou have been promoted to Admin in the Turtle Project.\n\nYou now have access to admin features and can manage the system.\n\nYou can log in with your existing account to access the admin panel.\n\nBest regards,\nThe Turtle Project Team`;
    await sendMailSafe(email, 'You have been promoted to Admin', html, text);
  } else {
    // User doesn't have an account - send invitation with registration link
    if (!invitationToken) {
      throw new Error('Invitation token is required for new users');
    }

    const registrationUrl = `${FRONTEND_URL}/register?token=${invitationToken}`;
    const bodyHtml = `
      <p>Hello,</p>
      <p>You have been invited to join the Turtle Project as an <strong>Admin</strong>.</p>
      <p>To complete your registration and activate your admin account, please click the link below:</p>
      <p style="margin: 30px 0;">
        <a href="${registrationUrl}"
           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Complete Registration
        </a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="color: #666; word-break: break-all;">${registrationUrl}</p>
      <p>This invitation link will expire in 7 days.</p>`;
    const html = wrapEmailHtml('Admin Invitation', bodyHtml);
    const text = `Hello,\n\nYou have been invited to join the Turtle Project as an Admin.\n\nTo complete your registration, please visit:\n\n${registrationUrl}\n\nThis invitation link will expire in 7 days.\n\nBest regards,\nThe Turtle Project Team`;
    await sendMailSafe(email, 'You have been invited to join as Admin', html, text);
  }
};
