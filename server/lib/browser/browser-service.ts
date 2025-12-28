// server/lib/browser/browser-service.ts
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, BrowserContext } from 'playwright';

// Add stealth plugin to hide automation signals
chromium.use(StealthPlugin());

export interface BrowserResult {
  success: boolean;
  content?: string;
  url?: string;
  screenshot?: string; // base64
  error?: string;
}

class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastActivity: number = 0;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min

  async initialize(): Promise<void> {
    if (!this.browser) {
      console.log('[BrowserService] Launching browser with stealth...');

      // Use system Chromium in production (Docker/Alpine)
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

      this.browser = await chromium.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      // Create context with realistic browser fingerprint
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      this.page = await this.context.newPage();
      this.lastActivity = Date.now();
      console.log('[BrowserService] Browser ready with stealth');
    }
  }

  async search(query: string): Promise<BrowserResult> {
    try {
      await this.initialize();
      if (!this.page) throw new Error('Page not initialized');

      console.log(`[BrowserService] Searching: ${query}`);

      // Add random delay before navigating (human-like)
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

      // Use DuckDuckGo - less aggressive than Google
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.lastActivity = Date.now();

      // Wait a bit for JS to render (human-like)
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

      // Wait for results to load
      await this.page.waitForSelector('[data-testid="result"]', { timeout: 5000 }).catch(() => {});

      // Extract search results from DuckDuckGo
      const content = await this.page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll('[data-testid="result"]').forEach((el, i) => {
          if (i < 5) {
            const title = el.querySelector('h2')?.textContent || '';
            const snippet = el.querySelector('[data-result="snippet"]')?.textContent ||
                           el.querySelector('.result__snippet')?.textContent || '';
            if (title) results.push(`${title}: ${snippet}`);
          }
        });
        return results.join('\n\n');
      });

      const screenshot = await this.page.screenshot({ type: 'jpeg', quality: 70 });

      console.log(`[BrowserService] Search complete, ${content.length} chars`);
      return {
        success: true,
        content: content || 'No results found',
        url: this.page.url(),
        screenshot: screenshot.toString('base64'),
      };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[BrowserService] Search error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async navigateTo(url: string): Promise<BrowserResult> {
    try {
      await this.initialize();
      if (!this.page) throw new Error('Page not initialized');

      console.log(`[BrowserService] Navigating to: ${url}`);

      // Add random delay (human-like)
      await new Promise(r => setTimeout(r, 300 + Math.random() * 700));

      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.lastActivity = Date.now();

      // Wait for page to settle
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

      const content = await this.page.evaluate(() => {
        return document.body.innerText.slice(0, 5000);
      });

      const screenshot = await this.page.screenshot({ type: 'jpeg', quality: 70 });

      console.log(`[BrowserService] Navigation complete, ${content.length} chars`);
      return {
        success: true,
        content,
        url: this.page.url(),
        screenshot: screenshot.toString('base64'),
      };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[BrowserService] Navigation error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      console.log('[BrowserService] Closing browser');
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

// Singleton
let browserService: BrowserService | null = null;

export function getBrowserService(): BrowserService {
  if (!browserService) {
    browserService = new BrowserService();
  }
  return browserService;
}
