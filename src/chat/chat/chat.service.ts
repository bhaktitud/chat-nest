import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from '../schemas/message.schema';
import { Room, RoomDocument } from '../schemas/room.schema';
import { User as UserSchema, UserDocument } from '../schemas/user.schema';

export interface User {
  id: string;
  username: string;
  room: string;
  isOnline: boolean;
  isTyping: boolean;
  socketId?: string;
}

interface ChatRoom {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  room: string;
  timestamp: Date;
  isSystem: boolean;
}

@Injectable()
export class ChatService {
  private readonly MAX_MESSAGES_PER_ROOM = 50; // Set the limit for messages stored per room
  private users: User[] = []; // Keep users in memory for active sessions

  constructor(
    @InjectModel(UserSchema.name) private userModel: Model<UserDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {
    // Initialize default rooms (but don't await it to avoid blocking)
    this.initializeDefaultRooms().catch((err) =>
      console.error('Error initializing default rooms:', err),
    );
  }

  private async initializeDefaultRooms() {
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
        }
      } catch (error) {
        console.error(`Error creating room ${room.id}:`, error);
      }
    }
  }

  async addUser(user: User): Promise<User> {
    // Remove any existing user with the same socket ID to prevent duplicates
    const socketIdIndex = this.users.findIndex(
      (u) => u.socketId === user.socketId,
    );
    if (socketIdIndex !== -1) {
      console.log(`Removing existing user with socketId ${user.socketId}`);
      this.users.splice(socketIdIndex, 1);
    }

    const newUser = {
      ...user,
      isOnline: true,
      isTyping: false,
    };

    // Check if this user (by username and room) already exists
    const existingUserIndex = this.users.findIndex(
      (u) => u.username === user.username && u.room === user.room,
    );

    if (existingUserIndex !== -1) {
      // Update the existing user with the new socket ID
      this.users[existingUserIndex] = {
        ...this.users[existingUserIndex],
        socketId: user.socketId,
        id: user.id,
        isOnline: true,
      };

      console.log(
        `Updated existing user (${user.username}) with new socketId: ${user.socketId}`,
      );

      // Update user in database
      try {
        await this.userModel
          .findOneAndUpdate(
            { userId: this.users[existingUserIndex].id },
            { isOnline: true, lastActive: new Date(), socketId: user.socketId },
          )
          .exec();
      } catch (error) {
        console.error('Error updating user online status:', error);
      }

      return this.users[existingUserIndex];
    }

    // Save user to database
    try {
      const dbUser = new this.userModel({
        userId: user.id,
        username: user.username,
        room: user.room,
        isOnline: true,
        isTyping: false,
        socketId: user.socketId,
        lastActive: new Date(),
      });
      await dbUser.save();
      console.log(
        `Added new user: ${user.username} with socketId: ${user.socketId}`,
      );
    } catch (error) {
      console.error('Error saving user to database:', error);
    }

    this.users.push(newUser);
    return newUser;
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
        console.error('Error updating user status on removal:', error);
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
        console.error('Error updating user typing status:', error);
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
        console.error('Error updating user online status:', error);
      }

      return user;
    }
    return undefined;
  }

  async createRoom(roomData: {
    id: string;
    name: string;
    createdBy: string;
  }): Promise<ChatRoom> {
    try {
      // Check if room already exists in database
      const existingRoom = await this.roomModel
        .findOne({ roomId: roomData.id })
        .exec();

      if (existingRoom) {
        throw new Error(`Room with ID ${roomData.id} already exists`);
      }

      // Create new room in database
      const newRoom = new this.roomModel({
        roomId: roomData.id,
        name: roomData.name,
        createdBy: roomData.createdBy,
        createdAt: new Date(),
      });
      await newRoom.save();

      // Create a welcome message
      await this.createSystemMessage(
        roomData.id,
        `${roomData.name} room created by ${roomData.createdBy}!`,
      );

      return {
        id: roomData.id,
        name: roomData.name,
        createdBy: roomData.createdBy,
        createdAt: new Date(),
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Error creating room');
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
      console.error('Error getting all rooms:', error);
      return [];
    }
  }

  async getRoomById(id: string): Promise<ChatRoom | undefined> {
    try {
      const room = await this.roomModel.findOne({ roomId: id }).exec();
      if (!room) return undefined;

      return {
        id: room.roomId,
        name: room.name,
        createdBy: room.createdBy,
        createdAt: room.createdAt,
      };
    } catch (error) {
      console.error(`Error getting room ${id}:`, error);
      return undefined;
    }
  }

  // Message methods
  async addMessage(
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
  ): Promise<ChatMessage> {
    const messageId = this.generateMessageId();
    const timestamp = new Date();

    try {
      // Create message in database
      const newMessage = new this.messageModel({
        messageId,
        user: message.user,
        text: message.text,
        room: message.room,
        timestamp,
        isSystem: message.isSystem,
      });
      await newMessage.save();

      // Clean up old messages if we exceed the limit
      const count = await this.messageModel
        .countDocuments({ room: message.room })
        .exec();
      if (count > this.MAX_MESSAGES_PER_ROOM) {
        const oldMessages = await this.messageModel
          .find({ room: message.room })
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

      return {
        id: messageId,
        user: message.user,
        text: message.text,
        room: message.room,
        timestamp,
        isSystem: message.isSystem,
      };
    } catch (error) {
      console.error('Error adding message:', error);
      // Return a basic message object even if DB operation fails
      return {
        id: messageId,
        user: message.user,
        text: message.text,
        room: message.room,
        timestamp,
        isSystem: message.isSystem,
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
      console.error('Error creating system message:', error);
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
        .sort({ timestamp: 1 })
        .exec();

      return messages.map((msg) => ({
        id: msg.messageId,
        user: msg.user,
        text: msg.text,
        room: msg.room,
        timestamp: msg.timestamp,
        isSystem: msg.isSystem,
      }));
    } catch (error) {
      console.error(`Error getting messages for room ${roomId}:`, error);
      return [];
    }
  }

  private generateMessageId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // Remove a user from a specific room but keep them connected
  removeUserFromRoom(userId: string, roomId: string) {
    const userIndex = this.users.findIndex((user) => user.id === userId);
    if (userIndex !== -1) {
      // User found - update their room status
      const user = this.users[userIndex];
      if (user.room === roomId) {
        // Use a special value for "no room" instead of empty string
        // This avoids the MongoDB validation error
        user.room = 'lobby';
      }
      return user;
    }
    return undefined;
  }

  // Remove user from memory
  removeUserFromMemory(userId: string) {
    const index = this.users.findIndex((user) => user.id === userId);
    if (index !== -1) {
      const user = this.users[index];
      this.users.splice(index, 1);
      return user;
    }
    return undefined;
  }

  // Get a user by their socket ID
  getUserBySocketId(socketId: string) {
    const user = this.users.find((user) => user.socketId === socketId);
    if (!user) {
      console.log(
        `User not found by socketId: ${socketId}. Available users:`,
        this.users.map((u) => ({ username: u.username, socketId: u.socketId })),
      );
    }
    return user;
  }

  // Get message history for a room
  async getMessageHistory(roomId: string): Promise<any[]> {
    try {
      // Fetch messages from database
      return await this.messageModel
        .find({ room: roomId })
        .sort({ timestamp: 1 })
        .limit(100)
        .populate('user')
        .exec();
    } catch (error) {
      console.error('Error fetching message history:', error);
      return [];
    }
  }
}
