/**
 * DeFi API Routes
 *
 * Endpoints for:
 * - Attestation data generation and verification
 * - Trading mandate management and enforcement
 */

import { Router, Request, Response } from 'express';
import { generateAttestationData, getRawDetails } from './services/attestationService';
import {
  createMandate,
  getActiveMandate,
  getUserMandates,
  deactivateMandate,
  getMandateViolations,
  getUserViolations,
  getMonthlyViolationCount,
  commitMandateToSolana,
  recordViolationOnSolana,
} from './services/mandateService';
import { requireAuth } from './auth';
import type { AttestationPeriod } from '@shared/types/defi';
import type { CreateMandateRequest } from '@shared/types/mandate';

const router = Router();

/**
 * POST /api/defi/generate-attestation
 *
 * Generate attestation data for a period.
 * Returns NAV, P&L, trade metrics, and details hash.
 */
router.post('/generate-attestation', async (req: Request, res: Response) => {
  try {
    const { periodType, customStart, customEnd } = req.body as {
      periodType: AttestationPeriod;
      customStart?: string;
      customEnd?: string;
    };

    if (!periodType) {
      return res.status(400).json({
        success: false,
        error: 'periodType is required',
      });
    }

    // Validate period type
    const validPeriods: AttestationPeriod[] = ['last_week', 'last_month', 'mtd', 'custom'];
    if (!validPeriods.includes(periodType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid periodType. Must be one of: ${validPeriods.join(', ')}`,
      });
    }

    // Validate custom dates if custom period
    if (periodType === 'custom') {
      if (!customStart || !customEnd) {
        return res.status(400).json({
          success: false,
          error: 'customStart and customEnd are required for custom period',
        });
      }

      // Validate date format
      const startDate = new Date(customStart);
      const endDate = new Date(customEnd);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)',
        });
      }

      if (startDate >= endDate) {
        return res.status(400).json({
          success: false,
          error: 'customStart must be before customEnd',
        });
      }
    }

    const data = await generateAttestationData(periodType, customStart, customEnd);

    res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error generating attestation:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate attestation data',
    });
  }
});

/**
 * GET /api/defi/raw-details/:hash
 *
 * Fetch raw details for verification of a hash.
 */
router.get('/raw-details/:hash', async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;

    if (!hash || !hash.startsWith('0x')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid hash format. Must start with 0x',
      });
    }

    const details = await getRawDetails(hash);

    if (!details) {
      return res.status(404).json({
        success: false,
        error: 'Raw details not found for this hash',
      });
    }

    res.json({
      success: true,
      data: details,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error fetching raw details:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch raw details',
    });
  }
});

/**
 * GET /api/defi/periods
 *
 * Get available period options with their date ranges.
 */
router.get('/periods', async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    // Calculate period dates
    const dayOfWeek = now.getDay();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - dayOfWeek);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);

    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdEnd = new Date(now);
    mtdEnd.setDate(mtdEnd.getDate() - 1);

    res.json({
      success: true,
      periods: [
        {
          type: 'last_week',
          label: 'Last Week',
          start: lastMonday.toISOString().split('T')[0],
          end: lastSunday.toISOString().split('T')[0],
        },
        {
          type: 'last_month',
          label: 'Last Month',
          start: lastMonthStart.toISOString().split('T')[0],
          end: lastMonthEnd.toISOString().split('T')[0],
        },
        {
          type: 'mtd',
          label: 'Month to Date',
          start: mtdStart.toISOString().split('T')[0],
          end: mtdEnd.toISOString().split('T')[0],
        },
        {
          type: 'custom',
          label: 'Custom Range',
          start: null,
          end: null,
        },
      ],
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting periods:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get periods',
    });
  }
});

// ============================================
// Trading Mandate Endpoints
// ============================================

/**
 * POST /api/defi/mandate
 *
 * Create a new trading mandate for the authenticated user.
 * Mandates are locked forever once created - cannot be modified.
 */
router.post('/mandate', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const request = req.body as CreateMandateRequest;

    // Validate required fields
    if (!request.allowedSymbols || !Array.isArray(request.allowedSymbols) || request.allowedSymbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'allowedSymbols is required and must be a non-empty array',
      });
    }

    if (!request.strategyType || !['SELL', 'BUY'].includes(request.strategyType)) {
      return res.status(400).json({
        success: false,
        error: 'strategyType is required and must be "SELL" or "BUY"',
      });
    }

    if (typeof request.minDelta !== 'number' || typeof request.maxDelta !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'minDelta and maxDelta are required numbers',
      });
    }

    if (request.minDelta < 0 || request.maxDelta > 1 || request.minDelta > request.maxDelta) {
      return res.status(400).json({
        success: false,
        error: 'Delta range must be between 0-1 with minDelta <= maxDelta',
      });
    }

    if (typeof request.maxDailyLossPercent !== 'number' || request.maxDailyLossPercent <= 0) {
      return res.status(400).json({
        success: false,
        error: 'maxDailyLossPercent is required and must be positive',
      });
    }

    if (typeof request.noOvernightPositions !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'noOvernightPositions is required and must be a boolean',
      });
    }

    const mandate = await createMandate(userId, request);

    res.json({
      success: true,
      mandate,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error creating mandate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create mandate',
    });
  }
});

/**
 * GET /api/defi/mandate
 *
 * Get the active mandate for the authenticated user.
 */
router.get('/mandate', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandate = await getActiveMandate(userId);

    if (!mandate) {
      return res.json({
        success: true,
        mandate: null,
        violations: [],
        violationCount: 0,
        monthlyViolations: 0,
      });
    }

    // Get violations and counts
    const violations = await getMandateViolations(mandate.id, 10);
    const allViolations = await getMandateViolations(mandate.id, 1000);
    const monthlyViolations = await getMonthlyViolationCount(mandate.id);

    res.json({
      success: true,
      mandate,
      violations,
      violationCount: allViolations.length,
      monthlyViolations,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting mandate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get mandate',
    });
  }
});

/**
 * GET /api/defi/mandate/history
 *
 * Get all mandates (including inactive) for the authenticated user.
 */
router.get('/mandate/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandates = await getUserMandates(userId);

    res.json({
      success: true,
      mandates,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting mandate history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get mandate history',
    });
  }
});

/**
 * GET /api/defi/mandate/violations
 *
 * Get all violations for the authenticated user.
 */
router.get('/mandate/violations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 100;
    const violations = await getUserViolations(userId, limit);

    res.json({
      success: true,
      violations,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error getting violations:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get violations',
    });
  }
});

/**
 * DELETE /api/defi/mandate/:id
 *
 * Deactivate a mandate. Mandates cannot be deleted (kept for audit trail).
 */
router.delete('/mandate/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const mandateId = req.params.id;

    if (!mandateId) {
      return res.status(400).json({
        success: false,
        error: 'Mandate ID is required',
      });
    }

    await deactivateMandate(mandateId, userId);

    res.json({
      success: true,
      message: 'Mandate deactivated successfully',
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error deactivating mandate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to deactivate mandate',
    });
  }
});

/**
 * POST /api/defi/mandate/:id/commit
 *
 * Commit a mandate hash to Solana for on-chain proof.
 */
router.post('/mandate/:id/commit', requireAuth, async (req: Request, res: Response) => {
  try {
    const mandateId = req.params.id;

    if (!mandateId) {
      return res.status(400).json({
        success: false,
        error: 'Mandate ID is required',
      });
    }

    const result = await commitMandateToSolana(mandateId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error committing mandate to Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to commit mandate to Solana',
    });
  }
});

/**
 * POST /api/defi/violation/:id/record
 *
 * Record a violation on Solana for on-chain proof.
 */
router.post('/violation/:id/record', requireAuth, async (req: Request, res: Response) => {
  try {
    const violationId = req.params.id;

    if (!violationId) {
      return res.status(400).json({
        success: false,
        error: 'Violation ID is required',
      });
    }

    const result = await recordViolationOnSolana(violationId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[DefiRoutes] Error recording violation on Solana:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record violation on Solana',
    });
  }
});

export default router;
