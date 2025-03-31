import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import { getModelToken } from '@nestjs/mongoose';
import { Message } from '../schemas/message.schema';
import { Model } from 'mongoose';
import { QueueMessage } from '../interfaces/chat.interfaces';

describe('QueueService', () => {
  let service: QueueService;
  let messageModel: Model<any>;

  // Mock data
  const mockMessage = {
    messageId: 'msg1',
    user: 'testuser',
    room: 'general',
    text: 'Hello, world!',
    timestamp: new Date(),
    isSystem: false,
  };

  beforeEach(async () => {
    // Create mock implementations
    const mockMessageModel = {
      find: jest.fn(() => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => ({
            exec: jest.fn().mockResolvedValue([mockMessage]),
          })),
        })),
      })),
      exec: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getModelToken(Message.name),
          useValue: mockMessageModel,
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    messageModel = module.get<Model<any>>(getModelToken(Message.name));

    // Reset service state before each test
    service['messageStats'] = new Map();
    service['stats'] = {
      totalMessages: 0,
      pendingMessages: 0,
      processedMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      messagesPerSecond: 0,
      activeRooms: 0,
      activeUsers: 0,
    };
    service['totalProcessingTime'] = 0;
    service['messagesLastMinute'] = [];
    service['activeRooms'] = new Set();
    service['activeUsers'] = new Set();

    // Mock Date.now to return a consistent timestamp
    jest.spyOn(Date, 'now').mockImplementation(() => 1625097600000); // July 1, 2021
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('trackMessage', () => {
    it('should track a new message', () => {
      service.trackMessage('msg1', 'user1', 'room1');

      expect(service['messageStats'].size).toBe(1);
      expect(service['messageStats'].get('msg1')).toBeDefined();
      expect(service['stats'].totalMessages).toBe(1);
      expect(service['stats'].pendingMessages).toBe(1);
      expect(service['activeRooms'].size).toBe(1);
      expect(service['activeUsers'].size).toBe(1);
    });

    it('should increment counts for multiple messages', () => {
      service.trackMessage('msg1', 'user1', 'room1');
      service.trackMessage('msg2', 'user1', 'room1');
      service.trackMessage('msg3', 'user2', 'room2');

      expect(service['messageStats'].size).toBe(3);
      expect(service['stats'].totalMessages).toBe(3);
      expect(service['stats'].pendingMessages).toBe(3);
      expect(service['activeRooms'].size).toBe(2);
      expect(service['activeUsers'].size).toBe(2);
    });
  });

  describe('markAsProcessed', () => {
    it('should mark a message as processed', () => {
      // Setup
      service.trackMessage('msg1', 'user1', 'room1');

      // Test
      service.markAsProcessed('msg1');

      // Verify
      const messageInfo = service['messageStats'].get('msg1');
      expect(messageInfo).toBeDefined();
      expect(messageInfo?.status).toBe('processed');
      expect(service['stats'].pendingMessages).toBe(0);
      expect(service['stats'].processedMessages).toBe(1);
    });

    it('should do nothing for non-existent message', () => {
      service.markAsProcessed('nonexistent');

      expect(service['stats'].pendingMessages).toBe(0);
      expect(service['stats'].processedMessages).toBe(0);
    });
  });

  describe('markAsFailed', () => {
    it('should mark a message as failed', () => {
      // Setup
      service.trackMessage('msg1', 'user1', 'room1');

      // Test
      service.markAsFailed('msg1', 'Test error');

      // Verify
      const messageInfo = service['messageStats'].get('msg1');
      expect(messageInfo).toBeDefined();
      expect(messageInfo?.status).toBe('failed');
      expect(service['stats'].pendingMessages).toBe(0);
      expect(service['stats'].failedMessages).toBe(1);
    });

    it('should do nothing for non-existent message', () => {
      service.markAsFailed('nonexistent');

      expect(service['stats'].pendingMessages).toBe(0);
      expect(service['stats'].failedMessages).toBe(0);
    });
  });

  describe('getQueueStats', () => {
    it('should return the current queue statistics', () => {
      // Setup
      service['stats'] = {
        totalMessages: 10,
        pendingMessages: 5,
        processedMessages: 4,
        failedMessages: 1,
        averageProcessingTime: 123,
        messagesPerSecond: 0.5,
        activeRooms: 2,
        activeUsers: 3,
      };

      // Test
      const stats = service.getQueueStats();

      // Verify
      expect(stats).toEqual(service['stats']);
      expect(stats).not.toBe(service['stats']); // Should be a copy
    });
  });

  describe('getRecentMessages', () => {
    it('should return recent messages with their status', async () => {
      // Setup
      service.trackMessage('msg1', 'user1', 'room1');
      service.markAsProcessed('msg1');

      // Mock message model find to return messages
      jest.spyOn(messageModel, 'find').mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValueOnce([mockMessage]),
      } as any);

      // Test
      const messages = await service.getRecentMessages();

      // Verify
      expect(messages).toBeDefined();
      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe(mockMessage.messageId);
    });

    it('should handle errors gracefully', async () => {
      // Mock message model find to throw error
      jest.spyOn(messageModel, 'find').mockImplementation(() => {
        throw new Error('Database error');
      });

      // Test
      const messages = await service.getRecentMessages();

      // Verify
      expect(messages).toEqual([]);
    });
  });

  describe('getFilteredMessages', () => {
    it('should filter messages by status', async () => {
      // Setup
      service.trackMessage('msg1', 'user1', 'room1');

      // Mock message model find to return messages
      jest.spyOn(messageModel, 'find').mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValueOnce([mockMessage]),
      } as any);

      // Test
      const messages = await service.getFilteredMessages('pending');

      // Verify
      expect(messages).toBeDefined();
      expect(messages.length).toBe(1);
      expect(messages[0].status).toBe('pending');
    });

    it('should apply room and user filters', async () => {
      // Mock message model find with query parameter check
      const findSpy = jest.spyOn(messageModel, 'find').mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValueOnce([mockMessage]),
      } as any);

      // Test
      await service.getFilteredMessages(
        undefined,
        'general',
        'testuser',
        undefined,
        undefined,
        10,
      );

      // Verify the query contains the room and user filters
      expect(findSpy).toHaveBeenCalledWith({
        room: 'general',
        user: 'testuser',
      });
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', () => {
      // Setup
      service.trackMessage('msg1', 'user1', 'room1');
      service.trackMessage('msg2', 'user2', 'room2');
      service.markAsProcessed('msg1');

      // Test
      service.resetStats();

      // Verify
      expect(service['stats'].totalMessages).toBe(0);
      expect(service['stats'].pendingMessages).toBe(0);
      expect(service['stats'].processedMessages).toBe(0);
      expect(service['messageStats'].size).toBe(0);
      expect(service['activeRooms'].size).toBe(2); // These should be preserved
      expect(service['activeUsers'].size).toBe(2); // These should be preserved
    });
  });
});
