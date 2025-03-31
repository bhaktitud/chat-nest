import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { getModelToken } from '@nestjs/mongoose';
import { QueueService } from '../queue/queue.service';
import { User as UserSchema } from '../schemas/user.schema';
import { Message } from '../schemas/message.schema';
import { Room } from '../schemas/room.schema';
import { Model } from 'mongoose';
import {
  ChatMessage,
  ChatRoom,
  User as UserType,
} from '../interfaces/chat.interfaces';

describe('ChatService', () => {
  let service: ChatService;
  let userModel: Model<any>;
  let roomModel: Model<any>;
  let messageModel: Model<any>;
  let queueService: QueueService;

  // Mock data
  const mockUser: UserType = {
    id: 'user1',
    username: 'testuser',
    room: 'general',
    isOnline: true,
    isTyping: false,
    socketId: 'socket1',
  };

  const mockRoom: ChatRoom = {
    id: 'general',
    name: 'General',
    createdBy: 'system',
    createdAt: new Date(),
  };

  const mockMessage: ChatMessage = {
    id: 'msg1',
    user: 'testuser',
    text: 'Hello, world!',
    room: 'general',
    timestamp: new Date(),
    isSystem: false,
  };

  beforeEach(async () => {
    // Create mock implementations
    const mockUserModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(mockUser),
      })),
      deleteMany: jest.fn(),
      save: jest.fn(),
      exec: jest.fn(),
      new: jest.fn().mockResolvedValue(mockUser),
    };

    const mockRoomModel = {
      find: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue([mockRoom]),
      })),
      findOne: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(mockRoom),
      })),
      save: jest.fn(),
      exec: jest.fn(),
      new: jest.fn().mockResolvedValue(mockRoom),
    };

    const mockMessageModel = {
      find: jest.fn(() => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => ({
            exec: jest.fn().mockResolvedValue([mockMessage]),
          })),
        })),
      })),
      countDocuments: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(10),
      })),
      deleteMany: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      })),
      save: jest.fn(),
      new: jest.fn().mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(mockMessage),
      })),
    };

    const mockQueueService = {
      trackMessage: jest.fn(),
      markAsProcessed: jest.fn(),
      markAsFailed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getModelToken(UserSchema.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Room.name),
          useValue: mockRoomModel,
        },
        {
          provide: getModelToken(Message.name),
          useValue: mockMessageModel,
        },
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    userModel = module.get<Model<any>>(getModelToken(UserSchema.name));
    roomModel = module.get<Model<any>>(getModelToken(Room.name));
    messageModel = module.get<Model<any>>(getModelToken(Message.name));
    queueService = module.get<QueueService>(QueueService);

    // Mock the internal users array in ChatService
    service['users'] = [mockUser];
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addUser', () => {
    it('should add a new user', async () => {
      jest.spyOn(userModel, 'constructor').mockReturnValueOnce({
        save: jest.fn().mockResolvedValue(mockUser),
      } as any);

      const result = await service.addUser(mockUser);

      expect(result).toBeDefined();
      expect(result.username).toBe(mockUser.username);
    });

    it('should update existing user with same socket ID', async () => {
      // Setup users array with existing user
      service['users'] = [{ ...mockUser, username: 'olduser' }];

      const result = await service.addUser(mockUser);

      expect(result).toBeDefined();
      expect(result.username).toBe(mockUser.username);
      expect(service['users'].length).toBe(1); // Should still be 1
    });
  });

  describe('getUserBySocketId', () => {
    it('should find a user by socket ID', () => {
      const result = service.getUserBySocketId(mockUser.socketId);

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockUser.id);
    });

    it('should return undefined for non-existent socket ID', () => {
      const result = service.getUserBySocketId('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getUsersInRoom', () => {
    it('should return all users in a room', () => {
      service['users'] = [
        mockUser,
        { ...mockUser, id: 'user2', username: 'user2' },
        { ...mockUser, id: 'user3', room: 'otherroom' },
      ];

      const result = service.getUsersInRoom(mockUser.room);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('user1');
      expect(result[1].id).toBe('user2');
    });
  });

  describe('addMessage', () => {
    it('should add a new message', async () => {
      const messageData = {
        user: 'testuser',
        text: 'Hello, world!',
        room: 'general',
        isSystem: false,
      };

      const spy = jest.spyOn(queueService, 'trackMessage');

      const result = await service.addMessage(messageData);

      expect(result).toBeDefined();
      expect(result.user).toBe(messageData.user);
      expect(result.text).toBe(messageData.text);
      expect(spy).toHaveBeenCalled();
    });

    it('should sanitize input for non-system messages', async () => {
      const messageData = {
        user: '<script>alert("xss")</script>testuser',
        text: '<img src="x" onerror="alert(1)">Hello',
        room: 'general',
        isSystem: false,
      };

      const result = await service.addMessage(messageData);

      expect(result.user).not.toContain('<script>');
      expect(result.text).not.toContain('onerror');
    });
  });

  describe('getMessagesForRoom', () => {
    it('should return messages for a room', async () => {
      const spy = jest.spyOn(messageModel, 'find');

      const result = await service.getMessagesForRoom('general');

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(spy).toHaveBeenCalledWith({ room: 'general' });
    });

    it('should return empty array on error', async () => {
      jest.spyOn(messageModel, 'find').mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.getMessagesForRoom('general');

      expect(result).toEqual([]);
    });
  });

  describe('getAllRooms', () => {
    it('should return all rooms', async () => {
      const spy = jest.spyOn(roomModel, 'find');

      const result = await service.getAllRooms();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('removeUserFromRoom', () => {
    it('should remove a user from a room', async () => {
      service['users'] = [mockUser];
      const spy = jest.spyOn(userModel, 'findOneAndUpdate');

      const result = await service.removeUserFromRoom(
        mockUser.id,
        mockUser.room,
      );

      expect(result).toBeDefined();
      expect(result?.room).toBe('lobby');
      expect(spy).toHaveBeenCalled();
    });
  });
});
