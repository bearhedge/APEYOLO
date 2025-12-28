// server/lib/browser/browser-service.ts
import { chromium, Browser, Page } from 'playwright';

export interface BrowserResult {
  success: boolean;
  content?: string;
  url?: string;
  screenshot?: string; // base64
  error?: string;
}

class BrowserService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private lastActivity: number = 0;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min

  async initialize(): Promise<void> {
    if (!this.browser) {
      console.log('[BrowserService] Launching browser...');

      // Use system Chromium in production (Docker/Alpine)
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

      this.browser = await chromium.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      this.page = await this.browser.newPage();
      this.lastActivity = Date.now();
      console.log('[BrowserService] Browser ready');
    }
  }

  async search(query: string): Promise<BrowserResult> {
    try {
      await this.initialize();
      if (!this.page) throw new Error('Page not initialized');

      console.log(`[BrowserService] Searching: ${query}`);
      // Use DuckDuckGo - no CAPTCHA/bot detection like Google
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.lastActivity = Date.now();

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
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.lastActivity = Date.now();

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
