/**
 * Research API Routes
 *
 * Endpoints for the DD Research Terminal.
 */

import { Router } from 'express';
import { assembleResearchContext, generateNarrative } from '../services/narrativeService';

const router = Router();

// ============================================
// GET /api/research/context
// Returns current market context (no AI generation)
// ============================================

router.get('/context', async (req, res) => {
  try {
    const context = await assembleResearchContext();
    res.json({ ok: true, context });
  } catch (error: any) {
    console.error('[ResearchAPI] Context error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// GET /api/research/narrative
// Generate AI-powered market narrative
// ============================================

router.get('/narrative', async (req, res) => {
  try {
    const result = await generateNarrative();
    res.json({
      ok: true,
      narrative: result.narrative,
      context: result.context,
      generatedAt: result.generatedAt,
    });
  } catch (error: any) {
    console.error('[ResearchAPI] Narrative error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
