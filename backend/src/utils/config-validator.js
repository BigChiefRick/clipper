const Joi = require('joi');

// Define configuration schema
const configSchema = Joi.object({
  // Server configuration
  PORT: Joi.number().port().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  
  // Twitch configuration (required)
  TWITCH_CLIENT_ID: Joi.string().required().messages({
    'any.required': 'TWITCH_CLIENT_ID is required. Get it from https://dev.twitch.tv/console'
  }),
  TWITCH_CLIENT_SECRET: Joi.string().required().messages({
    'any.required': 'TWITCH_CLIENT_SECRET is required. Get it from https://dev.twitch.tv/console'
  }),
  TWITCH_ACCESS_TOKEN: Joi.string().required().messages({
    'any.required': 'TWITCH_ACCESS_TOKEN is required. Generate one with clips:edit scope'
  }),
  
  // Twitch bot configuration (optional)
  TWITCH_BOT_USERNAME: Joi.string().optional(),
  TWITCH_BOT_OAUTH: Joi.string().pattern(/^oauth:/).optional().messages({
    'string.pattern.base': 'TWITCH_BOT_OAUTH must start with "oauth:"'
  }),
  
  // YouTube configuration (optional)
  YOUTUBE_API_KEY: Joi.string().optional(),
  YOUTUBE_CLIENT_ID: Joi.string().optional(),
  YOUTUBE_CLIENT_SECRET: Joi.string().optional(),
  YOUTUBE_CHANNEL_ID: Joi.string().optional(),
  YOUTUBE_LIVE_STREAM_ID: Joi.string().optional(),
  
  // Application settings
  DEFAULT_CLIP_DURATION: Joi.number().min(5).max(60).default(30),
  CLIP_MESSAGE_TEMPLATE: Joi.string().default('🎬 Check out this clip! {url}'),
  RATE_LIMIT_REQUESTS_PER_MINUTE: Joi.number().min(1).max(1000).default(30),
  
  // Logging and debug
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  DEBUG_MODE: Joi.boolean().default(false),
  LOG_TO_FILE: Joi.boolean().default(false),
  
  // WebSocket configuration
  WEBSOCKET_PORT: Joi.number().port().default(3001)
}).unknown(true); // Allow other environment variables

/**
 * Validate configuration against schema
 * @returns {Object} Validated configuration
 * @throws {Error} If validation fails
 */
function validateConfig() {
  const { error, value } = configSchema.validate(process.env, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    const errorMessages = error.details.map(detail => detail.message);
    throw new Error(`Configuration validation failed:\n${errorMessages.join('\n')}`);
  }

  return value;
}

/**
 * Check if required services are configured
 * @returns {Object} Service configuration status
 */
function checkServiceConfiguration() {
  const config = {
    twitch: {
      api: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN),
      chat: !!(process.env.TWITCH_BOT_USERNAME && process.env.TWITCH_BOT_OAUTH),
      ready: false
    },
    youtube: {
      api: !!process.env.YOUTUBE_API_KEY,
      oauth: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      liveChat: false,
      ready: false
    }
  };

  // Twitch is ready if API is configured
  config.twitch.ready = config.twitch.api;

  // YouTube live chat requires both API key and OAuth
  config.youtube.liveChat = config.youtube.api && config.youtube.oauth;
  config.youtube.ready = config.youtube.api; // Basic YouTube functionality

  return config;
}

/**
 * Validate Twitch token format
 * @param {string} token - Twitch access token
 * @returns {boolean} True if format is valid
 */
function validateTwitchTokenFormat(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }
  
  // Twitch tokens are typically 30 characters, alphanumeric
  return /^[a-zA-Z0-9]{20,50}$/.test(token);
}

/**
 * Validate YouTube API key format
 * @param {string} apiKey - YouTube API key
 * @returns {boolean} True if format is valid
 */
function validateYouTubeApiKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }
  
  // YouTube API keys typically start with AIza and are 39 characters
  return /^AIza[a-zA-Z0-9_-]{35}$/.test(apiKey);
}

/**
 * Get configuration warnings for optional but recommended settings
 * @returns {Array} Array of warning messages
 */
function getConfigurationWarnings() {
  const warnings = [];
  
  // Check for bot credentials
  if (!process.env.TWITCH_BOT_USERNAME || !process.env.TWITCH_BOT_OAUTH) {
    warnings.push('Twitch bot credentials not configured. Chat posting will use the main account.');
  }
  
  // Check for YouTube configuration
  if (!process.env.YOUTUBE_API_KEY) {
    warnings.push('YouTube API key not configured. YouTube functionality will be disabled.');
  } else if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    warnings.push('YouTube OAuth credentials not configured. Live chat posting will be disabled.');
  }
  
  // Check for channel configuration
  if (!process.env.YOUTUBE_CHANNEL_ID) {
    warnings.push('YouTube channel ID not configured. Some features may not work properly.');
  }
  
  // Check token formats
  if (process.env.TWITCH_ACCESS_TOKEN && !validateTwitchTokenFormat(process.env.TWITCH_ACCESS_TOKEN)) {
    warnings.push('Twitch access token format appears invalid. Please verify your token.');
  }
  
  if (process.env.YOUTUBE_API_KEY && !validateYouTubeApiKeyFormat(process.env.YOUTUBE_API_KEY)) {
    warnings.push('YouTube API key format appears invalid. Please verify your API key.');
  }
  
  // Check for production settings
  if (process.env.NODE_ENV === 'production') {
    if (process.env.LOG_LEVEL === 'debug') {
      warnings.push('Debug logging enabled in production. Consider changing LOG_LEVEL to "info" or "warn".');
    }
    
    if (!process.env.LOG_TO_FILE) {
      warnings.push('File logging not enabled in production. Consider setting LOG_TO_FILE=true.');
    }
  }
  
  return warnings;
}

/**
 * Generate sample .env file content
 * @returns {string} Sample .env file content
 */
function generateSampleEnv() {
  return `# MultiStream Clipper Configuration
# Copy this file to .env and fill in your actual values

# Server Configuration
PORT=3000
NODE_ENV=development

# Twitch API Configuration (REQUIRED)
# Get these from: https://dev.twitch.tv/console/apps
TWITCH_CLIENT_ID=your_twitch_client_id_here
TWITCH_CLIENT_SECRET=your_twitch_client_secret_here
TWITCH_ACCESS_TOKEN=your_twitch_access_token_here

# Twitch Bot Account (OPTIONAL - for chat posting)
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_BOT_OAUTH=oauth:your_bot_oauth_token

# YouTube API Configuration (OPTIONAL)
# Get these from: https://console.cloud.google.com/
YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_CLIENT_ID=your_youtube_client_id_here
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret_here
YOUTUBE_CHANNEL_ID=your_youtube_channel_id
YOUTUBE_LIVE_STREAM_ID=your_live_stream_id

# Application Settings
DEFAULT_CLIP_DURATION=30
CLIP_MESSAGE_TEMPLATE="🎬 Check out this clip! {url}"
RATE_LIMIT_REQUESTS_PER_MINUTE=30

# Logging Configuration
LOG_LEVEL=info
DEBUG_MODE=false
LOG_TO_FILE=false

# WebSocket Configuration
WEBSOCKET_PORT=3001
`;
}

/**
 * Print configuration status to console
 */
function printConfigurationStatus() {
  console.log('\n=== MultiStream Clipper Configuration Status ===');
  
  try {
    validateConfig();
    console.log('✅ Configuration validation passed');
  } catch (error) {
    console.log('❌ Configuration validation failed:');
    console.log(error.message);
    return;
  }
  
  const services = checkServiceConfiguration();
  
  console.log('\n📡 Service Configuration:');
  console.log(`  Twitch API: ${services.twitch.ready ? '✅' : '❌'} ${services.twitch.api ? '(API configured)' : '(API not configured)'}`);
  console.log(`  Twitch Chat: ${services.twitch.chat ? '✅' : '⚠️'} ${services.twitch.chat ? '(Bot configured)' : '(Using main account)'}`);
  console.log(`  YouTube API: ${services.youtube.ready ? '✅' : '❌'} ${services.youtube.api ? '(API configured)' : '(API not configured)'}`);
  console.log(`  YouTube Live Chat: ${services.youtube.liveChat ? '✅' : '❌'} ${services.youtube.liveChat ? '(OAuth configured)' : '(OAuth not configured)'}`);
  
  const warnings = getConfigurationWarnings();
  if (warnings.length > 0) {
    console.log('\n⚠️  Configuration Warnings:');
    warnings.forEach(warning => console.log(`  • ${warning}`));
  }
  
  console.log('\n=== Configuration Check Complete ===\n');
}

module.exports = {
  validateConfig,
  checkServiceConfiguration,
  validateTwitchTokenFormat,
  validateYouTubeApiKeyFormat,
  getConfigurationWarnings,
  generateSampleEnv,
  printConfigurationStatus,
  configSchema
};
