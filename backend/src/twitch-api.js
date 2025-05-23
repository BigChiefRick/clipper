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
  }

  // Verify clip exists (optional verification step)
  async verifyClipExists(clipId) {
    try {
      await this.rateLimit();
      
      const response = await axios.get(`${this.helixBaseURL}/clips`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          id: clipId
        },
        timeout: 10000
      });

      return response.data.data.length > 0;
    } catch (error) {
      logger.warn('Could not verify clip existence:', error.message);
      return true; // Assume it exists if we can't verify
    }
  }

  // Post message to Twitch chat
  async postToChat(channelName, message) {
    try {
      if (!this.chatClient) {
        return {
          success: false,
          error: 'Chat client not initialized - bot credentials not provided'
        };
      }

      if (!this.isConnected) {
        logger.warn('Chat client not connected, attempting to reconnect...');
        try {
          await this.chatClient.connect();
          await this.sleep(1000); // Wait for connection
        } catch (connectError) {
          return {
            success: false,
            error: 'Could not connect to Twitch chat'
          };
        }
      }

      // Ensure we're joined to the channel
      const channels = this.chatClient.getChannels();
      const targetChannel = `#${channelName.toLowerCase()}`;
      
      if (!channels.includes(targetChannel)) {
        await this.joinChannel(channelName);
        await this.sleep(500); // Wait for join to complete
      }

      await this.chatClient.say(targetChannel, message);
      
      logger.info(`Posted to ${channelName} chat: ${message}`);
      
      return {
        success: true,
        message: 'Posted to Twitch chat successfully',
        channel: channelName,
        text: message
      };

    } catch (error) {
      logger.error('Error posting to chat:', error);
      return {
        success: false,
        error: error.message || 'Failed to post to Twitch chat'
      };
    }
  }

  // Join a channel's chat
  async joinChannel(channelName) {
    try {
      if (!this.chatClient) {
        throw new Error('Chat client not initialized');
      }

      const targetChannel = `#${channelName.toLowerCase()}`;
      await this.chatClient.join(targetChannel);
      
      logger.info(`Joined channel: ${channelName}`);
      
      return {
        success: true,
        message: `Joined ${channelName} successfully`
      };

    } catch (error) {
      logger.error('Error joining channel:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Leave a channel's chat
  async leaveChannel(channelName) {
    try {
      if (!this.chatClient) {
        throw new Error('Chat client not initialized');
      }

      const targetChannel = `#${channelName.toLowerCase()}`;
      await this.chatClient.part(targetChannel);
      
      logger.info(`Left channel: ${channelName}`);
      
      return {
        success: true,
        message: `Left ${channelName} successfully`
      };

    } catch (error) {
      logger.error('Error leaving channel:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get channel information
  async getChannelInfo(channelName) {
    try {
      const userId = await this.getUserId(channelName);
      await this.rateLimit();
      
      const response = await axios.get(`${this.helixBaseURL}/channels`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          broadcaster_id: userId
        },
        timeout: 10000
      });

      if (response.data.data.length === 0) {
        throw new Error(`Channel information not found for ${channelName}`);
      }

      return {
        success: true,
        data: response.data.data[0]
      };

    } catch (error) {
      logger.error('Error getting channel info:', error.response?.data || error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Test connection and permissions
  async testConnection(channelName = null) {
    const results = {
      timestamp: new Date().toISOString()
    };

    try {
      // Test API connection and token validity
      await this.rateLimit();
      const response = await axios.get(`${this.helixBaseURL}/users`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 10000
      });

      results.api = {
        success: true,
        message: 'API connection successful',
        user: response.data.data[0]?.display_name || 'Unknown',
        scopes: await this.getTokenScopes()
      };

      // Test chat connection
      results.chat = {
        success: !!this.chatClient && this.isConnected,
        message: this.chatClient 
          ? (this.isConnected ? 'Chat client connected' : 'Chat client initialized but not connected')
          : 'Chat client not initialized (bot credentials not provided)',
        connectedChannels: this.chatClient ? this.chatClient.getChannels() : []
      };

      // Test specific channel if provided
      if (channelName) {
        try {
          const userId = await this.getUserId(channelName);
          const isLive = await this.isChannelLive(channelName);
          const channelInfo = await this.getChannelInfo(channelName);
          
          results.channel = {
            success: true,
            name: channelName,
            userId,
            isLive,
            info: channelInfo.success ? channelInfo.data : null,
            message: `Channel found. Live status: ${isLive}`
          };
        } catch (error) {
          results.channel = {
            success: false,
            name: channelName,
            error: error.message
          };
        }
      }

      // Overall health status
      results.overall = {
        success: results.api.success && (results.chat.success || !this.botOAuth),
        message: results.api.success 
          ? 'Twitch API integration healthy'
          : 'Twitch API integration has issues'
      };

      return results;

    } catch (error) {
      logger.error('Error testing connection:', error.response?.data || error.message);
      
      results.api = {
        success: false,
        error: error.response?.data?.message || error.message
      };
      
      results.overall = {
        success: false,
        message: 'Twitch API connection failed'
      };

      return results;
    }
  }

  // Get token scopes for verification
  async getTokenScopes() {
    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `OAuth ${this.accessToken}`
        },
        timeout: 10000
      });

      return response.data.scopes || [];
    } catch (error) {
      logger.error('Error getting token scopes:', error.message);
      return [];
    }
  }

  // Validate access token
  async validateToken() {
    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `OAuth ${this.accessToken}`
        },
        timeout: 10000
      });

      return {
        success: true,
        data: response.data,
        expiresIn: response.data.expires_in,
        scopes: response.data.scopes
      };

    } catch (error) {
      logger.error('Token validation failed:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Invalid or expired access token'
      };
    }
  }

  // Health check for monitoring
  async healthCheck() {
    try {
      const tokenValidation = await this.validateToken();
      
      return {
        status: tokenValidation.success ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
        token: {
          valid: tokenValidation.success,
          expiresIn: tokenValidation.expiresIn,
          scopes: tokenValidation.scopes
        },
        chat: {
          initialized: !!this.chatClient,
          connected: this.isConnected,
          channels: this.chatClient ? this.chatClient.getChannels().length : 0
        },
        cache: {
          keys: this.cache.keys().length,
          stats: this.cache.getStats()
        }
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Utility function to sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean up resources
  disconnect() {
    if (this.chatClient) {
      this.chatClient.disconnect();
      logger.info('Disconnected from Twitch chat');
    }
    
    // Clear cache
    this.cache.flushAll();
    
    this.isConnected = false;
  }

  // Get cache statistics
  getCacheStats() {
    return {
      keys: this.cache.keys(),
      stats: this.cache.getStats()
    };
  }

  // Clear cache
  clearCache() {
    this.cache.flushAll();
    logger.info('Twitch API cache cleared');
  }
}

module.exports = TwitchAPI;
