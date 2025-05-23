const axios = require('axios');
const tmi = require('tmi.js');
const NodeCache = require('node-cache');
const logger = require('./utils/logger');

class TwitchAPI {
  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID;
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET;
    this.accessToken = process.env.TWITCH_ACCESS_TOKEN;
    this.botUsername = process.env.TWITCH_BOT_USERNAME || 'multistream_clipper';
    this.botOAuth = process.env.TWITCH_BOT_OAUTH;
    
    // Initialize cache for user IDs and other frequently accessed data
    this.cache = new NodeCache({ 
      stdTTL: 300, // 5 minutes default TTL
      checkperiod: 60 // Check for expired keys every minute
    });
    
    // TMI.js client for chat
    this.chatClient = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    // Base URLs
    this.helixBaseURL = 'https://api.twitch.tv/helix';
    
    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // 100ms between requests
    
    // Initialize chat client if credentials are provided
    if (this.botOAuth && this.botUsername) {
      this.initializeChatClient();
    } else {
      logger.warn('Bot credentials not provided, chat functionality will be limited');
    }
  }

  // Initialize chat client with reconnection logic
  initializeChatClient() {
    const chatOptions = {
      options: { 
        debug: process.env.DEBUG_MODE === 'true',
        messagesLogLevel: 'error'
      },
      connection: {
        reconnect: true,
        secure: true,
        timeout: 180000,
        reconnectDecay: 1.5,
        reconnectInterval: 1000,
        maxReconnectAttempts: this.maxReconnectAttempts,
        maxReconnectInterval: 30000
      },
      identity: {
        username: this.botUsername,
        password: this.botOAuth
      }
    };

    this.chatClient = new tmi.Client(chatOptions);

    // Set up event handlers
    this.chatClient.on('connected', () => {
      logger.info('Connected to Twitch chat');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.chatClient.on('disconnected', (reason) => {
      logger.warn('Disconnected from Twitch chat:', reason);
      this.isConnected = false;
    });

    this.chatClient.on('reconnect', () => {
      this.reconnectAttempts++;
      logger.info(`Reconnecting to Twitch chat (attempt ${this.reconnectAttempts})`);
    });

    this.chatClient.on('notice', (channel, msgid, message) => {
      logger.info(`Twitch notice [${msgid}]:`, message);
    });

    this.chatClient.on('messagedeleted', (channel, username, deletedMessage, userstate) => {
      logger.debug(`Message deleted in ${channel} by ${username}:`, deletedMessage);
    });

    // Connect to chat
    this.chatClient.connect().catch(err => {
      logger.error('Failed to connect to Twitch chat:', err);
    });
  }

  // Rate limiting helper
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await this.sleep(delay);
    }
    
    this.lastRequestTime = Date.now();
  }

  // Get user ID from username with caching
  async getUserId(username) {
    const cacheKey = `user_id_${username.toLowerCase()}`;
    let userId = this.cache.get(cacheKey);
    
    if (userId) {
      return userId;
    }

    try {
      await this.rateLimit();
      
      const response = await axios.get(`${this.helixBaseURL}/users`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          login: username.toLowerCase()
        },
        timeout: 10000
      });

      if (response.data.data.length === 0) {
        throw new Error(`User ${username} not found`);
      }

      userId = response.data.data[0].id;
      
      // Cache for 1 hour since user IDs don't change
      this.cache.set(cacheKey, userId, 3600);
      
      logger.debug(`Retrieved user ID for ${username}: ${userId}`);
      return userId;

    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Invalid or expired Twitch access token');
      }
      
      logger.error('Error getting user ID:', error.response?.data || error.message);
      throw new Error(`Failed to get user ID for ${username}: ${error.message}`);
    }
  }

  // Check if channel is live with caching
  async isChannelLive(username) {
    const cacheKey = `live_status_${username.toLowerCase()}`;
    let liveStatus = this.cache.get(cacheKey);
    
    if (liveStatus !== undefined) {
      return liveStatus;
    }

    try {
      const userId = await this.getUserId(username);
      await this.rateLimit();
      
      const response = await axios.get(`${this.helixBaseURL}/streams`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          user_id: userId
        },
        timeout: 10000
      });

      liveStatus = response.data.data.length > 0;
      
      // Cache live status for 30 seconds to avoid spam
      this.cache.set(cacheKey, liveStatus, 30);
      
      logger.debug(`Live status for ${username}: ${liveStatus}`);
      return liveStatus;

    } catch (error) {
      logger.error('Error checking if channel is live:', error.response?.data || error.message);
      return false; // Assume offline on error
    }
  }

  // Create a clip with enhanced error handling
  async createClip(channelName, duration = 30, title = null) {
    try {
      // Validate inputs
      if (!channelName || typeof channelName !== 'string') {
        return {
          success: false,
          error: 'Invalid channel name provided'
        };
      }

      if (duration < 5 || duration > 60) {
        return {
          success: false,
          error: 'Clip duration must be between 5 and 60 seconds'
        };
      }

      logger.info(`Creating clip for ${channelName} (${duration}s)`);

      // Check if channel is live first
      const isLive = await this.isChannelLive(channelName);
      if (!isLive) {
        return {
          success: false,
          error: `Channel ${channelName} is not currently live`
        };
      }

      const userId = await this.getUserId(channelName);
      await this.rateLimit();
      
      const clipData = {
        broadcaster_id: userId,
        has_delay: false // Set to true if broadcaster has delay enabled
      };

      const response = await axios.post(`${this.helixBaseURL}/clips`, clipData, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const clipId = response.data.data[0].id;
      const editUrl = response.data.data[0].edit_url;
      
      // Wait for clip to be processed
      await this.sleep(3000);
      
      // Verify clip was created successfully
      const clipUrl = `https://clips.twitch.tv/${clipId}`;
      
      // Optionally verify the clip exists
      const clipExists = await this.verifyClipExists(clipId);
      if (!clipExists) {
        logger.warn(`Clip ${clipId} may not be fully processed yet`);
      }

      logger.info(`Clip created successfully: ${clipUrl}`);
      
      return {
        success: true,
        clipId,
        clipUrl,
        editUrl,
        channelName,
        duration
      };

    } catch (error) {
      if (error.response?.status === 401) {
        logger.error('Unauthorized - invalid or expired access token');
        return {
          success: false,
          error: 'Invalid or expired Twitch access token'
        };
      }
      
      if (error.response?.status === 403) {
        logger.error('Forbidden - insufficient permissions for clip creation');
        return {
          success: false,
          error: 'Insufficient permissions to create clips. Ensure your token has the clips:edit scope.'
        };
      }
      
      if (error.response?.status === 503) {
        logger.error('Twitch API service unavailable');
        return {
          success: false,
          error: 'Twitch API is currently unavailable. Please try again later.'
        };
      }

      logger.error('Error creating clip:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error occurred'
      };
    }
