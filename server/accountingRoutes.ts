/**
 * Accounting API Routes
 *
 * Endpoints for:
 * - Ledger entry management
 * - Daily reconciliation snapshots
 * - Reconciliation issue tracking
 * - Attestation management
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './auth';
import {
  createLedgerEntry,
  getLedgerWithRunningBalance,
  getDailyPnl,
  getUnreconciledEntries,
} from './services/accountingService';
import {
  createDailySnapshot,
  getSnapshots,
  getSnapshotByDate,
  resolveIssue,
  getOpenIssues,
  isPeriodReconciled,
  manuallyReconcileSnapshot,
  type IBKRAccountState,
} from './services/reconciliationService';
import {
  prepareAttestation,
  submitAttestation,
  getAttestations,
  getAttestationById,
  verifyAttestation,
} from './services/accountingAttestationService';

const router = Router();

// ==================== LEDGER ROUTES ====================

/**
 * GET /api/accounting/ledger
 * Get ledger entries with running balance for a date range
 */
router.get('/ledger', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required (YYYY-MM-DD format)',
      });
    }

    const entries = await getLedgerWithRunningBalance(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({ success: true, data: entries });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching ledger:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounting/ledger
 * Create a manual ledger entry (adjustments, deposits, withdrawals)
 */
router.post('/ledger', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { effectiveDate, entryType, amount, description, metadata } = req.body;

    if (!effectiveDate || !entryType || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'effectiveDate, entryType, and amount are required',
      });
    }

    const entry = await createLedgerEntry({
      userId,
      effectiveDate,
      entryType,
      amount: amount.toString(),
      description,
      metadata,
    });

    res.json({ success: true, data: entry });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error creating ledger entry:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/daily-pnl
 * Get P&L breakdown for a specific date
 */
router.get('/daily-pnl', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD format)' });
    }

    const pnl = await getDailyPnl(userId, date as string);
    res.json({ success: true, data: pnl });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching daily P&L:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/unreconciled
 * Get unreconciled ledger entries
 */
router.get('/unreconciled', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const entries = await getUnreconciledEntries(userId);
    res.json({ success: true, data: entries });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching unreconciled entries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== RECONCILIATION ROUTES ====================

/**
 * GET /api/accounting/snapshots
 * Get daily snapshots for a date range
 */
router.get('/snapshots', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required (YYYY-MM-DD format)',
      });
    }

    const snapshots = await getSnapshots(userId, startDate as string, endDate as string);
    res.json({ success: true, data: snapshots });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/snapshot/:date
 * Get a single snapshot by date
 */
router.get('/snapshot/:date', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { date } = req.params;
    const snapshot = await getSnapshotByDate(userId, date);

    if (!snapshot) {
      return res.status(404).json({ success: false, error: 'Snapshot not found for this date' });
    }

    res.json({ success: true, data: snapshot });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching snapshot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounting/snapshot
 * Trigger reconciliation snapshot for a date with IBKR state
 */
router.post('/snapshot', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { date, ibkrState } = req.body;

    if (!date || !ibkrState) {
      return res.status(400).json({
        success: false,
        error: 'date and ibkrState are required',
      });
    }

    // Validate ibkrState has required fields
    const requiredFields = ['cash', 'positionsValue', 'nav', 'realizedPnl', 'unrealizedPnl'];
    for (const field of requiredFields) {
      if (ibkrState[field] === undefined) {
        return res.status(400).json({
          success: false,
          error: `ibkrState.${field} is required`,
        });
      }
    }

    const validatedIbkrState: IBKRAccountState = {
      cash: Number(ibkrState.cash),
      positionsValue: Number(ibkrState.positionsValue),
      nav: Number(ibkrState.nav),
      realizedPnl: Number(ibkrState.realizedPnl),
      unrealizedPnl: Number(ibkrState.unrealizedPnl),
      rawResponse: ibkrState.rawResponse || {},
    };

    const snapshot = await createDailySnapshot(userId, date, validatedIbkrState);
    res.json({ success: true, data: snapshot });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error creating snapshot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounting/snapshot/:id/reconcile
 * Manually reconcile a snapshot
 */
router.post('/snapshot/:id/reconcile', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { id } = req.params;
    await manuallyReconcileSnapshot(id, userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error reconciling snapshot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/issues
 * Get open reconciliation issues
 */
router.get('/issues', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const issues = await getOpenIssues(userId);
    res.json({ success: true, data: issues });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching issues:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounting/issue/:id/resolve
 * Resolve a reconciliation issue
 */
router.post('/issue/:id/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolutionType, resolutionNotes } = req.body;

    if (!resolutionType) {
      return res.status(400).json({
        success: false,
        error: 'resolutionType is required',
      });
    }

    await resolveIssue(id, resolutionType, resolutionNotes || '');
    res.json({ success: true });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error resolving issue:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/reconciliation-status
 * Check if a period is fully reconciled
 */
router.get('/reconciliation-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required (YYYY-MM-DD format)',
      });
    }

    const isReconciled = await isPeriodReconciled(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({ success: true, data: { isReconciled } });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error checking reconciliation status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ATTESTATION ROUTES ====================

/**
 * GET /api/accounting/attestations
 * Get attestation history
 */
router.get('/attestations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const attestations = await getAttestations(userId);
    res.json({ success: true, data: attestations });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching attestations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/attestation/:id
 * Get a single attestation by ID
 */
router.get('/attestation/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const attestation = await getAttestationById(id);

    if (!attestation) {
      return res.status(404).json({ success: false, error: 'Attestation not found' });
    }

    res.json({ success: true, data: attestation });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error fetching attestation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounting/attestation/prepare
 * Prepare attestation for a period
 */
router.post('/attestation/prepare', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const { startDate, endDate, periodLabel } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required (YYYY-MM-DD format)',
      });
    }

    const attestation = await prepareAttestation(userId, startDate, endDate, periodLabel);
    res.json({ success: true, data: attestation });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error preparing attestation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounting/attestation/:id/submit
 * Submit prepared attestation to Solana
 */
router.post('/attestation/:id/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await submitAttestation(id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error submitting attestation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/accounting/attestation/:id/verify
 * Verify an attestation hash matches current data
 */
router.get('/attestation/:id/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await verifyAttestation(id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[AccountingRoutes] Error verifying attestation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
