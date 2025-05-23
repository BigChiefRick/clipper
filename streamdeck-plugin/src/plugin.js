/// <reference path="../node_modules/@elgato/streamdeck/types/index.d.ts" />

// MultiStream Clipper Stream Deck Plugin
class MultiStreamClipperPlugin {
  constructor() {
    this.websocket = null;
    this.backendUrl = 'ws://localhost:3001';
    this.httpUrl = 'http://localhost:3000';
    this.connectionRetries = 0;
    this.maxRetries = 5;
    this.retryInterval = 2000;
    this.isConnected = false;
    
    // Track active contexts and their states
    this.activeContexts = new Map();
    
    // Initialize WebSocket connection
    this.initializeConnection();
  }

  // Initialize WebSocket connection to backend
  initializeConnection() {
    try {
      this.websocket = new WebSocket(this.backendUrl);
      
      this.websocket.onopen = () => {
        console.log('Connected to MultiStream Clipper backend');
        this.isConnected = true;
        this.connectionRetries = 0;
        
        // Update all active contexts with connected status
        this.updateAllContextsStatus('connected');
      };
      
      this.websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleBackendMessage(data);
        } catch (error) {
          console.error('Error parsing backend message:', error);
        }
      };
      
      this.websocket.onclose = () => {
        console.log('Disconnected from MultiStream Clipper backend');
        this.isConnected = false;
        this.updateAllContextsStatus('disconnected');
        this.scheduleReconnect();
      };
      
      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.updateAllContextsStatus('error');
      };
      
    } catch (error) {
      console.error('Failed to initialize WebSocket connection:', error);
      this.scheduleReconnect();
    }
  }

  // Schedule reconnection attempt
  scheduleReconnect() {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      console.log(`Reconnection attempt ${this.connectionRetries}/${this.maxRetries} in ${this.retryInterval}ms`);
      
      setTimeout(() => {
        this.initializeConnection();
      }, this.retryInterval);
      
      // Exponential backoff
      this.retryInterval = Math.min(this.retryInterval * 1.5, 30000);
    } else {
      console.error('Max reconnection attempts reached');
      this.updateAllContextsStatus('failed');
    }
  }

  // Handle messages from backend
  handleBackendMessage(data) {
    const { type, success, error, stage, clipUrl } = data;
    
    switch (type) {
      case 'connected':
        console.log('Backend connected:', data.message);
        break;
        
      case 'status':
        this.updateActiveContextsStatus(stage, data.message);
        break;
        
      case 'clip-created':
        this.handleClipCreated(data);
        break;
        
      case 'connection-test':
        this.handleConnectionTest(data);
        break;
        
      case 'error':
        console.error('Backend error:', error);
        this.updateAllContextsStatus('error', error);
        break;
        
      default:
        console.log('Unknown message type:', type, data);
    }
  }

  // Handle clip creation response
  handleClipCreated(data) {
    const { success, error, clipUrl, clipId } = data;
    
    if (success) {
      console.log('Clip created successfully:', clipUrl);
      this.updateAllContextsStatus('success', 'Clip Created!');
      
      // Show success state briefly, then return to default
      setTimeout(() => {
        this.updateAllContextsStatus('ready');
      }, 3000);
      
      // Show notification with clip URL
      this.showNotification('Clip created successfully!', clipUrl);
      
    } else {
      console.error('Clip creation failed:', error);
      this.updateAllContextsStatus('error', error);
      
      // Return to ready state after showing error
      setTimeout(() => {
        this.updateAllContextsStatus('ready');
      }, 5000);
      
      this.showNotification('Clip creation failed', error);
    }
  }

  // Handle connection test response
  handleConnectionTest(data) {
    const { success, data: testData } = data;
    
    if (success) {
      const twitchStatus = testData.twitch?.overall?.success ? '✅' : '❌';
      const youtubeStatus = testData.youtube?.overall?.success ? '✅' : '❌';
      
      this.updateAllContextsStatus('test-result', `Twitch ${twitchStatus} YouTube ${youtubeStatus}`);
      
      // Return to ready state
      setTimeout(() => {
        this.updateAllContextsStatus('ready');
      }, 3000);
      
    } else {
      this.updateAllContextsStatus('error', 'Connection test failed');
      setTimeout(() => {
        this.updateAllContextsStatus('ready');
      }, 3000);
    }
  }

  // Update status for all active contexts
  updateAllContextsStatus(status, message = '') {
    this.activeContexts.forEach((contextInfo, context) => {
      this.updateContextStatus(context, contextInfo.action, status, message);
    });
  }

  // Update status for contexts with specific action
  updateActiveContextsStatus(status, message = '') {
    this.activeContexts.forEach((contextInfo, context) => {
      if (contextInfo.action === 'create-clip') {
        this.updateContextStatus(context, contextInfo.action, status, message);
      }
    });
  }

  // Update individual context status
  updateContextStatus(context, action, status, message = '') {
    let title, image;
    
    switch (status) {
      case 'connected':
        title = 'Ready';
        image = action === 'create-clip' ? 'images/clipper-ready' : 'images/test-ready';
        break;
        
      case 'disconnected':
        title = 'Offline';
        image = 'images/offline';
        break;
        
      case 'creating':
        title = 'Creating...';
        image = 'images/clipper-creating';
        break;
        
      case 'posting':
        title = 'Posting...';
        image = 'images/clipper-posting';
        break;
        
      case 'success':
        title = message || 'Success!';
        image = 'images/success';
        break;
        
      case 'error':
        title = 'Error';
        image = 'images/error';
        break;
        
      case 'test-result':
        title = message;
        image = 'images/test-result';
        break;
        
      case 'ready':
      default:
        title = action === 'create-clip' ? 'Clip' : 'Test';
        image = action === 'create-clip' ? 'images/clipper-default' : 'images/test-default';
        break;
    }
    
    // Update button appearance
    $SD.setTitle(context, title);
    $SD.setImage(context, image);
  }

  // Send message to backend
  sendToBackend(message) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(message));
      return true;
    } else {
      console.error('WebSocket not connected');
      this.updateAllContextsStatus('disconnected');
      return false;
    }
  }

  // Show notification to user
  showNotification(title, message = '') {
    if (typeof $SD !== 'undefined' && $SD.showAlert) {
      $SD.showAlert(context);
    }
    
    // Log for debugging
    console.log(`Notification: ${title} - ${message}`);
  }

  // Validate settings
  validateSettings(settings) {
    const errors = [];
    
    if (!settings.channelName || settings.channelName.trim() === '') {
      errors.push('Channel name is required');
    }
    
    const duration = parseInt(settings.clipDuration) || 30;
    if (duration < 5 || duration > 60) {
      errors.push('Clip duration must be between 5 and 60 seconds');
    }
    
    return errors;
  }

  // Handle key down events
  onKeyDown(context, settings, coordinates, userDesiredState) {
    const action = this.activeContexts.get(context)?.action;
    
    if (!this.isConnected) {
      this.updateContextStatus(context, action, 'disconnected');
      this.showNotification('Backend not connected', 'Please ensure the backend service is running');
      return;
    }
    
    switch (action) {
      case 'create-clip':
        this.handleCreateClip(context, settings);
        break;
        
      case 'test-connection':
        this.handleTestConnection(context, settings);
        break;
        
      default:
        console.warn('Unknown action:', action);
    }
  }

  // Handle clip creation
  handleCreateClip(context, settings) {
    // Validate settings
    const errors = this.validateSettings(settings);
    if (errors.length > 0) {
      this.updateContextStatus(context, 'create-clip', 'error', errors[0]);
      this.showNotification('Configuration Error', errors.join(', '));
      
      setTimeout(() => {
        this.updateContextStatus(context, 'create-clip', 'ready');
      }, 3000);
      return;
    }
    
    // Update status
    this.updateContextStatus(context, 'create-clip', 'creating');
    
    // Send clip creation request
    const message = {
      type: 'create-clip',
      payload: {
        channelName: settings.channelName.trim(),
        duration: parseInt(settings.clipDuration) || 30,
        title: settings.clipTitle || null,
        platforms: {
          twitch: settings.enableTwitch !== false,
          youtube: settings.enableYoutube !== false
        }
      }
    };
    
    if (!this.sendToBackend(message)) {
      this.updateContextStatus(context, 'create-clip', 'error', 'Connection failed');
    }
  }

  // Handle connection test
  handleTestConnection(context, settings) {
    this.updateContextStatus(context, 'test-connection', 'creating', 'Testing...');
    
    const message = {
      type: 'test-connection',
      payload: {
        channelName: settings.channelName?.trim() || null
      }
    };
    
    if (!this.sendToBackend(message)) {
      this.updateContextStatus(context, 'test-connection', 'error', 'Connection failed');
    }
  }

  // Handle when action appears
  onWillAppear(context, settings, coordinates, actionInfo) {
    const action = actionInfo.action.split('.').pop(); // Extract action name from UUID
    
    this.activeContexts.set(context, {
      action: action,
      settings: settings,
      coordinates: coordinates
    });
    
    // Set initial state
    if (this.isConnected) {
      this.updateContextStatus(context, action, 'ready');
    } else {
      this.updateContextStatus(context, action, 'disconnected');
    }
    
    console.log(`Action ${action} appeared at context ${context}`);
  }

  // Handle when action disappears
  onWillDisappear(context, settings, coordinates, actionInfo) {
    this.activeContexts.delete(context);
    console.log(`Action disappeared at context ${context}`);
  }

  // Handle settings updates
  onDidReceiveSettings(context, settings, coordinates, actionInfo) {
    const contextInfo = this.activeContexts.get(context);
    if (contextInfo) {
      contextInfo.settings = settings;
      this.activeContexts.set(context, contextInfo);
    }
    
    console.log('Settings updated for context:', context, settings);
  }

  // Handle property inspector events
  onSendToPlugin(context, action, payload, deviceId) {
    console.log('Received from property inspector:', payload);
    
    switch (payload.event) {
      case 'testConnection':
        this.handleTestConnection(context, payload.settings || {});
        break;
        
      case 'validateSettings':
        const errors = this.validateSettings(payload.settings || {});
        $SD.sendToPropertyInspector(context, {
          event: 'validationResult',
          errors: errors
        }, action);
        break;
        
      default:
        console.warn('Unknown property inspector event:', payload.event);
    }
  }
}

// Initialize plugin
const clipperPlugin = new MultiStreamClipperPlugin();

// Set up Stream Deck event handlers
$SD.onConnected = (jsonObj) => {
  console.log('Stream Deck connected');
};

$SD.onKeyDown = (context, settings, coordinates, userDesiredState, actionInfo) => {
  clipperPlugin.onKeyDown(context, settings, coordinates, userDesiredState);
};

$SD.onWillAppear = (context, settings, coordinates, actionInfo) => {
  clipperPlugin.onWillAppear(context, settings, coordinates, actionInfo);
};

$SD.onWillDisappear = (context, settings, coordinates, actionInfo) => {
  clipperPlugin.onWillDisappear(context, settings, coordinates, actionInfo);
};

$SD.onDidReceiveSettings = (context, settings, coordinates, actionInfo) => {
  clipperPlugin.onDidReceiveSettings(context, settings, coordinates, actionInfo);
};

$SD.onSendToPlugin = (context, action, payload, deviceId) => {
  clipperPlugin.onSendToPlugin(context, action, payload, deviceId);
};
