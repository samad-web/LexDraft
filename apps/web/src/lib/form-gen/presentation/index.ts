// Registry of authored presentation metadata, keyed by engine slug. A doc type without
// an entry falls back to fallbackPresentation() (humanised labels, one section).

import type { DocPresentation } from '../types';
import { regularBailPresentation } from './regular_bail';

export const PRESENTATIONS: Record<string, DocPresentation> = {
  regular_bail: regularBailPresentation,
};
