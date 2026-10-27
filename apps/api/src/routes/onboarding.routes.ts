import { Router } from 'express';
import { z } from 'zod';
import { onboardingService } from '../services/onboarding.service';

// Mounted behind requireAuth only (no requireActivePlan): a brand-new
// account sets up its plan here before anything else.
export const onboardingRouter: Router = Router();

const Complete = z.object({
  plan: z.enum(['free', 'solo', 'practice']),
  cycle: z.enum(['monthly', 'annual']).optional(),
  kind: z.enum(['advocate', 'student']).optional(),
  firm: z.string().max(200).optional(),
  enrolment: z.string().max(80).optional(),
  primaryCourt: z.string().max(160).optional(),
  practiceAreas: z.string().max(280).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(80).optional(),
  college: z.string().max(200).optional(),
  studyYear: z.string().max(40).optional(),
  teamSize: z.string().max(40).optional(),
  idDocumentType: z.enum(['bar_council_id', 'enrolment_certificate', 'student_id', 'aadhaar', 'pan']).optional(),
  idDocumentNumber: z.string().max(60).optional(),
  idDocumentKey: z.string().max(300).optional(),
  logoKey: z.string().max(300).optional(),
  gstin: z.string().max(20).optional(),
  addressLine: z.string().max(300).optional(),
  pincode: z.string().max(12).optional(),
}).strict();

const Upload = z.object({
  kind: z.enum(['logo', 'id']),
  contentType: z.string().max(80),
  // ~5 MB file as base64.
  dataBase64: z.string().min(1).max(7_200_000),
}).strict();

onboardingRouter.post('/upload', async (req, res, next) => {
  try {
    const body = Upload.parse(req.body);
    res.json(await onboardingService.upload(req.user!.id, body));
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post('/complete', async (req, res, next) => {
  try {
    const body = Complete.parse(req.body);
    res.json(await onboardingService.complete(req.user!.id, body));
  } catch (err) {
    next(err);
  }
});
