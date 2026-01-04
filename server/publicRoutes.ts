import { Router } from 'express';

const router = Router();

// Public API endpoints for bearhedge.com (no auth required)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
