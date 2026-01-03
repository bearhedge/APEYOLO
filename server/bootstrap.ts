// Bootstrap file - loads dotenv BEFORE any other imports
import 'dotenv/config';

console.log('[BOOTSTRAP] GOOGLE_CLIENT_ID env:', process.env.GOOGLE_CLIENT_ID ? 'SET (' + process.env.GOOGLE_CLIENT_ID.substring(0, 15) + '...)' : 'NOT SET');

// Now import and run the main server
import './index.js';
