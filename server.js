const express = require('express');
const puppeteer = require('puppeteer');
const WebSocket = require('ws');
const path = require('path');
const http = require('http'); // Added for upgrade handling

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;
let sessions = new Map(); // Track per-session browsers to save RAM

app.use(express.static('public'));

// WS upgrade on main port (Render requirement)
server.on('upgrade', (request, socket, head) => {
  const { url } = request;
  if (url === '/ws') { // Connect to /ws path
    const ws = new WebSocket(request, socket, head);
    ws.on('message', async (message) => {
      const data = JSON.parse(message);
      const sessionId = data.sessionId || 'default';
      if (data.type === 'init') {
        // Start Puppeteer session on demand
        if (!sessions.has(sessionId)) {
          const browser = await puppeteer.launch({
            headless: 'new', // Use 'new' for better 2025 compat
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--single-process', // For low RAM on Render free tier
              '--no-zygote',
              '--no-first-run',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding'
            ]
          });
          const page = await browser.newPage();
          await page.setViewport({ width: 1920, height: 1080 });
          await page.goto('https://web.snapchat.com', { waitUntil: 'networkidle2', timeout: 30000 });

          // Lock to Snapchat
          await page.evaluateOnNewDocument(() => {
            window.open = () => false;
            history.pushState = () => false;
            document.addEventListener('contextmenu', e => e.preventDefault());
            document.addEventListener('keydown', e => {
              if (e.key === 'F12' || (e.ctrlKey && e.key === 'r') || e.key === 'Escape') e.preventDefault();
            });
            setInterval(() => {
              if (!window.location.href.includes('snapchat.com')) window.location.href = 'https://web.snapchat.com';
            }, 1000);
          });

          sessions.set(sessionId, { browser, page });
          console.log(`Session ${sessionId} started`);
        }

        const session = sessions.get(sessionId);
        if (session) {
          // Stream screenshots (30 FPS – tune to 33 for 30 FPS, 16 for 60 if RAM allows)
          const interval = setInterval(async () => {
            try {
              const screenshot = await session.page.screenshot({ encoding: 'base64', fullPage: true, omitBackground: true });
              ws.send(JSON.stringify({ type: 'screenshot', data: screenshot }));
            } catch (err) {
              console.error('Screenshot error:', err);
            }
          }, 33); // 30 FPS

          ws.on('close', () => {
            clearInterval(interval);
            // Clean up session after 5 min idle
            setTimeout(() => {
              session.browser.close();
              sessions.delete(sessionId);
              console.log(`Session ${sessionId} closed`);
            }, 300000);
          });

          ws.on('message', async (msg) => {
            const input = JSON.parse(msg);
            if (input.type === 'mouse') {
              await session.page.mouse.click(input.x, input.y);
            } else if (input.type === 'key') {
              await session.page.keyboard.press(input.key);
            } else if (input.type === 'type') {
              await session.page.keyboard.type(input.text);
            }
          });
        }
      }
    });
    ws.on('error', (err) => console.error('WS error:', err));
  } else {
    socket.destroy();
  }
});

app.get('/session', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(port, () => {
  console.log(`Schutz Snapchat Proxy running on port ${port}`);
});
