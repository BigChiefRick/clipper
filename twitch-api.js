const axios = require('axios');
const tmi = require('tmi.js');

class TwitchAPI {
  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID;
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET;
    this.accessToken = process.env.TWITCH_ACCESS_TOKEN;
    this.botUsername = process.env.TWITCH_BOT_USERNAME || 'your_bot_username';
    this.botOAuth = process.env.TWITCH_BOT_OAUTH; // OAuth token for bot account
    
    // TMI.js client for chat
    this.chatClient = null;
    this.initializeChatClient();
    
    // Base URLs
    this.helixBaseURL = 'https://api.twitch.tv/helix';
  }

  // Initialize chat client
  initializeChatClient() {
    if (this.botOAuth && this.botUsername) {
      this.chatClient = new tmi.Client({
        options: { debug: false },
        connection: {
          reconnect: true,
          secure: true
        },
        identity: {
          username: this.botUsername,
          password: this.botOAuth
        }
      });

      this.chatClient.connect().then(() => {
        console.log('Connected to Twitch chat');
      }).catch(err => {
        console.error('Failed to connect to Twitch chat:', err);
      });
    }
  }

  // Get user ID from username
  async getUserId(username) {
    try {
      const response = await axios.get(`${this.helixBaseURL}/users`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          login: username.toLowerCase()
        }
      });

      if (response.data.data.length === 0) {
        throw new Error(`User ${username} not found`);
      }

      return response.data.data[0].id;
    } catch (error) {
      console.error('Error getting user ID:', error.response?.data || error.message);
      throw error;
    }
  }

  // Check if channel is live
  async isChannelLive(username) {
    try {
      const userId = await this.getUserId(username);
      const response = await axios.get(`${this.helixBaseURL}/streams`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          user_id: userId
        }
      });

      return response.data.data.length > 0;
    } catch (error) {
      console.error('Error checking if channel is live:', error.response?.data || error.message);
      return false;
    }
  }

  // Create a clip
  async createClip(channelName, duration = 30, title = null) {
    try {
      // Check if channel is live first
      const isLive = await this.isChannelLive(channelName);
      if (!isLive) {
        return {
          success: false,
          error: `Channel ${channelName} is not currently live`
        };
      }

      const userId = await this.getUserId(channelName);
      
      const clipData = {
        broadcaster_id: userId,
        has_delay: false // Set to true if broadcaster has delay enabled
      };

      const response = await axios.post(`${this.helixBaseURL}/clips`, clipData, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const clipId = response.data.data[0].id;
      const editUrl = response.data.data[0].edit_url;
      
      // Wait a moment for clip to be processed, then get the public URL
      await this.sleep(2000);
      const clipUrl = `https://clips.twitch.tv/${clipId}`;

      console.log(`Clip created successfully: ${clipUrl}`);
      
      return {
        success: true,
        clipId,
        clipUrl,
        editUrl
      };

    } catch (error) {
      console.error('Error creating clip:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Post message to Twitch chat
  async postToChat(channelName, message) {
    try {
      if (!this.chatClient) {
        return {
          success: false,
          error: 'Chat client not initialized'
        };
      }

      await this.chatClient.say(channelName.toLowerCase(), message);
      
      console.log(`Posted to ${channelName} chat: ${message}`);
      
      return {
        success: true,
        message: 'Posted to Twitch chat successfully'
      };

    } catch (error) {
      console.error('Error posting to chat:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Join a channel's chat
  async joinChannel(channelName) {
    try {
      if (!this.chatClient) {
        throw new Error('Chat client not initialized');
      }

      await this.chatClient.join(channelName.toLowerCase());
      console.log(`Joined channel: ${channelName}`);
      
      return {
        success: true,
        message: `Joined ${channelName} successfully`
      };

    } catch (error) {
      console.error('Error joining channel:', error);
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

      await this.chatClient.part(channelName.toLowerCase());
      console.log(`Left channel: ${channelName}`);
      
      return {
        success: true,
        message: `Left ${channelName} successfully`
      };

    } catch (error) {
      console.error('Error leaving channel:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Test connection and permissions
  async testConnection(channelName = null) {
    try {
      // Test API connection
      const response = await axios.get(`${this.helixBaseURL}/users`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      const results = {
        api: {
          success: true,
          message: 'API connection successful',
          user: response.data.data[0]?.display_name || 'Unknown'
        },
        chat: {
          success: !!this.chatClient,
          message: this.chatClient ? 'Chat client initialized' : 'Chat client not initialized'
        }
      };

      // Test specific channel if provided
      if (channelName) {
        try {
          const userId = await this.getUserId(channelName);
          const isLive = await this.isChannelLive(channelName);
          
          results.channel = {
            success: true,
            name: channelName,
            userId,
            isLive,
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

      return results;

    } catch (error) {
      console.error('Error testing connection:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Validate access token
  async validateToken() {
    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `OAuth ${this.accessToken}`
        }
      });

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      console.error('Token validation failed:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Invalid or expired access token'
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
      console.log('Disconnected from Twitch chat');
    }
  }
}

module.exports = TwitchAPI;
