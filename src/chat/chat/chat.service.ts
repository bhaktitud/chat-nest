import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from '../schemas/message.schema';
import { Room, RoomDocument } from '../schemas/room.schema';
import { User as UserSchema, UserDocument } from '../schemas/user.schema';
import { User, ChatRoom, ChatMessage } from '../interfaces/chat.interfaces';
import { QueueService } from '../queue/queue.service';
import * as xss from 'xss';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly MAX_MESSAGES_PER_ROOM = 50; // Set the limit for messages stored per room
  private users: User[] = []; // Keep users in memory for active sessions

  constructor(
    @InjectModel(UserSchema.name) private userModel: Model<UserDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private readonly queueService: QueueService,
  ) {
    // Initialize default rooms (but don't await it to avoid blocking)
    this.initializeDefaultRooms().catch((err) =>
      this.logger.error('Error initializing default rooms:', err),
    );
  }

  private async initializeDefaultRooms(): Promise<void> {
    const defaultRooms = [
      { id: 'general', name: 'General', createdBy: 'system' },
      { id: 'tech', name: 'Tech', createdBy: 'system' },
      { id: 'random', name: 'Random', createdBy: 'system' },
    ];

    for (const room of defaultRooms) {
      try {
        const existingRoom = await this.roomModel
          .findOne({ roomId: room.id })
          .exec();
        if (!existingRoom) {
          const newRoom = new this.roomModel({
            roomId: room.id,
            name: room.name,
            createdBy: room.createdBy,
            createdAt: new Date(),
          });
          await newRoom.save();

          // Create welcome message for the room
          await this.createSystemMessage(
            room.id,
            `Welcome to the ${room.name} room!`,
          );
          this.logger.log(`Created default room: ${room.name}`);
        }
      } catch (error) {
        this.logger.error(`Error creating room ${room.id}:`, error);
      }
    }
  }

  // Add sanitization helper
  private sanitizeInput(input: string): string {
    return xss.filterXSS(input);
  }

  async addUser(user: User): Promise<User> {
    // Sanitize user input
    const sanitizedUser = {
      ...user,
      username: this.sanitizeInput(user.username),
      room: this.sanitizeInput(user.room),
      isOnline: true,
      isTyping: false,
    };

    // Remove any existing user with the same socket ID to prevent duplicates
    const socketIdIndex = this.users.findIndex(
      (u) => u.socketId === sanitizedUser.socketId,
    );
    if (socketIdIndex !== -1) {
      this.logger.log(
        `Removing existing user with socketId ${sanitizedUser.socketId}`,
      );
      this.users.splice(socketIdIndex, 1);
    }

    // Check if this user (by username and room) already exists
    const existingUserIndex = this.users.findIndex(
      (u) =>
        u.username === sanitizedUser.username && u.room === sanitizedUser.room,
    );

    if (existingUserIndex !== -1) {
      // Update the existing user with the new socket ID
      this.users[existingUserIndex] = {
        ...this.users[existingUserIndex],
        socketId: sanitizedUser.socketId,
        id: sanitizedUser.id,
        isOnline: true,
      };

      this.logger.log(
        `Updated existing user (${sanitizedUser.username}) with new socketId: ${sanitizedUser.socketId}`,
      );

      // Update user in database
      try {
        await this.userModel
          .findOneAndUpdate(
            { userId: this.users[existingUserIndex].id },
            {
              isOnline: true,
              lastActive: new Date(),
              socketId: sanitizedUser.socketId,
            },
          )
          .exec();
      } catch (error) {
        this.logger.error('Error updating user online status:', error);
      }

      return this.users[existingUserIndex];
    }

    // Save user to database
    try {
      const dbUser = new this.userModel({
        userId: sanitizedUser.id,
        username: sanitizedUser.username,
        room: sanitizedUser.room,
        isOnline: true,
        isTyping: false,
        socketId: sanitizedUser.socketId,
        lastActive: new Date(),
      });
      await dbUser.save();
      this.logger.log(
        `Added new user: ${sanitizedUser.username} with socketId: ${sanitizedUser.socketId}`,
      );
    } catch (error) {
      this.logger.error('Error saving user to database:', error);
    }

    this.users.push(sanitizedUser);
    return sanitizedUser;
  }

  getUser(id: string): User | undefined {
    return this.users.find((user) => user.id === id);
  }

  async removeUser(id: string): Promise<User | undefined> {
    const index = this.users.findIndex((user) => user.id === id);

    if (index !== -1) {
      const removedUser = this.users.splice(index, 1)[0];

      // Update user in database
      try {
        await this.userModel
          .findOneAndUpdate(
            { userId: id },
            { isOnline: false, lastActive: new Date() },
          )
          .exec();
      } catch (error) {
        this.logger.error('Error updating user status on removal:', error);
      }

      return removedUser;
    }
    return undefined;
  }

  getUsersInRoom(room: string): User[] {
    return this.users.filter((user) => user.room === room);
  }

  async setUserTypingStatus(
    id: string,
    isTyping: boolean,
  ): Promise<User | undefined> {
    const user = this.getUser(id);
    if (user) {
      user.isTyping = isTyping;

      // Update user in database
      try {
        await this.userModel
          .findOneAndUpdate(
            { userId: id },
            { isTyping, lastActive: new Date() },
          )
          .exec();
      } catch (error) {
        this.logger.error('Error updating user typing status:', error);
      }

      return user;
    }
    return undefined;
  }

  async setUserOnlineStatus(
    id: string,
    isOnline: boolean,
  ): Promise<User | undefined> {
    const user = this.getUser(id);
    if (user) {
      user.isOnline = isOnline;

      // Update user in database
      try {
        await this.userModel
          .findOneAndUpdate(
            { userId: id },
            { isOnline, lastActive: new Date() },
          )
          .exec();
      } catch (error) {
        this.logger.error('Error updating user online status:', error);
      }

      return user;
    }
    return undefined;
  }

  async createRoom(roomData: {
    roomId: string;
    roomName: string;
    createdBy: string;
  }): Promise<ChatRoom | null> {
    try {
      // Sanitize input
      const sanitizedData = {
        roomId: this.sanitizeInput(roomData.roomId),
        roomName: this.sanitizeInput(roomData.roomName),
        createdBy: this.sanitizeInput(roomData.createdBy),
      };

      // Check if room already exists
      const existingRoom = await this.roomModel
        .findOne({ roomId: sanitizedData.roomId })
        .exec();
      if (existingRoom) {
        this.logger.warn(`Room with ID ${sanitizedData.roomId} already exists`);
        return null;
      }

      // Create new room
      const newRoom = new this.roomModel({
        roomId: sanitizedData.roomId,
        name: sanitizedData.roomName,
        createdBy: sanitizedData.createdBy,
        createdAt: new Date(),
      });
      await newRoom.save();

      this.logger.log(
        `Created new room: ${sanitizedData.roomName} (${sanitizedData.roomId})`,
      );

      return {
        id: sanitizedData.roomId,
        name: sanitizedData.roomName,
        createdBy: sanitizedData.createdBy,
        createdAt: new Date(),
      };
    } catch (error) {
      this.logger.error('Error creating room:', error);
      return null;
    }
  }

  async getAllRooms(): Promise<ChatRoom[]> {
    try {
      const rooms = await this.roomModel.find().exec();
      return rooms.map((room) => ({
        id: room.roomId,
        name: room.name,
        createdBy: room.createdBy,
        createdAt: room.createdAt,
      }));
    } catch (error) {
      this.logger.error('Error fetching all rooms:', error);
      return [];
    }
  }

  async getRoomById(roomId: string): Promise<ChatRoom | null> {
    try {
      const room = await this.roomModel.findOne({ roomId }).exec();
      if (!room) return null;

      return {
        id: room.roomId,
        name: room.name,
        createdBy: room.createdBy,
        createdAt: room.createdAt,
      };
    } catch (error) {
      this.logger.error(`Error fetching room ${roomId}:`, error);
      return null;
    }
  }

  async addMessage(message: {
    user: string;
    text: string;
    room: string;
    isSystem: boolean;
  }): Promise<ChatMessage> {
    // Sanitize input for non-system messages
    const sanitizedMessage = {
      ...message,
      user: message.isSystem ? message.user : this.sanitizeInput(message.user),
      text: message.isSystem ? message.text : this.sanitizeInput(message.text),
      room: this.sanitizeInput(message.room),
    };

    const messageId = this.generateMessageId();
    const timestamp = new Date();

    try {
      // Track this message in the queue
      if (!sanitizedMessage.isSystem) {
        this.queueService.trackMessage(
          messageId,
          sanitizedMessage.user,
          sanitizedMessage.room,
        );
      }

      // Create message in database
      const newMessage = new this.messageModel({
        messageId,
        user: sanitizedMessage.user,
        text: sanitizedMessage.text,
        room: sanitizedMessage.room,
        timestamp,
        isSystem: sanitizedMessage.isSystem,
      });
      await newMessage.save();

      // Clean up old messages if we exceed the limit
      const count = await this.messageModel
        .countDocuments({ room: sanitizedMessage.room })
        .exec();
      if (count > this.MAX_MESSAGES_PER_ROOM) {
        const oldMessages = await this.messageModel
          .find({ room: sanitizedMessage.room })
          .sort({ timestamp: 1 })
          .limit(count - this.MAX_MESSAGES_PER_ROOM)
          .exec();

        if (oldMessages.length > 0) {
          const oldMessageIds = oldMessages.map((msg) => msg.messageId);
          await this.messageModel
            .deleteMany({ messageId: { $in: oldMessageIds } })
            .exec();
        }
      }

      // Mark the message as processed in the queue
      if (!sanitizedMessage.isSystem) {
        this.queueService.markAsProcessed(messageId);
      }

      return {
        id: messageId,
        user: sanitizedMessage.user,
        text: sanitizedMessage.text,
        room: sanitizedMessage.room,
        timestamp,
        isSystem: sanitizedMessage.isSystem,
      };
    } catch (error) {
      this.logger.error('Error adding message:', error);

      // Mark the message as failed in the queue
      if (!sanitizedMessage.isSystem) {
        this.queueService.markAsFailed(
          messageId,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }

      // Return a basic message object even if DB operation fails
      return {
        id: messageId,
        user: sanitizedMessage.user,
        text: sanitizedMessage.text,
        room: sanitizedMessage.room,
        timestamp,
        isSystem: sanitizedMessage.isSystem,
      };
    }
  }

  async addSystemMessage(room: string, text: string): Promise<ChatMessage> {
    return this.addMessage({
      user: 'system',
      text,
      room,
      isSystem: true,
    });
  }

  private async createSystemMessage(
    room: string,
    text: string,
  ): Promise<ChatMessage> {
    const messageId = this.generateMessageId();
    const timestamp = new Date();

    try {
      // Create message in database
      const newMessage = new this.messageModel({
        messageId,
        user: 'system',
        text,
        room,
        timestamp,
        isSystem: true,
      });
      await newMessage.save();

      return {
        id: messageId,
        user: 'system',
        text,
        room,
        timestamp,
        isSystem: true,
      };
    } catch (error) {
      this.logger.error('Error creating system message:', error);
      // Return a basic message object even if DB operation fails
      return {
        id: messageId,
        user: 'system',
        text,
        room,
        timestamp,
        isSystem: true,
      };
    }
  }

  async getMessagesForRoom(roomId: string): Promise<ChatMessage[]> {
    try {
      const messages = await this.messageModel
        .find({ room: roomId })
        .sort({ timestamp: -1 })
        .limit(this.MAX_MESSAGES_PER_ROOM)
        .exec();

      return messages.map((msg) => ({
        id: msg.messageId,
        user: msg.user,
        text: msg.text,
        room: msg.room,
        timestamp: msg.timestamp,
        isSystem: msg.isSystem,
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error getting messages for room ${roomId}: ${errorMessage}`,
      );
      return [];
    }
  }

  private generateMessageId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // Remove a user from a specific room but keep them connected
  async removeUserFromRoom(
    userId: string,
    roomId: string,
  ): Promise<User | undefined> {
    const userIndex = this.users.findIndex((user) => user.id === userId);
    if (userIndex !== -1) {
      // User found - update their room status
      const user = this.users[userIndex];
      if (user.room === roomId) {
        // Use a special value for "no room" instead of empty string
        // This avoids the MongoDB validation error
        user.room = 'lobby';

        // Update in database
        try {
          await this.userModel
            .findOneAndUpdate({ userId }, { room: 'lobby' }, { new: true })
            .exec();
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Error updating user ${userId} room status: ${errorMessage}`,
          );
        }
      }
      return user;
    }
    return undefined;
  }

  // Remove user from memory
  removeUserFromMemory(userId: string): User | undefined {
    const index = this.users.findIndex((user) => user.id === userId);
    if (index !== -1) {
      const user = this.users[index];
      this.users.splice(index, 1);
      return user;
    }
    return undefined;
  }

  // Get a user by their socket ID
  getUserBySocketId(socketId: string): User | undefined {
    const user = this.users.find((user) => user.socketId === socketId);
    if (!user) {
      this.logger.debug(
        `User not found by socketId: ${socketId}. Available users:`,
        this.users.map((u) => ({ username: u.username, socketId: u.socketId })),
      );
    }
    return user;
  }

  // Get message history for a room
  async getMessageHistory(roomId: string): Promise<ChatMessage[]> {
    try {
      // Fetch messages from database
      const messages = await this.messageModel
        .find({ room: roomId })
        .sort({ timestamp: 1 })
        .limit(100)
        .exec();

      return messages.map((msg) => ({
        id: msg.messageId,
        user: msg.user,
        text: msg.text,
        room: msg.room,
        timestamp: msg.timestamp,
        isSystem: msg.isSystem,
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error fetching message history: ${errorMessage}`);
      return [];
    }
  }
}
