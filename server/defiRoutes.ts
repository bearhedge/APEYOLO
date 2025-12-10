/**
 * DeFi API Routes
 *
 * Endpoints for generating attestation data and verifying hashes.
 */

import { Router, Request, Response } from 'express';
import { generateAttestationData, getRawDetails } from './services/attestationService';
import type { AttestationPeriod } from '@shared/types/defi';

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

export default router;
