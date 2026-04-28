import { Router, type Request, type Response } from 'express';
import {
  addIssueToProjectV2,
  createGithubIssue,
  getGithubFeedbackConfig,
  resolveProjectStatusBacklogIds,
  setProjectItemSingleSelect,
} from '../services/githubFeedback.js';
import { createInMemoryIpWindowRateLimiter } from '../utils/inMemoryIpWindowRateLimit.js';
import { optionalAuthenticateToken, type AuthRequest } from '../middleware/auth.js';
import db from '../db/database.js';

const router = Router();

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = ['bug', 'feature', 'feedback'] as const;
type Category = (typeof CATEGORIES)[number];

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 8000;
const CONTACT_NAME_MAX = 200;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 8;

const { rateLimitOk } = createInMemoryIpWindowRateLimiter({
  windowMs: RATE_WINDOW_MS,
  maxHits: RATE_MAX,
});

function clientIp(req: Request): string {
  // req.ip respects Express trust proxy settings and ignores untrusted forwarded headers.
  const rawIp = req.ip || req.socket.remoteAddress;
  if (!rawIp) return 'unknown';
  return rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
}

function validateBody(body: unknown): {
  category: Category;
  title: string;
  description: string;
  contactEmail: string | null;
  contactName: string | null;
} | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const category = typeof o.category === 'string' ? o.category.trim().toLowerCase() : '';
  if (!CATEGORIES.includes(category as Category)) return null;

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  if (title.length < 3 || title.length > TITLE_MAX) return null;
  if (description.length < 10 || description.length > DESCRIPTION_MAX) return null;

  let contactEmail: string | null = null;
  if (o.contactEmail !== undefined && o.contactEmail !== null && o.contactEmail !== '') {
    const ce = typeof o.contactEmail === 'string' ? o.contactEmail.trim() : '';
    if (!SIMPLE_EMAIL.test(ce) || ce.length > 254) return null;
    contactEmail = ce;
  }

  let contactName: string | null = null;
  if (o.contactName !== undefined && o.contactName !== null && o.contactName !== '') {
    const cn = typeof o.contactName === 'string' ? o.contactName.trim() : '';
    if (cn.length < 1 || cn.length > CONTACT_NAME_MAX) return null;
    if (/[\r\n\t]/.test(cn)) return null;
    contactName = cn;
  }

  return { category: category as Category, title, description, contactEmail, contactName };
}

function categoryLabel(c: Category): string {
  if (c === 'bug') return 'Bug';
  if (c === 'feature') return 'Feature request';
  return 'General feedback';
}

/** GitHub default-style labels; must exist on the repo (or add your own and map via future env). */
function categoryGithubLabel(c: Category): string {
  if (c === 'bug') return 'bug';
  if (c === 'feature') return 'enhancement';
  return 'question';
}

function mergeIssueLabels(base: string[], category: Category): string[] {
  return [...new Set([...base, categoryGithubLabel(category)])];
}

function buildIssueBody(params: {
  category: Category;
  description: string;
  contactEmail: string | null;
  contactName: string | null;
  submitterSource: 'account' | 'anonymous';
  userAgent: string | null;
}): string {
  const lines: string[] = [
    `**Type:** ${categoryLabel(params.category)}`,
    '',
    '### Description',
    '',
    params.description,
    '',
  ];
  if (params.submitterSource === 'account') {
    lines.push('### Submitter (signed-in PicTur account)', '');
    if (params.contactName) lines.push(`- **Name:** ${params.contactName}`);
    if (params.contactEmail) lines.push(`- **Email:** ${params.contactEmail}`);
    if (!params.contactName && !params.contactEmail) lines.push('_(no name or email on file)_');
    lines.push('');
  } else if (params.contactName || params.contactEmail) {
    lines.push('### Contact (optional)', '');
    if (params.contactName) lines.push(`- **Name:** ${params.contactName}`);
    if (params.contactEmail) lines.push(`- **Email:** ${params.contactEmail}`);
    lines.push('');
  }
  lines.push('---', '', '_Submitted via PicTur feedback form._');
  if (params.userAgent) {
    const ua = params.userAgent.slice(0, 800).replace(/```/g, "'''");
    lines.push('', '### Client (auto)', '', '```', ua, '```');
  }
  return lines.join('\n');
}

/** Public: submit app feedback; creates a GitHub issue when GITHUB_FEEDBACK_* is configured. */
router.post('/feedback', optionalAuthenticateToken, async (req: Request, res: Response) => {
  const cfg = getGithubFeedbackConfig();
  if (!cfg) {
    return res.status(503).json({
      error: 'Feedback submission is not configured on this server.',
      code: 'FEEDBACK_DISABLED',
    });
  }

  const ip = clientIp(req);
  if (!rateLimitOk(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  const parsed = validateBody(req.body);
  if (!parsed) {
    return res.status(400).json({
      error:
        'Invalid category, title, or description, or optional contact fields (name and/or email).',
    });
  }

  const authUser = (req as AuthRequest).user;
  let contactEmail: string | null;
  let contactName: string | null;
  let submitterSource: 'account' | 'anonymous';

  if (authUser) {
    const row = db
      .prepare('SELECT email, name FROM users WHERE id = ?')
      .get(authUser.id) as { email: string; name: string | null } | undefined;
    if (!row) {
      return res.status(403).json({ error: 'Account not found.' });
    }
    contactEmail = row.email;
    const trimmedName = typeof row.name === 'string' ? row.name.trim() : '';
    contactName = trimmedName.length > 0 ? trimmedName : null;
    submitterSource = 'account';
  } else {
    contactEmail = parsed.contactEmail;
    contactName = parsed.contactName;
    submitterSource = 'anonymous';
  }

  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const body = buildIssueBody({
    category: parsed.category,
    description: parsed.description,
    contactEmail,
    contactName,
    submitterSource,
    userAgent: ua,
  });

  const issueTitle = `[PicTur] ${parsed.title}`;

  let issue: Awaited<ReturnType<typeof createGithubIssue>>;
  try {
    issue = await createGithubIssue({
      token: cfg.token,
      owner: cfg.owner,
      repo: cfg.repo,
      title: issueTitle,
      body,
      labels: mergeIssueLabels(cfg.labels, parsed.category),
    });
  } catch (e: unknown) {
    const err = e as Error & { status?: number; details?: unknown };
    console.error('GitHub feedback issue error:', err.message, err.status);
    if (err.status === 403 || err.status === 401) {
      return res.status(503).json({
        error: 'Feedback service is misconfigured. Please try again later.',
        code: 'FEEDBACK_CONFIG',
      });
    }
    if (err.status === 404) {
      return res.status(503).json({
        error: 'Feedback service is misconfigured (repository not found).',
        code: 'FEEDBACK_CONFIG',
      });
    }
    if (err.status === 422) {
      console.error('GitHub feedback validation (e.g. missing labels):', err.details);
      return res.status(502).json({
        error:
          'Issue tracker rejected the request. Ensure labels exist: those in GITHUB_FEEDBACK_LABELS plus bug, enhancement, and question (from the form category).',
        code: 'GITHUB_VALIDATION',
      });
    }
    return res.status(502).json({
      error: 'Could not reach GitHub. Please try again later.',
      code: 'GITHUB_ERROR',
    });
  }

  let projectAdded = false;
  if (cfg.projectNodeId) {
    try {
      const { projectItemId } = await addIssueToProjectV2({
        token: cfg.token,
        projectNodeId: cfg.projectNodeId,
        contentNodeId: issue.node_id,
      });
      projectAdded = true;

      try {
        const statusIds = await resolveProjectStatusBacklogIds({
          token: cfg.token,
          projectNodeId: cfg.projectNodeId,
          statusFieldName: cfg.projectStatusFieldName,
          backlogOptionName: cfg.projectBacklogOptionName,
        });
        if (statusIds) {
          await setProjectItemSingleSelect({
            token: cfg.token,
            projectNodeId: cfg.projectNodeId,
            projectItemId,
            fieldId: statusIds.fieldId,
            singleSelectOptionId: statusIds.optionId,
          });
        } else {
          console.warn(
            'PicTur feedback: Issue was linked to the project but Status was not updated. Check server warnings above; set GITHUB_FEEDBACK_PROJECT_STATUS_FIELD / GITHUB_FEEDBACK_PROJECT_BACKLOG_OPTION in auth-backend/.env (comma-separated fallbacks allowed, e.g. Backlog,Todo).',
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('GitHub project status (Backlog) not set; item may use default column:', msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        'GitHub project add failed (issue still created). Check token scopes: classic PAT needs `repo` + `project`; fine-grained needs Issues + Projects on this repo/org:',
        msg,
      );
    }
  }

  return res.status(201).json({
    ok: true,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    projectAdded,
  });
});

export default router;
