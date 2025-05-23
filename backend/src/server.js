const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

const TwitchAPI = require('./twitch-api');
const YouTubeAPI = require('./youtube-api');
const logger = require('./utils/logger');
const { validateConfig } = require('./utils/config-validator');

const app = express();
const port = process.env.PORT || 3000;
const wsPort = process.env.WEBSOCKET_PORT || 3001;

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed:', error.message);
  process.exit(1);
}

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-domain.com'] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE) || 30,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Initialize API handlers
const twitchAPI = new TwitchAPI();
const youtubeAPI = new YouTubeAPI();

// Create HTTP server for WebSocket
const server = http.createServer(app);

// WebSocket server for Stream Deck communication
const wss = new WebSocket.Server({ port: wsPort });

// Store active WebSocket connections
const activeConnections = new Set();

wss.on('connection', (ws, req) => {
  logger.info('Stream Deck connected via WebSocket');
  activeConnections.add(ws);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      await handleWebSocketMessage(ws, data);
    } catch (error) {
      logger.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    logger.info('Stream Deck disconnected');
    activeConnections.delete(ws);
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    activeConnections.delete(ws);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'MultiStream Clipper Backend connected',
    timestamp: new Date().toISOString()
  }));
});

// Handle WebSocket messages from Stream Deck
async function handleWebSocketMessage(ws, data) {
  const { type, payload } = data;

  switch (type) {
    case 'create-clip':
      await handleClipCreation(ws, payload);
      break;
    case 'test-connection':
      await handleConnectionTest(ws, payload);
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`
      }));
  }
}

// Handle clip creation via WebSocket
async function handleClipCreation(ws, payload) {
  const { channelName, duration, title, platforms } = payload;

  try {
    // Send status update
    ws.send(JSON.stringify({
      type: 'status',
      message: 'Creating clip...',
      stage: 'creating'
    }));

    // Create Twitch clip
    const clipResult = await twitchAPI.createClip(channelName, duration, title);
    
    if (!clipResult.success) {
      throw new Error(clipResult.error);
    }

    const clipUrl = clipResult.clipUrl;
    const clipId = clipResult.clipId;

    // Send clip created update
    ws.send(JSON.stringify({
      type: 'status',
      message: 'Clip created! Posting to chats...',
      stage: 'posting',
      clipUrl: clipUrl
    }));

    const results = {
      clipId,
      clipUrl,
      platforms: {}
    };

    // Post to Twitch chat if enabled
    if (!platforms || platforms.twitch !== false) {
      const twitchResult = await twitchAPI.postToChat(
        channelName, 
        process.env.CLIP_MESSAGE_TEMPLATE?.replace('{url}', clipUrl) || `🎬 Check out this clip! ${clipUrl}`
      );
      results.platforms.twitch = twitchResult;
    }

    // Post to YouTube chat if enabled and configured
    if ((!platforms || platforms.youtube !== false) && process.env.YOUTUBE_API_KEY) {
      const youtubeResult = await youtubeAPI.postToLiveChat(clipUrl);
      results.platforms.youtube = youtubeResult;
    }

    // Send success response
    ws.send(JSON.stringify({
      type: 'clip-created',
      success: true,
      data: results,
      timestamp: new Date().toISOString()
    }));

    logger.info('Clip created successfully', { clipId, clipUrl, channelName });

  } catch (error) {
    logger.error('Clip creation failed:', error);
    ws.send(JSON.stringify({
      type: 'clip-created',
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

// Handle connection testing
async function handleConnectionTest(ws, payload) {
  const { channelName } = payload || {};

  try {
    const results = {
      twitch: await twitchAPI.testConnection(channelName),
      youtube: process.env.YOUTUBE_API_KEY ? await youtubeAPI.testConnection() : { 
        success: false, 
        message: 'YouTube API not configured' 
      }
    };

    ws.send(JSON.stringify({
      type: 'connection-test',
      success: true,
      data: results,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    logger.error('Connection test failed:', error);
    ws.send(JSON.stringify({
      type: 'connection-test',
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

// Broadcast message to all connected Stream Deck instances
function broadcastToStreamDeck(message) {
  const data = JSON.stringify(message);
  activeConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// =================================================================
// REST API Endpoints (for testing and external integrations)
// =================================================================

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        twitch: await twitchAPI.healthCheck?.() || { status: 'unknown' },
        youtube: process.env.YOUTUBE_API_KEY 
          ? (await youtubeAPI.healthCheck?.() || { status: 'unknown' })
          : { status: 'not_configured' }
      },
      websocket: {
        connected_clients: activeConnections.size,
        port: wsPort
      }
    };

    const allHealthy = Object.values(health.services)
      .every(service => service.status === 'ok' || service.status === 'not_configured');

    res.status(allHealthy ? 200 : 503).json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Main clip creation endpoint (REST API)
app.post('/create-clip', async (req, res) => {
  try {
    const { channelName, duration = 30, title, platforms } = req.body;

    if (!channelName) {
      return res.status(400).json({ 
        error: 'channelName is required' 
      });
    }

    logger.info(`Creating clip for channel: ${channelName}`);

    // Create Twitch clip
    const clipData = await twitchAPI.createClip(channelName, duration, title);

    if (!clipData.success) {
      return res.status(400).json({
        error: 'Failed to create Twitch clip',
        details: clipData.error
      });
    }

    const clipUrl = clipData.clipUrl;
    const clipId = clipData.clipId;

    const results = {
      success: true,
      clipId,
      clipUrl,
      platforms: {}
    };

    // Post to Twitch chat
    if (!platforms || platforms.twitch !== false) {
      results.platforms.twitch = await twitchAPI.postToChat(
        channelName,
        process.env.CLIP_MESSAGE_TEMPLATE?.replace('{url}', clipUrl) || `🎬 Check out this clip! ${clipUrl}`
      );
    }

    // Post to YouTube live chat (if configured)
    if ((!platforms || platforms.youtube !== false) && process.env.YOUTUBE_API_KEY) {
      results.platforms.youtube = await youtubeAPI.postToLiveChat(clipUrl);
    }

    results.timestamp = new Date().toISOString();

    // Broadcast to connected Stream Deck instances
    broadcastToStreamDeck({
      type: 'clip-created',
      success: true,
      data: results
    });

    res.json(results);

  } catch (error) {
    logger.error('Error creating clip:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Test endpoints
app.post('/test-twitch', async (req, res) => {
  try {
    const { channelName } = req.body;
    const result = await twitchAPI.testConnection(channelName);
    res.json(result);
  } catch (error) {
    logger.error('Twitch test failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/test-youtube', async (req, res) => {
  try {
    const result = await youtubeAPI.testConnection();
    res.json(result);
  } catch (error) {
    logger.error('YouTube test failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Configuration endpoint
app.get('/config', (req, res) => {
  res.json({
    twitch: {
      configured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN),
      botConfigured: !!(process.env.TWITCH_BOT_USERNAME && process.env.TWITCH_BOT_OAUTH)
    },
    youtube: {
      configured: !!process.env.YOUTUBE_API_KEY
    },
    websocket: {
      port: wsPort,
      connected_clients: activeConnections.size
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Close WebSocket server
  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  // Disconnect from Twitch chat
  twitchAPI.disconnect();

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.emit('SIGTERM');
});

// Start servers
server.listen(port, () => {
  logger.info(`MultiStream Clipper backend running on port ${port}`);
  logger.info(`WebSocket server running on port ${wsPort}`);
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`Configuration: http://localhost:${port}/config`);
});

// Log startup information
logger.info('MultiStream Clipper Backend starting...', {
  nodeVersion: process.version,
  environment: process.env.NODE_ENV || 'development',
  twitchConfigured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN),
  youtubeConfigured: !!process.env.YOUTUBE_API_KEY
});
