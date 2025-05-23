const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const NodeCache = require('node-cache');
const logger = require('./utils/logger');

class YouTubeAPI {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
    this.clientId = process.env.YOUTUBE_CLIENT_ID;
    this.clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    this.channelId = process.env.YOUTUBE_CHANNEL_ID;
    this.liveStreamId = process.env.YOUTUBE_LIVE_STREAM_ID;

    // Initialize cache for live chat IDs and other data
    this.cache = new NodeCache({ 
      stdTTL: 300, // 5 minutes default TTL
      checkperiod: 60 
    });

    // OAuth2 client for authenticated requests
    this.oauth2Client = null;
    this.youtube = null;

    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // 100ms between requests
    this.quotaUsed = 0;
    this.dailyQuotaLimit = 10000; // YouTube API daily quota limit

    this.initializeAPI();
  }

  // Initialize YouTube API client
  initializeAPI() {
    try {
      if (!this.apiKey) {
        logger.warn('YouTube API key not provided, YouTube functionality will be disabled');
        return;
      }

      // Initialize YouTube API with API key for basic operations
      this.youtube = google.youtube({
        version: 'v3',
        auth: this.apiKey
      });

      // Initialize OAuth2 client if credentials are provided
      if (this.clientId && this.clientSecret) {
        this.oauth2Client = new OAuth2Client(
          this.clientId,
          this.clientSecret,
          'http://localhost:3000/auth/youtube/callback' // Redirect URI
        );
      } else {
        logger.warn('YouTube OAuth credentials not provided, live chat posting will be limited');
      }

      logger.info('YouTube API initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize YouTube API:', error.message);
    }
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

  // Track quota usage
  trackQuotaUsage(cost = 1) {
    this.quotaUsed += cost;
    logger.debug(`YouTube API quota used: ${this.quotaUsed}/${this.dailyQuotaLimit}`);
    
    if (this.quotaUsed > this.dailyQuotaLimit * 0.8) {
      logger.warn(`YouTube API quota usage at ${Math.round((this.quotaUsed / this.dailyQuotaLimit) * 100)}%`);
    }
  }

  // Get live chat ID for a live stream
  async getLiveChatId(videoId = null) {
    try {
      // Check cache first
      const cacheKey = `live_chat_id_${videoId || this.liveStreamId || 'default'}`;
      let liveChatId = this.cache.get(cacheKey);
      
      if (liveChatId) {
        return liveChatId;
      }

      if (!this.youtube) {
        throw new Error('YouTube API not initialized');
      }

      await this.rateLimit();

      // If no specific video ID provided, try to find current live stream
      if (!videoId && this.channelId) {
        const liveStreams = await this.getCurrentLiveStreams();
        if (liveStreams.length > 0) {
          videoId = liveStreams[0].id;
        }
      }

      if (!videoId) {
        throw new Error('No live stream video ID available');
      }

      const response = await this.youtube.videos.list({
        part: ['liveStreamingDetails'],
        id: [videoId]
      });

      this.trackQuotaUsage(1);

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Video not found or not a live stream');
      }

      const video = response.data.items[0];
      liveChatId = video.liveStreamingDetails?.activeLiveChatId;

      if (!liveChatId) {
        throw new Error('Live chat not available for this stream');
      }

      // Cache for 5 minutes
      this.cache.set(cacheKey, liveChatId, 300);
      
      logger.debug(`Retrieved live chat ID: ${liveChatId}`);
      return liveChatId;

    } catch (error) {
      logger.error('Error getting live chat ID:', error.message);
      throw error;
    }
  }

  // Get current live streams for the channel
  async getCurrentLiveStreams() {
    try {
      if (!this.youtube || !this.channelId) {
        throw new Error('YouTube API or channel ID not configured');
      }

      await this.rateLimit();

      const response = await this.youtube.search.list({
        part: ['id', 'snippet'],
        channelId: this.channelId,
        eventType: 'live',
        type: 'video',
        maxResults: 5
      });

      this.trackQuotaUsage(100); // Search operations cost 100 units

      return response.data.items || [];

    } catch (error) {
      logger.error('Error getting current live streams:', error.message);
      return [];
    }
  }

  // Post message to YouTube live chat
  async postToLiveChat(message, videoId = null) {
    try {
      if (!this.oauth2Client) {
        return {
          success: false,
          error: 'YouTube OAuth not configured - cannot post to live chat'
        };
      }

      // Get live chat ID
      const liveChatId = await this.getLiveChatId(videoId);
      
      if (!liveChatId) {
        return {
          success: false,
          error: 'Could not find active live chat'
        };
      }

      await this.rateLimit();

      // Create authenticated YouTube client
      const authenticatedYoutube = google.youtube({
        version: 'v3',
        auth: this.oauth2Client
      });

      const response = await authenticatedYoutube.liveChatMessages.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            liveChatId: liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: {
              messageText: message
            }
          }
        }
      });

      this.trackQuotaUsage(50); // Insert operations cost 50 units

      logger.info(`Posted to YouTube live chat: ${message}`);

      return {
        success: true,
        message: 'Posted to YouTube live chat successfully',
        messageId: response.data.id,
        liveChatId: liveChatId,
        text: message
      };

    } catch (error) {
      logger.error('Error posting to YouTube live chat:', error.message);
      
      // Handle specific YouTube API errors
      if (error.code === 403) {
        return {
          success: false,
          error: 'Insufficient permissions to post to live chat. Check OAuth scopes.'
        };
      }
      
      if (error.code === 404) {
        return {
          success: false,
          error: 'Live chat not found or stream is not live'
        };
      }

      return {
        success: false,
        error: error.message || 'Failed to post to YouTube live chat'
      };
    }
  }

  // Get channel information
  async getChannelInfo(channelId = null) {
    try {
      const targetChannelId = channelId || this.channelId;
      
      if (!targetChannelId) {
        throw new Error('No channel ID provided');
      }

      await this.rateLimit();

      const response = await this.youtube.channels.list({
        part: ['snippet', 'statistics', 'status'],
        id: [targetChannelId]
      });

      this.trackQuotaUsage(1);

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Channel not found');
      }

      return {
        success: true,
        data: response.data.items[0]
      };

    } catch (error) {
      logger.error('Error getting channel info:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check if channel is currently live
  async isChannelLive(channelId = null) {
    try {
      const liveStreams = await this.getCurrentLiveStreams();
      return liveStreams.length > 0;
    } catch (error) {
      logger.error('Error checking if channel is live:', error.message);
      return false;
    }
  }

  // Generate OAuth URL for authentication
  generateAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const scopes = [
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube.readonly'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(code) {
    try {
      if (!this.oauth2Client) {
        throw new Error('OAuth2 client not initialized');
      }

      const { tokens } = await this.oauth2Client.getAccessToken(code);
      this.oauth2Client.setCredentials(tokens);

      logger.info('YouTube OAuth tokens obtained successfully');

      return {
        success: true,
        tokens: tokens
      };

    } catch (error) {
      logger.error('Error exchanging code for tokens:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Set OAuth tokens (for when tokens are stored/retrieved)
  setOAuthTokens(tokens) {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    this.oauth2Client.setCredentials(tokens);
    logger.info('YouTube OAuth tokens set successfully');
  }

  // Refresh OAuth tokens
  async refreshTokens() {
    try {
      if (!this.oauth2Client) {
        throw new Error('OAuth2 client not initialized');
      }

      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);

      logger.info('YouTube OAuth tokens refreshed successfully');

      return {
        success: true,
        tokens: credentials
      };

    } catch (error) {
      logger.error('Error refreshing tokens:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Test connection and permissions
  async testConnection() {
    const results = {
      timestamp: new Date().toISOString()
    };

    try {
      // Test basic API access
      if (!this.youtube) {
        results.api = {
          success: false,
          error: 'YouTube API not initialized'
        };
        return results;
      }

      // Test API key validity
      await this.rateLimit();
      const channelTest = await this.youtube.channels.list({
        part: ['snippet'],
        mine: false,
        id: ['UCuAXFkgsw1L7xaCfnd5JJOw'] // Use a known YouTube channel for testing
      });

      this.trackQuotaUsage(1);

      results.api = {
        success: true,
        message: 'API key valid and working',
        quotaUsed: this.quotaUsed,
        quotaLimit: this.dailyQuotaLimit
      };

      // Test OAuth if configured
      if (this.oauth2Client) {
        try {
          const credentials = this.oauth2Client.credentials;
          results.oauth = {
            success: !!credentials.access_token,
            message: credentials.access_token ? 'OAuth tokens available' : 'OAuth tokens not set',
            hasRefreshToken: !!credentials.refresh_token,
            tokenExpiry: credentials.expiry_date
          };
        } catch (oauthError) {
          results.oauth = {
            success: false,
            error: oauthError.message
          };
        }
      } else {
        results.oauth = {
          success: false,
          message: 'OAuth not configured'
        };
      }

      // Test channel access if configured
      if (this.channelId) {
        const channelInfo = await this.getChannelInfo();
        results.channel = {
          success: channelInfo.success,
          channelId: this.channelId,
          data: channelInfo.success ? {
            title: channelInfo.data.snippet.title,
            subscriberCount: channelInfo.data.statistics.subscriberCount
          } : null,
          error: channelInfo.error
        };

        // Test live stream status
        const isLive = await this.isChannelLive();
        results.liveStatus = {
          isLive: isLive,
          message: isLive ? 'Channel is currently live' : 'Channel is not live'
        };
      }

      // Overall health
      results.overall = {
        success: results.api.success,
        message: results.api.success ? 'YouTube API integration healthy' : 'YouTube API integration has issues',
        liveChatReady: results.oauth?.success && (results.liveStatus?.isLive || false)
      };

      return results;

    } catch (error) {
      logger.error('Error testing YouTube connection:', error.message);
      
      results.api = {
        success: false,
        error: error.message
      };
      
      results.overall = {
        success: false,
        message: 'YouTube API connection failed'
      };

      return results;
    }
  }

  // Health check for monitoring
  async healthCheck() {
    try {
      const testResult = await this.testConnection();
      
      return {
        status: testResult.overall.success ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
        api: testResult.api,
        oauth: testResult.oauth,
        quota: {
          used: this.quotaUsed,
          limit: this.dailyQuotaLimit,
          percentage: Math.round((this.quotaUsed / this.dailyQuotaLimit) * 100)
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
    logger.info('YouTube API cache cleared');
  }

  // Reset daily quota counter (should be called daily)
  resetQuotaCounter() {
    this.quotaUsed = 0;
    logger.info('YouTube API quota counter reset');
  }
}

module.exports = YouTubeAPI;
