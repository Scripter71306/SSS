const express = require('express');
const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public')); // Serve HTML/JS/CSS

let browserInstance = null;
let wsServer = null;

// Start Puppeteer + noVNC on boot
async function startBrowser() {
  browserInstance = await puppeteer.launch({
    headless: false, // Visible for streaming
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browserInstance.newPage();
  await page.goto('https://web.snapchat.com', { waitUntil: 'networkidle2' });
  // Lock page: Disable navigation
  await page.evaluateOnNewDocument(() => {
    const originalOpen = window.open;
    window.open = () => false;
    document.addEventListener('click', e => {
      if (e.target.href && !e.target.href.includes('snapchat.com')) e.preventDefault();
    });
  });
  // noVNC server (simplified – streams page canvas)
  const wss = new WebSocket.Server({ port: 6080 });
  wss.on('connection', ws => {
    // Stream page screenshot + input events (full impl in noVNC docs)
    setInterval(() => {
      page.screenshot({ encoding: 'base64' }).then(img => ws.send(img));
    }, 100); // 10 FPS – tune for 60
    ws.on('message', async msg => {
      // Handle mouse/keyboard input to page
      await page.evaluate(input => {
        // Simulate input on page
        document.dispatchEvent(new MouseEvent('click', input));
      }, JSON.parse(msg));
    });
  });
}

startBrowser().catch(console.error);

// Serve session embed
app.get('/session', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => console.log(`Proxy running on port ${port}`));
