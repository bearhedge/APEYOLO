import { chromium } from 'playwright';

async function testEnginePage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating to apeyolo.com...');
  await page.goto('https://apeyolo.com/engine', { waitUntil: 'networkidle', timeout: 60000 });
  
  // Wait for the page to load
  await page.waitForTimeout(5000);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/engine-page.png', fullPage: true });
  console.log('Screenshot saved to /tmp/engine-page.png');
  
  // Get all text from page
  const allText = await page.evaluate(() => document.body.innerText);
  const lines = allText.split('\n').filter(line => 
    line.includes('$') || 
    line.includes('682') || 
    line.includes('690') || 
    line.includes('SPY') ||
    line.includes('VIX') ||
    line.includes('PRICE')
  );
  console.log('Relevant content from page:');
  lines.forEach(line => console.log('  ', line.trim()));
  
  await browser.close();
}

testEnginePage().catch(console.error);
