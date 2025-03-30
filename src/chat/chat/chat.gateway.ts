import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    try {
      console.log(`Client disconnected: ${client.id}`);
      const user = this.chatService.getUser(client.id);

      if (user && user.room) {
        // Set user as offline
        await this.chatService.setUserOnlineStatus(client.id, false);

        // Notify room that user went offline
        this.server.to(user.room).emit('userStatus', {
          userId: client.id,
          username: user.username,
          isOnline: false,
        });

        // Add system message about the user leaving
        try {
          const leaveMessage = await this.chatService.addSystemMessage(
            user.room,
            `${user.username} has left the chat.`,
          );

          // Broadcast the leave message
          this.server.to(user.room).emit('message', {
            id: leaveMessage.id,
            user: leaveMessage.user,
            text: leaveMessage.text,
            timestamp: leaveMessage.timestamp,
            isSystem: leaveMessage.isSystem,
          });
        } catch (error) {
          console.error('Error sending leave message:', error);
        }

        // Update room data
        this.server.to(user.room).emit('roomData', {
          room: user.room,
          users: this.chatService
            .getUsersInRoom(user.room)
            .filter((u) => u.id !== client.id),
        });
      }

      // Finally remove user from our storage when they're fully disconnected
      await this.chatService.removeUser(client.id);
    } catch (error) {
      console.error('Error in handleDisconnect:', error);
    }
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; username: string },
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
      const joinMessage = await this.chatService.addSystemMessage(
        roomId,
        `${username} has joined the chat.`,
      );

      this.server.to(roomId).emit('message', {
        id: joinMessage.id,
        user: joinMessage.user,
        text: joinMessage.text,
        timestamp: joinMessage.timestamp,
        isSystem: joinMessage.isSystem,
      });

      // Send recent messages history to the user
      const messageHistory = await this.chatService.getMessageHistory(roomId);
      client.emit('messageHistory', messageHistory);

      // Send current users in the room to everyone
      const roomUsers = this.chatService.getUsersInRoom(roomId);
      this.server.to(roomId).emit('roomData', {
        room: roomId,
        users: roomUsers,
      });
    } catch (error) {
      console.error('Error in handleJoin:', error);
      client.emit('error', {
        message: 'An error occurred while joining the room.',
      });
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { message: string },
  ) {
    try {
      console.log('Received message:', payload);
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user) {
        console.error('User not found for socket ID:', client.id);
        return;
      }

      // Reset typing status when message is sent
      await this.chatService.setUserTypingStatus(client.id, false);

      // Notify room about typing status change
      client.to(user.room).emit('userTyping', {
        userId: client.id,
        username: user.username,
        isTyping: false,
      });

      // Add message to queue
      const newMessage = await this.chatService.addMessage({
        user: user.username,
        text: payload.message,
        room: user.room,
        isSystem: false,
      });

      console.log('Sending message to room:', user.room, newMessage);

      // Broadcast message to the room
      this.server.to(user.room).emit('message', {
        id: newMessage.id,
        user: newMessage.user,
        text: newMessage.text,
        timestamp: newMessage.timestamp,
        isSystem: newMessage.isSystem,
      });
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { isTyping: boolean },
  ) {
    try {
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user) {
        console.error('User not found for socket ID:', client.id);
        return;
      }

      // Update typing status
      await this.chatService.setUserTypingStatus(client.id, payload.isTyping);

      // Broadcast to room (except sender)
      client.to(user.room).emit('userTyping', {
        userId: client.id,
        username: user.username,
        isTyping: payload.isTyping,
      });
    } catch (error) {
      console.error('Error handling typing event:', error);
    }
  }

  @SubscribeMessage('createRoom')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; roomName: string },
  ) {
    try {
      // Use getUserBySocketId instead of getUser
      const user = this.chatService.getUserBySocketId(client.id);

      if (!user) {
        console.log('User not found when creating room, client ID:', client.id);

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

      // Create room
      const newRoom = await this.chatService.createRoom({
        id: payload.roomId.toLowerCase().replace(/\s+/g, '-'),
        name: payload.roomName,
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
      console.error('Error fetching rooms:', error);
      client.emit('error', { message: 'Error fetching rooms' });
    }
  }

  @SubscribeMessage('getMessageHistory')
  async handleGetMessageHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { room: string },
  ) {
    try {
      const messageHistory = await this.chatService.getMessagesForRoom(
        payload.room,
      );
      client.emit('messageHistory', messageHistory);
    } catch (error) {
      console.error('Error fetching message history:', error);
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
      const systemMessage = {
        user: {
          id: 'system',
          username: 'System',
        },
        text: `${user.username} has left the chat.`,
        timestamp: new Date().toISOString(),
        type: 'system',
      };

      this.server.to(roomId).emit('message', systemMessage);

      // Get updated users in the room and broadcast
      const usersInRoom = this.chatService.getUsersInRoom(roomId);
      const updatedUsers = usersInRoom.filter((u) => u.id !== user.id);

      this.server.to(roomId).emit('roomData', {
        room: roomId,
        users: updatedUsers,
      });

      // Update the user's status without removing them completely
      // This keeps their connection alive but removes them from the room
      await this.chatService.removeUserFromRoom(user.id, roomId);
    } catch (error) {
      console.error('Error in handleLeaveRoom:', error);
    }
  }
}
