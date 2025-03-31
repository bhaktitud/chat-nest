import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { Logger, Injectable } from '@nestjs/common';
import {
  JoinRoomDto,
  CreateRoomDto,
  MessageDto,
  TypingDto,
  RoomIdDto,
} from '../dto/chat.dto';
import { RoomData, UserTyping } from '../interfaces/chat.interfaces';
import { v4 as uuidv4 } from 'uuid';

// Add rate limiting related code
interface RateLimitInfo {
  count: number;
  firstRequest: number;
  blocked: boolean;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private heartbeatInterval = 30000; // 30 seconds
  private heartbeatTimeout = 10000; // 10 seconds
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();

  // Rate limiting config
  private messageLimits: Map<string, RateLimitInfo> = new Map();
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute in ms
  private readonly RATE_LIMIT_MAX_MESSAGES = 30; // Max 30 messages per minute
  private readonly RATE_LIMIT_BLOCK_DURATION = 120000; // 2 minutes block if exceeded

  constructor(private readonly chatService: ChatService) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');

    // Start heartbeat interval
    setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    // Setup heartbeat check for this client
    this.setupHeartbeatCheck(client);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const user = this.chatService.getUserBySocketId(client.id);

    // Clear any heartbeat timers
    this.clearHeartbeatTimer(client.id);

    if (user) {
      try {
        // Handle user leaving the room and going offline
        const removedUser = await this.chatService.removeUser(user.id);
        if (removedUser) {
          // Notify other users in the room
          this.server.to(user.room).emit('message', {
            id: uuidv4(),
            user: 'system',
            text: `${user.username} has left the chat`,
            room: user.room,
            timestamp: new Date(),
            isSystem: true,
          });

          // Send updated user list to clients
          const usersInRoom = this.chatService.getUsersInRoom(user.room);
          this.server.to(user.room).emit('roomData', {
            room: user.room,
            users: usersInRoom,
          } as RoomData);
        }
      } catch (err) {
        const error = err as Error;
        this.logger.error(`Error in handleDisconnect: ${error.message}`);
      }
    }
  }

  /**
   * Send heartbeat ping to all clients
   */
  private sendHeartbeat() {
    this.logger.debug('Sending heartbeat to all clients');
    this.server.emit('ping');
  }

  /**
   * Setup heartbeat check for a client
   */
  private setupHeartbeatCheck(client: Socket) {
    // Clear any existing timer
    this.clearHeartbeatTimer(client.id);

    // Set up pong listener
    client.on('pong', () => {
      this.clearHeartbeatTimer(client.id);
      this.logger.debug(`Received pong from client: ${client.id}`);
    });

    // Set timeout for this client
    const timer = setTimeout(() => {
      this.logger.warn(`Client ${client.id} heartbeat timeout - disconnecting`);
      client.disconnect(true);
    }, this.heartbeatTimeout);

    this.heartbeatTimers.set(client.id, timer);
  }

  /**
   * Clear heartbeat timer for a client
   */
  private clearHeartbeatTimer(clientId: string) {
    const timer = this.heartbeatTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.heartbeatTimers.delete(clientId);
    }
  }

  @SubscribeMessage('pong')
  handlePong(@ConnectedSocket() client: Socket) {
    // When we receive a pong from client, reset their heartbeat timer
    this.setupHeartbeatCheck(client);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomDto,
  ) {
    try {
      const { roomId, username } = payload;

      if (!roomId || !username) {
        client.emit('error', { message: 'Room ID and username are required.' });
        return;
      }

      // Add user
      await this.chatService.addUser({
        id: client.id,
        username,
        room: roomId,
        isOnline: true,
        isTyping: false,
        socketId: client.id, // Store the socket ID with the user
      });

      // Join the room
      client.join(roomId);

      // Notify the room that the user has joined
      // const joinMessage = await this.chatService.addSystemMessage(
      //   roomId,
      //   `${username} has joined the chat.`,
      // );

      // this.server.to(roomId).emit('message', {
      //   id: joinMessage.id,
      //   user: joinMessage.user,
      //   text: joinMessage.text,
      //   timestamp: joinMessage.timestamp,
      //   isSystem: joinMessage.isSystem,
      // });

      // Send recent messages history to the user
      const messageHistory = await this.chatService.getMessageHistory(roomId);
      client.emit('messageHistory', messageHistory);

      // Send current users in the room to everyone
      const roomUsers = this.chatService.getUsersInRoom(roomId);
      this.server.to(roomId).emit('roomData', {
        room: roomId,
        users: roomUsers,
      } as RoomData);
    } catch (error) {
      this.logger.error('Error in handleJoin:', error);
      client.emit('error', {
        message: 'An error occurred while joining the room.',
      });
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessageDto,
  ) {
    const user = this.chatService.getUserBySocketId(client.id);

    if (!user) {
      client.emit('error', { message: 'User not found' });
      return;
    }

    // Check rate limiting
    if (this.isRateLimited(user.id)) {
      client.emit('error', {
        message:
          'You are sending messages too quickly. Please wait before sending more messages.',
      });
      return;
    }

    try {
      this.logger.debug('Received message:', payload);
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user) {
        this.logger.error('User not found for socket ID:', client.id);
        return;
      }

      // Reset typing status when message is sent
      await this.chatService.setUserTypingStatus(client.id, false);

      // Notify room about typing status change
      client.to(user.room).emit('userTyping', {
        userId: client.id,
        username: user.username,
        isTyping: false,
      } as UserTyping);

      // Add message to queue
      const newMessage = await this.chatService.addMessage({
        user: user.username,
        text: payload.message,
        room: user.room,
        isSystem: false,
      });

      this.logger.debug('Sending message to room:', user.room, newMessage);

      // Broadcast message to the room
      this.server.to(user.room).emit('message', {
        id: newMessage.id,
        user: newMessage.user,
        text: newMessage.text,
        timestamp: newMessage.timestamp,
        isSystem: newMessage.isSystem,
      });
    } catch (error) {
      this.logger.error('Error handling message:', error);
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TypingDto,
  ) {
    try {
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user) {
        this.logger.error('User not found for socket ID:', client.id);
        return;
      }

      // Update typing status
      await this.chatService.setUserTypingStatus(client.id, payload.isTyping);

      // Broadcast to room (except sender)
      client.to(user.room).emit('userTyping', {
        userId: client.id,
        username: user.username,
        isTyping: payload.isTyping,
      } as UserTyping);
    } catch (error) {
      this.logger.error('Error handling typing event:', error);
    }
  }

  @SubscribeMessage('createRoom')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateRoomDto,
  ) {
    try {
      // Use getUserBySocketId instead of getUser
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user) {
        this.logger.log(
          'User not found when creating room, client ID:',
          client.id,
        );

        // Get username from client
        const username = payload.roomId?.split('-')[0] || 'Anonymous';

        // Add a temporary user for the room creation
        await this.chatService.addUser({
          id: client.id,
          username,
          room: 'lobby',
          isOnline: true,
          isTyping: false,
          socketId: client.id,
        });

        client.emit('error', {
          message: 'Please join a room first',
        });
        return;
      }

      // Create room - with the correct parameter structure
      const newRoom = await this.chatService.createRoom({
        roomId: payload.roomId.toLowerCase().replace(/\s+/g, '-'),
        roomName: payload.roomName,
        createdBy: user.username,
      });

      // Broadcast new room to all connected clients
      this.server.emit('roomCreated', newRoom);

      // Send updated rooms list
      const rooms = await this.chatService.getAllRooms();
      this.server.emit('availableRooms', rooms);

      // Confirm to creator
      client.emit('roomCreateSuccess', newRoom);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      client.emit('error', {
        message: errorMessage,
      });
    }
  }

  @SubscribeMessage('getRooms')
  async handleGetRooms(@ConnectedSocket() client: Socket) {
    try {
      const rooms = await this.chatService.getAllRooms();
      client.emit('availableRooms', rooms);
    } catch (error) {
      this.logger.error('Error fetching rooms:', error);
      client.emit('error', { message: 'Error fetching rooms' });
    }
  }

  @SubscribeMessage('getMessageHistory')
  async handleGetMessageHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RoomIdDto,
  ) {
    try {
      const messageHistory = await this.chatService.getMessagesForRoom(
        payload.room,
      );
      client.emit('messageHistory', messageHistory);
    } catch (error) {
      this.logger.error('Error fetching message history:', error);
      client.emit('error', { message: 'Error fetching message history' });
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId: string,
  ) {
    try {
      // Get the user associated with this socket
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user || !roomId) {
        return; // Silently fail if no user or room ID
      }

      // Leave the Socket.io room (not a Promise, so no await)
      client.leave(roomId);

      // Send a message that the user has left the chat
      // const systemMessage: SystemMessage = {
      //   user: {
      //     id: 'system',
      //     username: 'System',
      //   },
      //   text: `${user.username} has left the chat.`,
      //   timestamp: new Date().toISOString(),
      //   type: 'system',
      // };

      // this.server.to(roomId).emit('message', systemMessage);

      // Get updated users in the room and broadcast
      const usersInRoom = this.chatService.getUsersInRoom(roomId);
      const updatedUsers = usersInRoom.filter((u) => u.id !== user.id);

      this.server.to(roomId).emit('roomData', {
        room: roomId,
        users: updatedUsers,
      } as RoomData);

      // Update the user's status without removing them completely
      // This keeps their connection alive but removes them from the room
      await this.chatService.removeUserFromRoom(user.id, roomId);
    } catch (error) {
      this.logger.error('Error in handleLeaveRoom:', error);
    }
  }

  /**
   * Check if a user is rate limited
   */
  private isRateLimited(userId: string): boolean {
    const now = Date.now();

    // Check if user is currently in a blocked state
    const userLimit = this.messageLimits.get(userId);
    if (userLimit?.blocked) {
      // Check if block duration has expired
      if (now - userLimit.firstRequest > this.RATE_LIMIT_BLOCK_DURATION) {
        // Reset rate limit for this user
        this.messageLimits.set(userId, {
          count: 1,
          firstRequest: now,
          blocked: false,
        });
        return false;
      }
      return true;
    }

    if (!userLimit) {
      // First message from this user
      this.messageLimits.set(userId, {
        count: 1,
        firstRequest: now,
        blocked: false,
      });
      return false;
    }

    // Check if the rate limit window has expired
    if (now - userLimit.firstRequest > this.RATE_LIMIT_WINDOW) {
      // Reset counter for new window
      this.messageLimits.set(userId, {
        count: 1,
        firstRequest: now,
        blocked: false,
      });
      return false;
    }

    // Increment counter
    userLimit.count++;

    // Check if user has exceeded rate limit
    if (userLimit.count > this.RATE_LIMIT_MAX_MESSAGES) {
      userLimit.blocked = true;
      this.logger.warn(
        `Rate limit exceeded for user ${userId}. Blocking for ${this.RATE_LIMIT_BLOCK_DURATION / 1000} seconds.`,
      );
      return true;
    }

    return false;
  }
}
