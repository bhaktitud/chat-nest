import { Controller, Get, Query, Post } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueFilterDto, QueueStatsDto } from '../dto/chat.dto';

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get('stats')
  getQueueStats(): QueueStatsDto {
    return this.queueService.getQueueStats();
  }

  @Get('messages')
  async getMessages(@Query('limit') limit: number = 100) {
    return this.queueService.getRecentMessages(limit);
  }

  @Get('messages/filtered')
  async getFilteredMessages(@Query() filterDto: QueueFilterDto) {
    const { status, room, user, startDate, endDate, limit } = filterDto;
    return this.queueService.getFilteredMessages(
      status,
      room,
      user,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit,
    );
  }

  @Get('rooms')
  getActiveRooms() {
    return this.queueService.getActiveRooms();
  }

  @Get('users')
  getActiveUsers() {
    return this.queueService.getActiveUsers();
  }

  @Post('reset')
  resetStats() {
    this.queueService.resetStats();
    return { success: true };
  }
}
