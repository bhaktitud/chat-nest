# NestJS Chat Engine

A real-time chat application built with NestJS and Socket.IO.

## Features

- Real-time messaging with Socket.IO
- Room-based chat system
  - Join existing rooms
  - Create new custom rooms
- User presence tracking
  - Online/offline status indicators
  - Typing indicators
- Message queue system
  - Message persistence in MongoDB
  - Message history with timestamps
  - Date-based message grouping
- Database Integration
  - MongoDB for data persistence
  - Automatic data cleanup
  - Schema-based data models
- Clean, responsive UI

## Technologies Used

- NestJS - A progressive Node.js framework for building efficient and scalable server-side applications
- Socket.IO - Enables real-time, bidirectional and event-based communication
- MongoDB - NoSQL database for storing messages, rooms, and user data
- Mongoose - MongoDB object modeling for Node.js
- HTML/CSS/JavaScript - Frontend client

## Installation

```bash
# Clone the repository
git clone <your-repository-url>

# Navigate to the project directory
cd chat-engine-app

# Install dependencies
npm install
```

## Configuration

Create a MongoDB database and update the connection string in `src/config/config.service.ts`:

```typescript
private readonly envConfig: { [key: string]: string };

constructor() {
  this.envConfig = {
    // Replace YOUR_PASSWORD with your actual MongoDB password
    MONGODB_URI: 'mongodb+srv://myforework:YOUR_PASSWORD@cluster0.ce1aj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    DATABASE_NAME: 'chat_engine',
  };
}
```

## Troubleshooting

### Missing Schema Files
If you encounter TypeScript errors about missing schema files:

```
Cannot find module '../schemas/message.schema' or its corresponding type declarations
```

Make sure the schema files exist in the `src/chat/schemas` directory. The application uses three schema files:
- `message.schema.ts`
- `room.schema.ts`
- `user.schema.ts`

If necessary, create the directory and files with their appropriate content.

### MongoDB Connection
If the application fails to connect to MongoDB:

1. Verify your MongoDB password in the connection string
2. Check that your IP address is allowed in the MongoDB Atlas Network Access settings
3. Ensure the database name 'chat_engine' is correctly specified

## Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run start:prod
```

The application will be running at http://localhost:3000.

## How to Use

### Joining a Room
1. Open your browser and go to http://localhost:3000
2. Select "Join Room" tab
3. Enter your username and select a chat room
4. Click "Join Chat" to enter the chat room

### Creating a Room
1. Open your browser and go to http://localhost:3000
2. Select "Create Room" tab
3. Enter your username
4. Enter a unique room ID (lowercase letters, numbers, and hyphens only)
5. Enter a display name for the room
6. Click "Create & Join Room"

### Chatting
1. Type messages in the input field and press "Send" or hit Enter
2. View connected users in the sidebar with their status indicators
3. See when other users are typing
4. Click "Leave Room" to exit the chat

### Message History
1. When you join a room, you'll see recent messages
2. Click "Show message history" to view all messages organized by date
3. Click "Hide message history" to return to the recent messages view

## Real-time Events

The application implements several real-time events for enhanced user experience:

- **Typing Indicator**: Users see when others are typing messages
- **Online Status**: Green dot for online users, gray for offline
- **Room Creation**: New rooms are immediately available to all users
- **User Join/Leave Notifications**: System messages when users enter or leave
- **Message Persistence**: Messages are stored in MongoDB and sent to new users

## Message Queue System

The chat engine includes a message queue system with the following features:

- **Message Storage**: Messages are stored in MongoDB
- **Message History**: Users can access previous messages when joining a room
- **Date Organization**: Messages are grouped by date for easy browsing
- **Automatic Cleanup**: Only the most recent messages are kept (configurable limit)
- **Timestamps**: All messages include timestamps for reference

## Database Schema

The application uses Mongoose schemas for data modeling:

- **User**: Stores user information and status
  - userId: Unique identifier
  - username: Display name
  - room: Current room
  - isOnline: Online status
  - isTyping: Typing status
  - lastActive: Last activity timestamp

- **Room**: Stores room information
  - roomId: Unique identifier
  - name: Display name
  - createdBy: Creator's username
  - createdAt: Creation timestamp

- **Message**: Stores chat messages
  - messageId: Unique identifier
  - user: Sender's username
  - text: Message content
  - room: Associated room
  - timestamp: Message time
  - isSystem: Flag for system messages

## Project Structure

```
chat-engine-app/
├── src/
│   ├── chat/           # Chat module
│   │   ├── chat.module.ts    # Module definition
│   │   ├── chat/             # Chat implementation
│   │   │   ├── chat.gateway.ts   # Socket.IO gateway
│   │   │   └── chat.service.ts   # Business logic
│   │   └── schemas/          # MongoDB schemas
│   │       ├── message.schema.ts # Message model
│   │       ├── room.schema.ts    # Room model
│   │       └── user.schema.ts    # User model
│   ├── config/         # Configuration module
│   │   ├── config.module.ts  # Module definition
│   │   └── config.service.ts # Configuration service
│   ├── database/       # Database module
│   │   └── database.module.ts # MongoDB connection
│   ├── app.module.ts   # Main application module
│   └── main.ts         # Application entry point
├── public/             # Static files
│   └── index.html      # Chat client
└── ...
```

## License

MIT
