/**
 * Playwright test to verify SSE streaming is working
 */

import { chromium, Browser } from 'playwright';
import * as fs from 'fs';

const BASE_URL = 'https://apeyolo.com';

async function testSSEStreaming() {
  console.log('🚀 Starting SSE Streaming Test...\n');

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: false }); // Non-headless to see what's happening
    const context = await browser.newContext();
    const page = await context.newPage();

    // Step 1: Go to main page
    console.log('Step 1: Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    console.log('  Current URL:', page.url());

    await page.screenshot({ path: '/tmp/sse-test-1.png', fullPage: true });

    // Check if we're on landing page (not logged in)
    const getStartedBtn = await page.$('text=Get Started');
    if (getStartedBtn) {
      console.log('\nStep 2: On landing page, clicking Get Started...');
      await getStartedBtn.click();
      await page.waitForTimeout(2000);
      console.log('  URL after Get Started:', page.url());
    }

    // Now we should be on login page
    console.log('\nStep 3: Logging in...');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/sse-test-2-login-page.png', fullPage: true });

    // Look for any input
    const allInputs = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).map(i => ({
        type: i.type,
        name: i.name,
        placeholder: i.placeholder,
        id: i.id
      }));
    });
    console.log('  Found inputs:', JSON.stringify(allInputs));

    // Try filling inputs by type
    try {
      await page.fill('input[type="email"]', 'bearhedge@163.com');
      await page.fill('input[type="password"]', 'Beats_by_dre_12');
      console.log('  Filled email and password');
    } catch (e: any) {
      console.log('  Could not fill by type:', e.message);
      // Try by placeholder
      try {
        await page.fill('input[placeholder*="email" i]', 'bearhedge@163.com');
        await page.fill('input[placeholder*="password" i]', 'Beats_by_dre_12');
      } catch {
        console.log('  Could not find login inputs');
      }
    }

    await page.screenshot({ path: '/tmp/sse-test-2b-filled.png', fullPage: true });

    // Click submit
    try {
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
        console.log('  Clicked submit button');
      } else {
        // Try finding a Sign In button
        const signInBtn = await page.$('button:has-text("Sign In")');
        if (signInBtn) {
          await signInBtn.click();
          console.log('  Clicked Sign In button');
        }
      }
    } catch (e: any) {
      console.log('  Error clicking submit:', e.message);
    }

    await page.waitForTimeout(5000);
    console.log('  URL after login attempt:', page.url());
    await page.screenshot({ path: '/tmp/sse-test-3-after-login.png', fullPage: true });

    // Check localStorage for auth
    const authData = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('auth') || key.includes('token') || key.includes('user'))) {
          data[key] = localStorage.getItem(key) || '';
        }
      }
      return data;
    });
    console.log('\n  LocalStorage auth data:', Object.keys(authData).length ? authData : 'none');

    // Check cookies
    const cookies = await context.cookies();
    console.log('  Cookies:', cookies.map(c => c.name).join(', ') || 'none');

    // Step 4: Test SSE
    console.log('\nStep 4: Testing SSE...');

    // Make request with credentials
    const sseResult = await page.evaluate(async () => {
      const events: any[] = [];
      const startTime = Date.now();

      return new Promise((resolve) => {
        try {
          // EventSource automatically includes cookies
          const eventSource = new EventSource('/api/broker/stream/live', { withCredentials: true });

          eventSource.onopen = () => {
            events.push({ type: 'open', receivedAt: Date.now() - startTime });
          };

          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              events.push({ ...data, receivedAt: Date.now() - startTime });

              if (events.length >= 30 || Date.now() - startTime > 30000) {
                eventSource.close();
                resolve({ success: true, events });
              }
            } catch {
              events.push({ type: 'parse_error', data: event.data, receivedAt: Date.now() - startTime });
            }
          };

          eventSource.onerror = (e) => {
            events.push({ type: 'error', receivedAt: Date.now() - startTime, readyState: eventSource.readyState });
            setTimeout(() => {
              eventSource.close();
              resolve({ success: false, events });
            }, 2000);
          };

          setTimeout(() => {
            eventSource.close();
            resolve({ success: events.length > 1, events });
          }, 30000);

        } catch (e: any) {
          resolve({ success: false, error: e.message });
        }
      });
    });

    console.log('\n📊 SSE Results:');
    console.log(JSON.stringify(sseResult, null, 2));

    const result = sseResult as any;
    const events = result.events || [];

    const prices = events.filter((e: any) => e.type === 'price');
    const connected = events.filter((e: any) => e.type === 'connected');
    const errors = events.filter((e: any) => e.type === 'error');

    console.log(`\n  Connected: ${connected.length}`);
    console.log(`  Prices: ${prices.length}`);
    console.log(`  Errors: ${errors.length}`);

    if (prices.length > 0) {
      console.log('\n💰 Prices:');
      prices.slice(0, 10).forEach((p: any, i: number) => {
        console.log(`  ${i+1}. ${p.symbol} $${p.last} @ ${p.receivedAt}ms`);
      });
    }

    await page.screenshot({ path: '/tmp/sse-test-final.png', fullPage: true });

    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');

    if (prices.length > 0) {
      console.log('✅ SSE STREAMING WORKING!');
    } else if (connected.length > 0) {
      console.log('⚠️ CONNECTED but NO PRICES - market may be closed');
    } else if (errors.length > 0) {
      console.log('❌ SSE FAILED - likely auth issue');
    } else {
      console.log('❌ NO DATA');
    }

    fs.writeFileSync('/tmp/sse-results.json', JSON.stringify(result, null, 2));

    // Keep browser open for manual inspection
    console.log('\nKeeping browser open for 10 seconds...');
    await page.waitForTimeout(10000);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    if (browser) await browser.close();
  }
}

testSSEStreaming();
