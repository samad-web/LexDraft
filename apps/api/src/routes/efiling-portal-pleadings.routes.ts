import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import { requireFeature } from '../services/permissions.service';
import * as pl from '../services/efiling-portal-pleadings.service';

// =============================================================================
// /api/efiling/live/session/:sessionId/pleadings/... and .../oath/...
//
// Pleadings (Pleading Upload, Pleading Index, eSign, Draft / Completed
// Pleadings submit) and Video Recording on the REAL portal, over the
// advocate's own logged-in session - see efiling-portal-pleadings.service.ts.
// Portal trouble comes back as 409 / 410 / 502 (EcourtsHttpError), never 401.
// Deleting or submitting needs { confirmed: true }. Files travel as base64
// JSON (the API takes JSON bodies up to 16 MB).
// =============================================================================

export const efilingPortalPleadingsRouter: Router = Router();

const SessionParam = z.object({ sessionId: z.string().uuid() });

// Values the portal's own JS puts into its form bodies unescaped (numbers,
// CNRs, GRNs): never "&", "=" or spaces, so nothing else can ride along.
const token = z.string().trim().min(1).max(200).regex(/^[^&=\s]+$/, 'Not a portal value');
const optToken = z.string().trim().max(200).regex(/^[^&=\s]*$/, 'Not a portal value');
const CaseRef = z.object({ source: z.enum(['1', '3']), value: token });
const yes = z.literal(true);

type Handler = (req: Request, userId: string, sessionId: string) => Promise<unknown>;

function handle(fn: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      res.json(await fn(req, req.user.id, String(req.params['sessionId'] ?? '')));
    } catch (err) {
      next(err);
    }
  };
}

function sendFile(fn: (req: Request, userId: string, sessionId: string) => Promise<pl.PortalFileBody>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const f = await fn(req, req.user.id, String(req.params['sessionId'] ?? ''));
      const safe = f.name.replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'document';
      res.setHeader('Content-Type', f.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(f.body);
    } catch (err) {
      next(err);
    }
  };
}

const base = '/live/session/:sessionId';
const edit = requireFeature('matter.create');

// ---- Pleadings > Pleading Upload --------------------------------------------------

efilingPortalPleadingsRouter.get(`${base}/pleadings`, validate({ params: SessionParam }),
  handle((_req, u, s) => pl.readPleadingScreen(s, u)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/case`, validate({ params: SessionParam, body: CaseRef }),
  handle((req, u, s) => pl.selectPleadingCase(s, u, req.body)));

// Existing case: the advocate's cases matching what they typed (custom_component/get_my_cases).
efilingPortalPleadingsRouter.post(`${base}/pleadings/cases/search`, validate({ params: SessionParam, body: z.object({ term: z.string().trim().min(3).max(100).regex(/^[^&=#]+$/, 'Not a portal value') }) }),
  handle(async (req, u, s) => ({ items: await pl.searchPleadingCases(s, u, req.body) })));

efilingPortalPleadingsRouter.post(`${base}/pleadings/add-file`, edit,
  validate({
    params: SessionParam,
    body: CaseRef.extend({
      title: z.string().max(100),
      docType: optToken.nullable().optional(),
      file: z.object({ name: z.string().min(1).max(200), base64: z.string().min(1).max(15_000_000) }),
    }),
  }),
  handle((req, u, s) => pl.addPleadingFile(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/submit`, edit,
  validate({ params: SessionParam, body: CaseRef.extend({ parties: z.array(z.string().max(500)).max(200), confirmed: yes }) }),
  handle((req, u, s) => pl.submitPleadingFiles(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/delete`, edit,
  validate({ params: SessionParam, body: CaseRef.extend({ pleadingNumber: token, confirmed: yes }) }),
  handle((req, u, s) => pl.deletePleading(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/merge`, edit,
  validate({ params: SessionParam, body: CaseRef.extend({ pleadingNumbers: z.array(token).min(2).max(100), title: z.string().trim().min(1).max(100), confirmed: yes }) }),
  handle((req, u, s) => pl.mergePleadings(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/file`,
  validate({ params: SessionParam, body: CaseRef.extend({ pleadingNumber: token }) }),
  sendFile((req, u, s) => pl.viewPleadingFile(s, u, req.body)));

// ---- Pleading Index tab -----------------------------------------------------------

efilingPortalPleadingsRouter.post(`${base}/pleadings/index`,
  validate({ params: SessionParam, body: CaseRef.extend({ all: z.boolean().optional() }) }),
  handle((req, u, s) => pl.readPleadingIndex(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/index/add`, edit,
  validate({
    params: SessionParam,
    body: CaseRef.extend({ pleadingNumber: token, title: z.string().max(200), fromPage: z.number().int().min(-1).max(100_000), toPage: z.number().int().min(-1).max(100_000) }),
  }),
  handle((req, u, s) => pl.addPleadingIndex(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/index/delete`, edit,
  validate({ params: SessionParam, body: CaseRef.extend({ pleadingNumber: token, srNo: token, confirmed: yes }) }),
  handle((req, u, s) => pl.deletePleadingIndex(s, u, req.body)));

// ---- eSign tab ------------------------------------------------------------------

efilingPortalPleadingsRouter.post(`${base}/pleadings/esign`,
  validate({ params: SessionParam, body: CaseRef.extend({ all: z.boolean().optional() }) }),
  handle((req, u, s) => pl.readPleadingEsign(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/esign/auth`,
  validate({ params: SessionParam, body: CaseRef.extend({ pleadingNumber: token, pdeNo: token, dirMonth: optToken.optional() }) }),
  handle((req, u, s) => pl.readPleadingAuth(s, u, req.body)));

const Signer = z.object({ value: z.string().min(1).max(300).regex(/^[^&=#]+$/), sign: z.string().max(20).regex(/^[^&=#]*$/) });
efilingPortalPleadingsRouter.post(`${base}/pleadings/esign/auth/save`, edit,
  validate({ params: SessionParam, body: CaseRef.extend({ pleadingNumber: token, advocates: z.array(Signer).max(50), clients: z.array(Signer).max(200) }) }),
  handle((req, u, s) => pl.savePleadingAuth(s, u, req.body)));

const callArg = z.string().max(500);
efilingPortalPleadingsRouter.post(`${base}/pleadings/esign/start`, edit,
  validate({
    params: SessionParam,
    body: CaseRef.extend({ pleadingNumber: token, signCounter: callArg, pageCreated: callArg, userName: callArg, accepted: yes }),
  }),
  handle((req, u, s) => pl.startPleadingEsign(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/esign/step`, edit,
  validate({ params: SessionParam, body: z.object({ values: z.record(z.string().max(100), z.string().max(500)), press: z.string().min(1).max(100) }) }),
  handle((req, u, s) => pl.stepPleadingEsign(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/esign/otp/send`, edit,
  validate({ params: SessionParam, body: CaseRef.extend({ args: z.array(callArg).min(1).max(8), mobile: z.string().regex(/^\d{0,10}$/) }) }),
  handle((req, u, s) => pl.sendPleadingOtp(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/esign/otp/verify`, edit,
  validate({ params: SessionParam, body: z.object({ otp: z.string().regex(/^[\d.]{0,10}$/) }) }),
  handle((req, u, s) => pl.verifyPleadingOtp(s, u, req.body)));

// ---- Dashboard: Draft Pleadings (submit with GRN) / Completed Pleadings (re-submit) ----

efilingPortalPleadingsRouter.get(`${base}/pleadings/drafts/:kind`,
  validate({ params: SessionParam.extend({ kind: z.enum(['draft', 'completed']) }) }),
  handle((req, u, s) => pl.readDraftPleadings(s, u, req.params['kind'] as 'draft' | 'completed')));

efilingPortalPleadingsRouter.post(`${base}/pleadings/drafts/submit`, edit,
  validate({
    params: SessionParam,
    body: z.object({ uniqueId: token, typeOfCase: token, efilingNumber: token, grn: optToken, withoutCourtFee: z.boolean().optional(), confirmed: yes }),
  }),
  handle((req, u, s) => pl.submitDraftPleading(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/pleadings/drafts/resubmit`, edit,
  validate({ params: SessionParam, body: z.object({ efilingNumber: token, confirmed: yes }) }),
  handle((req, u, s) => pl.resubmitPleading(s, u, req.body)));

// ---- Pleadings > Use Template -------------------------------------------------------

efilingPortalPleadingsRouter.get(`${base}/templates`, validate({ params: SessionParam }),
  handle((_req, u, s) => pl.readTemplateScreen(s, u)));

efilingPortalPleadingsRouter.post(`${base}/templates/case`, validate({ params: SessionParam, body: CaseRef }),
  handle((req, u, s) => pl.selectTemplateCase(s, u, req.body)));

// The generated template (.doc), or the portal's messages as JSON when it made none.
efilingPortalPleadingsRouter.post(`${base}/templates/generate`,
  validate({ params: SessionParam, body: CaseRef.extend({ typePleading: token, parties: z.array(z.string().max(500)).max(200) }) }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const r = await pl.generateTemplate(String(req.params['sessionId'] ?? ''), req.user.id, req.body);
      if (!r.file) { res.status(422).json({ error: r.portal.join(' ') || 'The portal did not make the template.', portal: r.portal }); return; }
      const safe = r.file.name.replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'template.doc';
      res.setHeader('Content-Type', r.file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(r.file.body);
    } catch (err) {
      next(err);
    }
  });

// ---- Pleadings > Video Recording (oath) ---------------------------------------------

const OathCase = z.object({ searchCase: optToken, pdeNo: token });

efilingPortalPleadingsRouter.get(`${base}/oath`, validate({ params: SessionParam }),
  handle((_req, u, s) => pl.readOathScreen(s, u)));

efilingPortalPleadingsRouter.post(`${base}/oath/case`, validate({ params: SessionParam, body: OathCase }),
  handle((req, u, s) => pl.selectOathCase(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/oath/document`, validate({ params: SessionParam, body: OathCase.extend({ document: token }) }),
  handle((req, u, s) => pl.oathDocumentDetails(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/oath/upload`, edit,
  validate({
    params: SessionParam,
    body: OathCase.extend({
      document: token,
      client: z.string().min(1).max(500),
      video: z.object({ base64: z.string().min(1).max(15_000_000), mimeType: z.string().regex(/^video\/[\w.+-]+(;[\w=,.\s-]*)?$/).max(100) }),
      confirmed: yes,
    }),
  }),
  handle((req, u, s) => pl.uploadOathVideo(s, u, req.body)));

efilingPortalPleadingsRouter.post(`${base}/oath/play`,
  validate({ params: SessionParam, body: z.object({ filepath: z.string().min(1).max(500).regex(/^[^&=\s]+$/) }) }),
  sendFile((req, u, s) => pl.playOathVideo(s, u, req.body)));
