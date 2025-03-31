import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from '../schemas/message.schema';
import { QueueMessage, QueueStats } from '../interfaces/chat.interfaces';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private messageStats: Map<string, { startTime: number; status: string }> =
    new Map();
  private stats: QueueStats = {
    totalMessages: 0,
    pendingMessages: 0,
    processedMessages: 0,
    failedMessages: 0,
    averageProcessingTime: 0,
    messagesPerSecond: 0,
    activeRooms: 0,
    activeUsers: 0,
  };

  private totalProcessingTime = 0;
  private messagesLastMinute: { timestamp: number; id: string }[] = [];
  private activeRooms = new Set<string>();
  private activeUsers = new Set<string>();

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {
    // Update messages per second every 5 seconds
    setInterval(() => this.updateMessagesPerSecond(), 5000);
  }

  /**
   * Track a new message being added to the queue
   */
  trackMessage(messageId: string, userId: string, roomId: string): void {
    this.messageStats.set(messageId, {
      startTime: Date.now(),
      status: 'pending',
    });

    this.stats.totalMessages++;
    this.stats.pendingMessages++;

    this.activeRooms.add(roomId);
    this.activeUsers.add(userId);

    this.stats.activeRooms = this.activeRooms.size;
    this.stats.activeUsers = this.activeUsers.size;

    // Add to messages last minute
    this.messagesLastMinute.push({
      timestamp: Date.now(),
      id: messageId,
    });
  }

  /**
   * Mark a message as processed
   */
  markAsProcessed(messageId: string): void {
    const messageInfo = this.messageStats.get(messageId);
    if (!messageInfo) return;

    const processingTime = Date.now() - messageInfo.startTime;

    messageInfo.status = 'processed';

    // Update stats
    this.stats.pendingMessages--;
    this.stats.processedMessages++;
    this.totalProcessingTime += processingTime;
    this.stats.averageProcessingTime =
      this.totalProcessingTime / this.stats.processedMessages;
  }

  /**
   * Mark a message as failed
   */
  markAsFailed(messageId: string, error?: string): void {
    const messageInfo = this.messageStats.get(messageId);
    if (!messageInfo) return;

    messageInfo.status = 'failed';

    // Update stats
    this.stats.pendingMessages--;
    this.stats.failedMessages++;

    if (error) {
      this.logger.error(`Message ${messageId} failed: ${error}`);
    }
  }

  /**
   * Get current queue statistics
   */
  getQueueStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * Update the messages per second calculation
   */
  private updateMessagesPerSecond(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Filter messages from the last minute
    this.messagesLastMinute = this.messagesLastMinute.filter(
      (msg) => msg.timestamp > oneMinuteAgo,
    );

    // Calculate messages per second
    this.stats.messagesPerSecond = this.messagesLastMinute.length / 60;
  }

  /**
   * Get recent messages with their status
   */
  async getRecentMessages(limit: number = 100): Promise<QueueMessage[]> {
    try {
      const messages = await this.messageModel
        .find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .exec();

      return messages.map((msg) => {
        const messageInfo = this.messageStats.get(msg.messageId) || {
          status: 'processed',
          startTime: 0,
        };

        const processingTime =
          messageInfo.status === 'pending'
            ? Date.now() - messageInfo.startTime
            : 0;

        return {
          id: msg.messageId,
          user: msg.user,
          room: msg.room,
          text: msg.text,
          timestamp: msg.timestamp,
          status: messageInfo.status as 'pending' | 'processed' | 'failed',
          processingTime: processingTime || undefined,
        };
      });
    } catch (error) {
      this.logger.error('Error fetching recent messages:', error);
      return [];
    }
  }

  /**
   * Get filtered messages
   */
  async getFilteredMessages(
    status?: string,
    room?: string,
    user?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100,
  ): Promise<QueueMessage[]> {
    try {
      const query: {
        room?: string;
        user?: string;
        timestamp?: {
          $gte?: Date;
          $lte?: Date;
        };
      } = {};

      if (room) query.room = room;
      if (user) query.user = user;

      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = startDate;
        if (endDate) query.timestamp.$lte = endDate;
      }

      const messages = await this.messageModel
        .find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .exec();

      let filteredMessages = messages.map((msg) => {
        const messageInfo = this.messageStats.get(msg.messageId) || {
          status: 'processed',
          startTime: 0,
        };

        const processingTime =
          messageInfo.status === 'pending'
            ? Date.now() - messageInfo.startTime
            : 0;

        return {
          id: msg.messageId,
          user: msg.user,
          room: msg.room,
          text: msg.text,
          timestamp: msg.timestamp,
          status: messageInfo.status as 'pending' | 'processed' | 'failed',
          processingTime: processingTime || undefined,
        };
      });

      // Filter by status if needed
      if (status && status !== 'all') {
        filteredMessages = filteredMessages.filter(
          (msg) => msg.status === status,
        );
      }

      return filteredMessages;
    } catch (error) {
      this.logger.error('Error fetching filtered messages:', error);
      return [];
    }
  }

  /**
   * Get active rooms list
   */
  getActiveRooms(): string[] {
    return Array.from(this.activeRooms);
  }

  /**
   * Get active users list
   */
  getActiveUsers(): string[] {
    return Array.from(this.activeUsers);
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalMessages: 0,
      pendingMessages: 0,
      processedMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      messagesPerSecond: 0,
      activeRooms: this.activeRooms.size,
      activeUsers: this.activeUsers.size,
    };

    this.totalProcessingTime = 0;
    this.messagesLastMinute = [];

    // Clear message stats but keep active rooms and users
    this.messageStats.clear();

    this.logger.log('Queue statistics have been reset');
  }
}
