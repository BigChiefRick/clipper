# MultiStream Clipper

A Stream Deck plugin that creates Twitch clips and automatically posts them to both Twitch and YouTube live chats for multi-streaming teams.

## Features

- 🎮 One-click clipping via Stream Deck
- 📺 Auto-post clips to Twitch chat
- 🔄 Cross-post clips to YouTube live chat
- 👥 Multi-streamer team support
- ⚡ Real-time clip creation and sharing

## Project Structure

```
multistream-clipper/
├── streamdeck-plugin/          # Stream Deck plugin files
│   ├── manifest.json          # Plugin manifest
│   ├── property-inspector/     # Settings UI
│   └── src/                   # Plugin source code
├── backend/                   # Backend service
│   ├── src/
│   │   ├── twitch-api.js     # Twitch API handlers
│   │   ├── youtube-api.js    # YouTube API handlers
│   │   └── server.js         # Main server
│   └── package.json
├── docs/                      # Documentation
└── README.md
```

## Setup & Installation

### Prerequisites
- Stream Deck software installed
- Node.js 18+ for backend service
- Twitch Developer Account
- YouTube API credentials

### Backend Setup
1. Clone the repository
2. Navigate to the `backend` directory
3. Install dependencies: `npm install`
4. Create `.env` file with your API credentials
5. Start the service: `npm start`

### Stream Deck Plugin Setup
1. Copy plugin folder to Stream Deck plugins directory
2. Restart Stream Deck software
3. Configure your Twitch/YouTube credentials in plugin settings

## Configuration

### Required API Credentials
- **Twitch**: Client ID, Client Secret, OAuth Token
- **YouTube**: API Key, OAuth 2.0 credentials

### Environment Variables
```env
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_OAUTH_TOKEN=your_oauth_token
YOUTUBE_API_KEY=your_api_key
YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
PORT=3000
```

## Usage

1. Add the "MultiStream Clipper" action to your Stream Deck
2. Configure your streaming channels in the plugin settings
3. Press the button during your stream to create and share clips
4. Clips will automatically post to both Twitch and YouTube chats

## Development Roadmap

- [ ] Basic Twitch clip creation
- [ ] Stream Deck plugin foundation
- [ ] Twitch chat posting
- [ ] YouTube live chat integration
- [ ] Error handling and retry logic
- [ ] Multi-account support
- [ ] Clip duration customization
- [ ] Custom message templates

## Contributing

We welcome contributions! Please feel free to submit issues, feature requests, or pull requests.

## API Documentation

### Twitch API Endpoints
- Create Clip: `POST https://api.twitch.tv/helix/clips`
- Chat via IRC: `irc://irc.chat.twitch.tv:6667`

### YouTube API Endpoints  
- Live Chat: `POST https://www.googleapis.com/youtube/v3/liveChat/messages`

## License

MIT License - feel free to use and modify for your streaming setup!

## Support

If you run into issues or have questions, please open an issue on GitHub or reach out to the development team.
