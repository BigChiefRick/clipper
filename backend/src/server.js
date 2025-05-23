const express = require('express');
const cors = require('cors');
require('dotenv').config();

const TwitchAPI = require('./twitch-api');
const YouTubeAPI = require('./youtube-api');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize API handlers
const twitchAPI = new TwitchAPI();
const youtubeAPI = new YouTubeAPI();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main clip creation endpoint
app.post('/create-clip', async (req, res) => {
  try {
    const { channelName, duration = 30, title } = req.body;
    
    console.log(`Creating clip for channel: ${channelName}`);
    
    // Step 1: Create Twitch clip
    const clipData = await twitchAPI.createClip(channelName, duration, title);
    
    if (!clipData.success) {
      return res.status(400).json({ 
        error: 'Failed to create Twitch clip', 
        details: clipData.error 
      });
    }
    
    const clipUrl = clipData.clipUrl;
    const clipId = clipData.clipId;
    
    // Step 2: Post to Twitch chat
    const twitchChatResult = await twitchAPI.postToChat(channelName, `Check out this clip! ${clipUrl}`);
    
    // Step 3: Post to YouTube live chat (if configured)
    let youtubeChatResult = { success: true, message: 'YouTube not configured' };
    if (process.env.YOUTUBE_API_KEY) {
      youtubeChatResult = await youtubeAPI.postToLiveChat(clipUrl);
    }
    
    // Return results
    res.json({
      success: true,
      clipId,
      clipUrl,
      twitchChat: twitchChatResult,
      youtubeChat: youtubeChatResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error creating clip:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Test endpoints for development
app.post('/test-twitch', async (req, res) => {
  try {
    const { channelName } = req.body;
    const result = await twitchAPI.testConnection(channelName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/test-youtube', async (req, res) => {
  try {
    const result = await youtubeAPI.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(port, () => {
  console.log(`MultiStream Clipper backend running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});
