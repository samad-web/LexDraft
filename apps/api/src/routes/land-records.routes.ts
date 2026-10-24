import { Router, type Request } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import * as land from '../services/tn-land-records.service';
import * as tracker from '../services/tn-land-tracker.service';
import { caseBelongsToFirm, firmIdForUser } from '../services/tenant';
import { documentsService } from '../services/documents.service';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { db } from '../db/client';
import { logger } from '../logger';

// =============================================================================
// /api/land-records - Tamil Nadu Land Records eServices (eservices.tn.gov.in).
// See services/tn-land-records.service.ts for how the site is driven and
// services/tn-land-tracker.service.ts for followed applications.
//
// Search flow (one live session per advocate):
//   POST   /sessions                       { service } -> districts (+ captcha)
//   POST   /sessions/:id/select            { field, value } -> next list
//   POST   /sessions/:id/subdivisions      { surveyNo, landType? } -> sub divisions
//   POST   /sessions/:id/otp               { mobile, fields } -> OTP sent
//   POST   /sessions/:id/otp/verify        { otp } -> result
//   POST   /sessions/:id/captcha           { captcha, fields } -> result | retry
//   POST   /sessions/:id/captcha/refresh
//   GET    /sessions/:id/pdf               -> application/pdf
//   POST   /sessions/:id/save              { caseId?, titleReportId? } -> filed
//   DELETE /sessions/:id
//
// Followed applications (patta transfer / F-Line):
//   GET/POST /applications, PATCH/DELETE /applications/:id
//
// Mounted behind requireAuth + requireActivePlan (routes/index.ts).
// =============================================================================

export const landRecordsRouter: Router = Router();

const SessionParam = z.object({ id: z.string().uuid() });
const ServiceEnum = z.enum(['patta', 'a-register', 'verify-patta', 'poramboke', 'fmb', 'order-copy', 'tslr-extract', 'tslr-sketch', 'app-status', 'fline']);
const AppId = z.string().trim().toUpperCase().regex(/^[0-9]{4}\/[A-Z0-9][0-9]{3}\/[0-9]{2}\/[0-9]{6}$/, 'Application Id looks like 0000/0000/00/000000');
const Fields = z.object({
  viewBy: z.enum(['pt', 'sur']).optional(),
  pattaNo: z.string().regex(/^[1-9][0-9]{0,6}$/, 'Enter a valid Patta Number').optional(),
  landType: z.enum(['R', 'N']).optional(),
  surveyNo: z.string().regex(/^[1-9][0-9A-Za-z/-]{0,5}$/, 'Enter a valid Survey Number').optional(),
  subdivNo: z.string().regex(/^[0-9A-Za-z\-/.']{0,10}$/, 'Enter a valid Sub Division Number').optional(),
  applicationId: AppId.optional(),
  refNo: z.string().trim().min(3).max(40).optional(),
}).default({});

function userId(req: Request): string {
  if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
  return req.user.id;
}

async function firmId(req: Request): Promise<string> {
  const f = await firmIdForUser(userId(req));
  if (!f) throw new BadRequestError('No firm attached to this account.');
  return f;
}

const sessionId = (req: Request): string => (req.params as unknown as { id: string }).id;

// The Land Records screen opened: get the site's home page ready in the
// background so the first service opens quickly. Returns at once.
landRecordsRouter.post('/prepare', (req, res, next) => {
  try {
    userId(req);
    land.prepareLandRecords();
    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

landRecordsRouter.post('/sessions', validate({ body: z.object({ service: ServiceEnum }) }), async (req, res, next) => {
  try {
    res.json(await land.startLandSession(userId(req), req.body.service));
  } catch (err) {
    next(err);
  }
});

landRecordsRouter.post(
  '/sessions/:id/select',
  validate({
    params: SessionParam,
    body: z.object({
      field: z.enum(['district', 'taluk', 'village', 'ward', 'block', 'survey', 'subdiv']),
      value: z.string().min(1).max(40).regex(/^[\w/ .-]+$/),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await land.selectLandField(sessionId(req), userId(req), req.body.field, req.body.value));
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.post(
  '/sessions/:id/subdivisions',
  validate({
    params: SessionParam,
    body: z.object({ surveyNo: z.string().regex(/^[1-9][0-9A-Za-z/-]{0,5}$/, 'Enter a valid Survey Number'), landType: z.enum(['R', 'N']).optional() }),
  }),
  async (req, res, next) => {
    try {
      res.json(await land.loadSubdivisions(sessionId(req), userId(req), req.body.surveyNo, req.body.landType));
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.post(
  '/sessions/:id/otp',
  validate({ params: SessionParam, body: z.object({ mobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'), fields: Fields }) }),
  async (req, res, next) => {
    try {
      res.json(await land.sendLandOtp(sessionId(req), userId(req), req.body.mobile, req.body.fields));
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.post(
  '/sessions/:id/otp/verify',
  validate({ params: SessionParam, body: z.object({ otp: z.string().regex(/^\d{6}$/, 'The OTP is 6 digits') }) }),
  async (req, res, next) => {
    try {
      res.json({ status: 'ok', result: await land.verifyLandOtp(sessionId(req), userId(req), req.body.otp) });
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.post(
  '/sessions/:id/captcha',
  validate({ params: SessionParam, body: z.object({ captcha: z.string().trim().min(1).max(12), fields: Fields }) }),
  async (req, res, next) => {
    try {
      const uid = userId(req);
      const out = await land.submitLandCaptcha(sessionId(req), uid, req.body.captcha, req.body.fields);
      // Application Status: remember what the advocate saw on a followed application.
      let recorded = false;
      if (out.status === 'ok' && req.body.fields.applicationId) {
        if (land.landSessionService(sessionId(req), uid) === 'app-status') recorded = await tracker.recordStatus(await firmId(req), req.body.fields.applicationId, out.result);
      }
      res.json({ ...out, ...(recorded ? { recorded } : {}) });
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.post('/sessions/:id/captcha/refresh', validate({ params: SessionParam }), async (req, res, next) => {
  try {
    res.json(await land.refreshLandCaptcha(sessionId(req), userId(req)));
  } catch (err) {
    next(err);
  }
});

landRecordsRouter.get('/sessions/:id/pdf', validate({ params: SessionParam }), async (req, res, next) => {
  try {
    const { pdf, filename } = land.landSessionPdf(sessionId(req), userId(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

/**
 * File the result into a matter's documents and/or a title report's search
 * trail (search type "revenue", with the filed document as the attachment).
 */
landRecordsRouter.post(
  '/sessions/:id/save',
  validate({
    params: SessionParam,
    body: z.object({ caseId: z.string().uuid().optional(), titleReportId: z.string().uuid().optional() })
      .refine((b) => b.caseId || b.titleReportId, 'Pick a matter or a title report'),
  }),
  async (req, res, next) => {
    try {
      const uid = userId(req);
      const fid = await firmId(req);
      const { pdf, filename, label, summary, result } = land.landSessionPdf(sessionId(req), uid);
      const sql = db();
      let caseLabel = '';
      if (req.body.caseId) {
        if (!(await caseBelongsToFirm(fid, req.body.caseId))) throw new NotFoundError('Matter not found');
        const [c] = sql ? await sql<Array<{ title: string }>>`select title from cases where id = ${req.body.caseId}::uuid` : [];
        caseLabel = c?.title ?? '';
      }
      const doc = await documentsService.create(
        {
          name: label,
          type: 'Land Record',
          case: caseLabel,
          updated: 'just now',
          fileName: filename,
          fileMime: 'application/pdf',
          fileSize: pdf.length,
          fileBase64: pdf.toString('base64'),
        },
        fid,
      );
      let searchId: string | null = null;
      if (req.body.titleReportId) {
        const { titleReportsService } = await import('../services/title-reports.service');
        const where = [summary.Village, summary.Taluk, summary.District].filter(Boolean).join(', ');
        const first = result.fields.slice(0, 6).map((f) => `${f.label}: ${f.value}`).join('; ');
        const search = await titleReportsService.addSearch(
          fid, req.body.titleReportId, uid, req.user?.email ?? '', (req.user as { role?: string } | undefined)?.role ?? null,
          {
            searchType: 'revenue',
            searchOffice: where ? `Taluk Office (eServices) - ${where}` : 'Tamil Nadu Land Records eServices',
            searchQuery: label,
            searchDate: new Date().toISOString().slice(0, 10),
            resultSummary: (first || result.text).slice(0, 1000),
            resultNegative: false,
            attachmentRef: doc.id ? `document:${doc.id}` : undefined,
          },
        );
        searchId = search.id;
      }
      logger.info({ docId: doc.id, searchId }, 'tn-land: result filed');
      res.status(201).json({ documentId: doc.id ?? null, titleReportSearchId: searchId, name: label });
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.delete('/sessions/:id', validate({ params: SessionParam }), async (req, res, next) => {
  try {
    await land.endLandSession(sessionId(req), userId(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Followed applications --------------------------------------------------

landRecordsRouter.get('/applications', validate({ query: z.object({ caseId: z.string().uuid().optional() }) }), async (req, res, next) => {
  try {
    res.json({ items: await tracker.listLandApplications(await firmId(req), (req.query as { caseId?: string }).caseId) });
  } catch (err) {
    next(err);
  }
});

landRecordsRouter.post(
  '/applications',
  validate({
    body: z.object({
      applicationId: AppId,
      kind: z.enum(['patta_transfer', 'fline', 'other']).default('patta_transfer'),
      caseId: z.string().uuid().nullish(),
      titleReportId: z.string().uuid().nullish(),
      note: z.string().max(500).nullish(),
    }),
  }),
  async (req, res, next) => {
    try {
      const fid = await firmId(req);
      if (req.body.caseId && !(await caseBelongsToFirm(fid, req.body.caseId))) throw new NotFoundError('Matter not found');
      res.status(201).json(await tracker.addLandApplication(fid, userId(req), req.body));
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.patch(
  '/applications/:id',
  validate({
    params: SessionParam,
    body: z.object({ closed: z.boolean().optional(), note: z.string().max(500).nullish(), caseId: z.string().uuid().nullish() }),
  }),
  async (req, res, next) => {
    try {
      const fid = await firmId(req);
      if (req.body.caseId && !(await caseBelongsToFirm(fid, req.body.caseId))) throw new NotFoundError('Matter not found');
      await tracker.updateLandApplication(fid, sessionId(req), req.body);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

landRecordsRouter.delete('/applications/:id', validate({ params: SessionParam }), async (req, res, next) => {
  try {
    await tracker.removeLandApplication(await firmId(req), sessionId(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
