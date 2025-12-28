// server/lib/agent/tools/web-browse.ts
import { getBrowserService } from '../../browser';

export interface WebBrowseArgs {
  query: string;
  url?: string;
}

export interface WebBrowseResult {
  content: string;
  url: string;
  screenshot?: string;
}

export async function webBrowse(args: WebBrowseArgs): Promise<WebBrowseResult> {
  const browser = getBrowserService();

  const result = args.url
    ? await browser.navigateTo(args.url)
    : await browser.search(args.query);

  if (!result.success) {
    throw new Error(result.error || 'Browser operation failed');
  }

  return {
    content: result.content || '',
    url: result.url || '',
    screenshot: result.screenshot,
  };
}
